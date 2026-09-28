const API_BASE_URL = (() => {
  const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim()
  if (configuredBase) return configuredBase.replace(/\/$/, '')

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return `${protocol}//${hostname}:8000`
    }
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`
  }

  return 'http://127.0.0.1:8000'
})()
const TOKEN_KEY = 'smartgate.access-token'

export interface Account {
  id: number
  email: string
  full_name: string
  role: string
  student_id: string | null
  employee_id: string | null
  register_number: string | null
  college_id: number | null
  department_id: number | null
  gate_id: number | null
  year: string | null
  section: string | null
  advisor_user_id: number | null
  gate_assignment: string | null
  photo_url: string | null
}

export interface StudentVerification extends Account {
  department_code: string
  department_name: string
  gate_code: string
  gate_name: string
}

export interface CollegeProfile {
  id: number
  name: string
  photo_url?: string | null
  logo_updated_by?: string | null
  logo_updated_by_role?: string | null
  logo_updated_at?: string | null
  previous_logo?: string | null
  new_logo?: string | null
  code: string
  address: string
  academic_year: string
  working_days: string[]
  default_gate_closing_time: string
  monthly_late_limit: number
  permission_validity_minutes: number
  parent_notifications_enabled: boolean
  emergency_permissions_enabled: boolean
  holidays: string[]
}

export interface CollegeBranding {
  name: string
  photo_url: string | null
  logo_updated_by: string | null
  logo_updated_by_role: string | null
  logo_updated_at: string | null
}

export interface CollegeAdminCreate {
  email: string
  full_name: string
  password: string
  photo_url?: string
}

export interface Department {
  id: number
  college_id: number
  code: string
  name: string
  hod_user_id: number | null
}

export interface Gate {
  id: number
  college_id: number
  code: string
  name: string
  is_active: boolean
}

export interface DepartmentQr {
  id: number
  department_id: number
  department_code: string
  department_name: string
  gate_id: number
  gate_code: string
  gate_name: string
  status: 'active' | 'disabled'
  qr_payload: string
  created_by_user_id: number
}

export interface StaffAssignments {
  role: 'hod' | 'advisor'
  department_id: number
  department_code: string
  department_name: string
  hod_name: string | null
  classes: Array<{
    academic_year: string
    year: string
    section: string
    advisor_user_id: number
    advisor_name: string
  }>
}

export interface LateRequest {
  id: number
  student_id: number
  department_id: number
  advisor_user_id: number | null
  hod_user_id: number | null
  reason: string
  status: 'pending_approval' | 'approved' | 'rejected'
  decision_note: string | null
  requested_at: string
  approved_at: string | null
  approved_by_user_id: number | null
  advisor_name?: string | null
  hod_name?: string | null
  approved_by_name?: string | null
  approved_by_role?: 'advisor' | 'hod' | null
}

export interface LateRequestHistoryItem {
  id: number
  student_id: number
  student_name: string
  student_identifier: string | null
  register_number: string | null
  year: string | null
  section: string | null
  department_id: number
  department_code: string
  department_name: string
  advisor_name: string | null
  hod_name: string | null
  reason: string
  status: 'pending_approval' | 'approved' | 'rejected'
  decision_note: string | null
  requested_at: string
  approved_at: string | null
  approved_by_user_id: number | null
  approved_by_name: string | null
  approved_by_role: 'advisor' | 'hod' | null
}

export interface LatePermission {
  permission_id: string
  request_id: number
  student_id: number
  student_name: string | null
  department_id: number | null
  department_code: string | null
  department_name: string | null
  approved_by_user_id: number
  approver_name: string | null
  approver_role: 'advisor' | 'hod'
  approved_at: string
  valid_from: string
  valid_until: string
  status: 'approved' | 'rejected'
}

export interface GateEntryEvent {
  id: number
  permission_id: string
  student_id: number
  student_name: string
  register_number: string | null
  department_code: string | null
  gate_id: number
  gate_code: string
  gate_name: string
  security_user_id: number
  security_name: string
  entered_at: string
}

export interface DirectMessage {
  id: number
  sender_id: number
  recipient_id: number
  client_message_id: string
  body: string
  created_at: string
  delivered_at: string | null
}

export interface DirectMessagePage {
  items: DirectMessage[]
  next_cursor: number
}

export interface DemoAccountCreate {
  email: string
  full_name: string
  password: string
  employee_id: string
  photo_url?: string
}

export interface StudentAccountCreate {
  email: string
  full_name: string
  password: string
  student_id: string
  register_number: string
  department_id: number
  year: string
  section: string
  parent_name?: string
  parent_phone?: string
  parent_email?: string
  parent_relationship?: string
  photo_url?: string
}

interface AuthResponse {
  access_token: string
  token_type: string
  user: Account
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? 'The SMARTGATE service could not complete this request.')
  }

  return response.json() as Promise<T>
}

function saveSession(auth: AuthResponse): Account {
  sessionStorage.setItem(TOKEN_KEY, auth.access_token)
  return auth.user
}

export async function login(email: string, password: string): Promise<Account> {
  const auth = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return saveSession(auth)
}

export async function getCurrentUser(): Promise<Account> {
  return request<Account>('/auth/me', { headers: authHeaders() })
}

export async function verifyDepartmentQr(qrValue: string): Promise<StudentVerification> {
  return request<StudentVerification>('/students/verify-department-qr', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ qr_value: qrValue }),
  })
}

export async function getCollege(): Promise<CollegeProfile> {
  return request<CollegeProfile>('/admin/college', { headers: authHeaders() })
}

export async function getCollegeBranding(): Promise<CollegeBranding> {
  return request<CollegeBranding>('/college/branding', { headers: authHeaders() })
}

export async function createCollege(payload: Omit<CollegeProfile, 'id'>): Promise<CollegeProfile> {
  return request<CollegeProfile>('/admin/college', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function createCollegeAdmin(payload: CollegeAdminCreate): Promise<Account> {
  return request<Account>('/super-admin/college-admins', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function updateCollege(payload: Omit<CollegeProfile, 'id'>): Promise<CollegeProfile> {
  return request<CollegeProfile>('/admin/college', {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function uploadProfileImage(image: File): Promise<string> {
  const form = new FormData()
  form.append('image', image)
  const response = await fetch(`${API_BASE_URL}/admin/profile-images`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? 'The profile image could not be uploaded.')
  }
  const result = await response.json() as { photo_url: string }
  return result.photo_url
}

export async function updateCollegePhoto(photoUrl: string | null): Promise<CollegeProfile> {
  return request<CollegeProfile>('/admin/college/photo', {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ photo_url: photoUrl }),
  })
}

export async function updateUserPhoto(userId: number, photoUrl: string | null): Promise<Account> {
  return request<Account>(`/admin/users/${userId}/photo`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ photo_url: photoUrl }),
  })
}

export function resolvePhotoUrl(photoUrl: string | null | undefined): string | null {
  return photoUrl ? new URL(photoUrl, API_BASE_URL).toString() : null
}

export async function getDepartments(): Promise<Department[]> {
  return request<Department[]>('/admin/departments', { headers: authHeaders() })
}

export async function deleteDepartment(departmentId: number): Promise<{ ok: boolean; deleted_department_id: number }> {
  return request<{ ok: boolean; deleted_department_id: number }>(`/admin/departments/${departmentId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
}

export async function createDepartment(payload: { code: string; name: string }): Promise<Department> {
  return request<Department>('/admin/departments', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function getGates(): Promise<Gate[]> {
  return request<Gate[]>('/admin/gates', { headers: authHeaders() })
}

export async function getHodGates(): Promise<Gate[]> {
  return request<Gate[]>('/hod/gates', { headers: authHeaders() })
}

export async function createGate(payload: { code: string; name: string }): Promise<Gate> {
  return request<Gate>('/admin/gates', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function getAdminUsers(filters: { role?: string; departmentId?: number } = {}): Promise<Account[]> {
  const query = new URLSearchParams()
  if (filters.role) query.set('role', filters.role)
  if (filters.departmentId) query.set('department_id', String(filters.departmentId))
  const suffix = query.size ? `?${query.toString()}` : ''
  return request<Account[]>(`/admin/users${suffix}`, { headers: authHeaders() })
}

export async function deleteUser(userId: number): Promise<{ ok: boolean; deleted_user_id: number }> {
  return request<{ ok: boolean; deleted_user_id: number }>(`/admin/users/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
}

export async function getWorkspaceContacts(): Promise<Account[]> {
  return request<Account[]>('/workspace/contacts', { headers: authHeaders() })
}

export async function createHod(departmentId: number, payload: DemoAccountCreate): Promise<Account> {
  return request<Account>(`/admin/departments/${departmentId}/hod`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function createAdvisor(payload: DemoAccountCreate & {
  department_id: number
  year: string
  section: string
}): Promise<Account> {
  return request<Account>('/admin/advisors', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function createSecurityAccount(payload: DemoAccountCreate & { gate_id: number }): Promise<Account> {
  return request<Account>('/admin/security-staff', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function createStudentAccount(payload: StudentAccountCreate): Promise<Account> {
  return request<Account>('/admin/students', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function createStaffStudentAccount(payload: StudentAccountCreate): Promise<Account> {
  return request<Account>('/staff/students', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
  })
}

export async function getAdminDepartmentQrs(): Promise<DepartmentQr[]> {
  return request<DepartmentQr[]>('/admin/department-qrs', { headers: authHeaders() })
}

export async function getHodDepartmentQrs(): Promise<DepartmentQr[]> {
  return request<DepartmentQr[]>('/hod/department-qrs', { headers: authHeaders() })
}

export async function createDepartmentQr(departmentId: number, gateId: number, isHod = false): Promise<DepartmentQr> {
  const base = isHod ? '/hod' : '/admin'
  return request<DepartmentQr>(`${base}/departments/${departmentId}/gates/${gateId}/qr`, {
    method: 'POST', headers: authHeaders(),
  })
}

export async function setDepartmentQrStatus(qrId: number, status: 'active' | 'disabled', isHod = false): Promise<DepartmentQr> {
  const base = isHod ? '/hod' : '/admin'
  return request<DepartmentQr>(`${base}/department-qrs/${qrId}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status }),
  })
}

export async function getStaffAssignments(): Promise<StaffAssignments> {
  return request<StaffAssignments>('/staff/assignments', { headers: authHeaders() })
}

export async function getStaffLateRequests(): Promise<LateRequest[]> {
  return request<LateRequest[]>('/staff/late-requests', { headers: authHeaders() })
}

export async function approveStaffLateRequest(requestId: number, decisionNote?: string): Promise<LateRequest> {
  return request<LateRequest>(`/staff/late-requests/${requestId}/approve`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(decisionNote ? { decision_note: decisionNote } : {}),
  })
}

export async function rejectStaffLateRequest(requestId: number, decisionNote?: string): Promise<LateRequest> {
  return request<LateRequest>(`/staff/late-requests/${requestId}/reject`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(decisionNote ? { decision_note: decisionNote } : {}),
  })
}

