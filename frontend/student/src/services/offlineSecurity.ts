import type {
  Account,
  GateEntryEvent,
  LatePermission,
  OfflineEntrySyncItem,
  OfflineSecuritySnapshot,
  OfflinePermissionTicket,
} from './api'
import { getSessionUserId } from './api'

interface OfflineClaims {
  iss: string
  aud: string | string[]
  iat: number
  exp: number
  permission_id: string
  request_id: number
  student_id: number
  student_name: string
  register_number: string | null
  department_id: number | null
  department_code: string | null
  department_name: string | null
  approved_by_user_id: number
  approver_name: string | null
  approver_role: 'advisor' | 'hod'
  approved_at: number
  valid_from: number
  valid_until: number
  offline_until: number
  status: string
  college_id: number
  gate_id: number
  gate_code: string
  gate_name: string
  security_user_id: number
  security_name: string
  role: string
}

export interface OfflineQueuedEntry extends OfflineEntrySyncItem {
  event: GateEntryEvent
}

export interface OfflineCache {
  snapshot: OfflineSecuritySnapshot
  pending: OfflineQueuedEntry[]
  rejected: Array<OfflineQueuedEntry & { reason: string }>
}

const STORAGE_PREFIX = 'smartgate.offline-security.v1'
const LAST_SECURITY_USER_KEY = 'smartgate.offline-security.last-user-id'
const OFFLINE_PUBLIC_KEY = import.meta.env.VITE_OFFLINE_PUBLIC_KEY?.replace(/\\n/g, '\n').trim()

function cacheKey(securityUserId: number): string {
  return `${STORAGE_PREFIX}.${securityUserId}`
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function pemBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function publicKeyMatches(snapshot: OfflineSecuritySnapshot): boolean {
  return Boolean(OFFLINE_PUBLIC_KEY)
    && snapshot.public_key_pem.replace(/\r\n/g, '\n').trim() === OFFLINE_PUBLIC_KEY
}

function decodeClaims(token: string): { claims: OfflineClaims; signedContent: string; signature: Uint8Array } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('The cached permission token is malformed.')
  return {
    claims: JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as OfflineClaims,
    signedContent: `${parts[0]}.${parts[1]}`,
    signature: decodeBase64Url(parts[2]),
  }
}

async function importPinnedPublicKey(): Promise<CryptoKey> {
  if (!OFFLINE_PUBLIC_KEY) {
    throw new Error('Offline verification needs the matching public key configured in the security client.')
  }
  return crypto.subtle.importKey(
    'spki',
    asArrayBuffer(pemBytes(OFFLINE_PUBLIC_KEY)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

async function verifyTicket(
  ticket: OfflinePermissionTicket,
  snapshot: OfflineSecuritySnapshot,
  account: Account,
): Promise<OfflineClaims> {
  if (!publicKeyMatches(snapshot)) throw new Error('The offline signing key does not match this security client.')
  const { claims, signedContent, signature } = decodeClaims(ticket.signed_token)
  const key = await importPinnedPublicKey()
  const validSignature = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    asArrayBuffer(signature),
    asArrayBuffer(new TextEncoder().encode(signedContent)),
  )
  const now = Math.floor(Date.now() / 1000)
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!validSignature
    || claims.iss !== 'smartgate'
    || !audience.includes('smartgate-offline-security')
    || claims.status !== 'approved'
    || claims.security_user_id !== account.id
    || claims.gate_id !== account.gate_id
    || claims.college_id !== account.college_id
    || now < claims.iat - 120
    || claims.permission_id !== ticket.permission.permission_id) {
    throw new Error('A cached permission is invalid or not assigned to this gate.')
  }
  return claims
}

export async function verifyOfflineSnapshot(
  snapshot: OfflineSecuritySnapshot,
  account: Account,
): Promise<LatePermission[]> {
  if (!publicKeyMatches(snapshot)) throw new Error('The offline signing key does not match this security client.')
  const { claims: snapshotClaims, signedContent, signature } = decodeClaims(snapshot.snapshot_token)
  const key = await importPinnedPublicKey()
  const validSnapshotSignature = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    asArrayBuffer(signature),
    asArrayBuffer(new TextEncoder().encode(signedContent)),
  )
  const now = Math.floor(Date.now() / 1000)
  if (!validSnapshotSignature
    || snapshotClaims.iss !== 'smartgate'
    || !(Array.isArray(snapshotClaims.aud)
      ? snapshotClaims.aud
      : [snapshotClaims.aud]).includes('smartgate-offline-security')
    || snapshotClaims.security_user_id !== account.id
    || snapshotClaims.gate_id !== account.gate_id
    || snapshotClaims.college_id !== account.college_id
    || now < snapshotClaims.iat - 120
    || now > snapshotClaims.exp) {
    throw new Error('The offline cache has expired or is not assigned to this security account.')
  }
  const validPermissions: LatePermission[] = []
  for (const ticket of snapshot.permissions) {
    const claims = await verifyTicket(ticket, snapshot, account)
    if (now > claims.exp
      || now < claims.valid_from
      || now > claims.valid_until
      || now > claims.offline_until) continue
    validPermissions.push({
      permission_id: claims.permission_id,
      request_id: claims.request_id,
      student_id: claims.student_id,
      student_name: claims.student_name,
      register_number: claims.register_number,
      department_id: claims.department_id,
      department_code: claims.department_code,
      department_name: claims.department_name,
      approved_by_user_id: claims.approved_by_user_id,
      approver_name: claims.approver_name,
      approver_role: claims.approver_role,
      approved_at: new Date(claims.approved_at * 1000).toISOString(),
      valid_from: new Date(claims.valid_from * 1000).toISOString(),
      valid_until: new Date(claims.valid_until * 1000).toISOString(),
      status: 'approved',
    })
  }
  return validPermissions
}

export async function verifyCachedPermission(
  snapshot: OfflineSecuritySnapshot,
  permissionId: string,
  account: Account,
): Promise<{ permission: LatePermission; signedToken: string }> {
  const ticket = snapshot.permissions.find((item) => item.permission.permission_id === permissionId)
  if (!ticket) throw new Error('This permission is not present in the signed offline cache.')
  const claims = await verifyTicket(ticket, snapshot, account)
  const [permission] = await verifyOfflineSnapshot({
    ...snapshot,
    permissions: [ticket],
  }, account)
  if (!permission || claims.permission_id !== permissionId) {
    throw new Error('The offline permission could not be verified.')
  }
  return { permission, signedToken: ticket.signed_token }
}

export function loadOfflineCache(securityUserId: number): OfflineCache | null {
  const stored = localStorage.getItem(cacheKey(securityUserId))
  if (!stored) return null
  try {
    return JSON.parse(stored) as OfflineCache
  } catch {
    throw new Error('The offline cache is unreadable. Reconnect to refresh it before verifying entries.')
  }
}

export function saveOfflineCache(securityUserId: number, cache: OfflineCache): void {
  localStorage.setItem(cacheKey(securityUserId), JSON.stringify(cache))
  localStorage.setItem(LAST_SECURITY_USER_KEY, String(securityUserId))
}

export async function restoreOfflineSecurityAccount(): Promise<Account | null> {
  const sessionUserId = getSessionUserId()
  if (sessionUserId === null || localStorage.getItem(LAST_SECURITY_USER_KEY) !== String(sessionUserId)) {
    return null
  }
  const cache = loadOfflineCache(sessionUserId)
  if (!cache || !publicKeyMatches(cache.snapshot)) return null
  const { claims, signedContent, signature } = decodeClaims(cache.snapshot.snapshot_token)
  const key = await importPinnedPublicKey()
  const validSignature = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    asArrayBuffer(signature),
    asArrayBuffer(new TextEncoder().encode(signedContent)),
  )
  const now = Math.floor(Date.now() / 1000)
  if (!validSignature
    || claims.iss !== 'smartgate'
    || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes('smartgate-offline-security')
    || claims.security_user_id !== sessionUserId
    || claims.role !== 'security'
    || now < claims.iat - 120
    || now > claims.exp) return null
  return {
    id: claims.security_user_id,
    email: '',
    full_name: claims.security_name,
    role: 'security',
    student_id: null,
    employee_id: null,
    register_number: null,
    college_id: claims.college_id,
    department_id: null,
    gate_id: claims.gate_id,
    year: null,
    section: null,
    advisor_user_id: null,
    gate_assignment: claims.gate_name || claims.gate_code,
    photo_url: null,
  }
}

export function offlineEntryEvent(
  permission: LatePermission,
  account: Account,
  clientEventId: string,
  enteredAt: string,
  signedToken: string,
): GateEntryEvent {
  const { claims } = decodeClaims(signedToken)
  return {
    id: -(Date.now() + crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000),
    permission_id: permission.permission_id,
    student_id: permission.student_id,
    student_name: permission.student_name ?? `Student ${permission.student_id}`,
    register_number: claims.register_number,
    department_code: permission.department_code,
    gate_id: claims.gate_id,
    gate_code: claims.gate_code,
    gate_name: claims.gate_name,
    security_user_id: account.id,
    security_name: account.full_name,
    entered_at: enteredAt,
    verification_mode: 'offline',
    client_event_id: clientEventId,
  }
}