export async function getSecurityDepartmentQrs(): Promise<DepartmentQr[]> {
  return request<DepartmentQr[]>('/security/department-qrs', { headers: authHeaders() })
}

export async function submitLateEntryRequest(reason: string): Promise<LateRequest> {
  return request<LateRequest>('/late-requests', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ reason }),
  })
}

export async function getStudentLateRequest(requestId: number): Promise<LateRequest> {
  return request<LateRequest>(`/students/late-requests/${requestId}`, { headers: authHeaders() })
}

export async function getStudentLateRequestHistory(): Promise<LateRequestHistoryItem[]> {
  return request<LateRequestHistoryItem[]>('/students/late-requests', { headers: authHeaders() })
}

export async function getStaffLateRequestHistory(): Promise<LateRequestHistoryItem[]> {
  return request<LateRequestHistoryItem[]>('/staff/late-requests/history', { headers: authHeaders() })
}

export async function getAdminLateRequestHistory(): Promise<LateRequestHistoryItem[]> {
  return request<LateRequestHistoryItem[]>('/admin/late-requests', { headers: authHeaders() })
}

export async function getStudentPermissions(): Promise<LatePermission[]> {
  return request<LatePermission[]>('/students/permissions', { headers: authHeaders() })
}

export async function getSecurityApprovedStudents(): Promise<LatePermission[]> {
  return request<LatePermission[]>('/security/approved-students', { headers: authHeaders() })
}

export async function confirmSecurityEntry(permissionId: string): Promise<GateEntryEvent> {
  return request<GateEntryEvent>(`/security/permissions/${encodeURIComponent(permissionId)}/enter`, {
    method: 'POST',
    headers: authHeaders(),
  })
}

export async function getSecurityEntryHistory(): Promise<GateEntryEvent[]> {
  return request<GateEntryEvent[]>('/security/entry-history', { headers: authHeaders() })
}

export async function getMessages(afterId = 0): Promise<DirectMessagePage> {
  return request<DirectMessagePage>(`/messages?after_id=${afterId}`, { headers: authHeaders() })
}

export async function sendMessage(
  recipientId: number,
  body: string,
  clientMessageId = crypto.randomUUID(),
): Promise<DirectMessage> {
  return request<DirectMessage>('/messages', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({
      recipient_id: recipientId,
      client_message_id: clientMessageId,
      body,
    }),
  })
}

export async function acknowledgeMessage(messageId: number): Promise<DirectMessage> {
  return request<DirectMessage>(`/messages/${messageId}/ack`, {
    method: 'POST', headers: authHeaders(),
  })
}

export async function deleteMessage(messageId: number): Promise<{ ok: boolean; message_id: number }> {
  return request<{ ok: boolean; message_id: number }>(`/messages/${messageId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
}

export async function createRealtimeTicket(): Promise<{ ticket: string; expires_at: string }> {
  return request<{ ticket: string; expires_at: string }>('/realtime/ticket', {
    method: 'POST', headers: authHeaders(),
  })
}

export function connectRealtime(ticket: string): WebSocket {
  const socketUrl = new URL('/ws/messages', API_BASE_URL)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  socketUrl.searchParams.set('ticket', ticket)
  return new WebSocket(socketUrl)
}

export function authHeaders(): HeadersInit {
  const token = sessionStorage.getItem(TOKEN_KEY)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function hasSession(): boolean {
  return Boolean(sessionStorage.getItem(TOKEN_KEY))
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}
