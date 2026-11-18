import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, Clock3, DoorOpen, House, MoreVertical, RefreshCw, ScanLine, ShieldCheck, UserCheck } from 'lucide-react'
import { confirmSecurityEntry, getSecurityApprovedStudents, getSecurityDepartmentQrs, getSecurityEntryHistory, getSecurityOfflineSnapshot, syncSecurityOfflineEntries, type Account, type DepartmentQr, type GateEntryEvent, type LatePermission, type OfflineEntrySyncItem, type OfflineSecuritySnapshot } from '../services/api'
import { loadOfflineCache, offlineEntryEvent, saveOfflineCache, verifyCachedPermission, verifyOfflineSnapshot, type OfflineCache } from '../services/offlineSecurity'
import { DepartmentQrPreview } from './DepartmentQrPreview'
import { InboxPanel } from './InboxPanel'

interface SecurityWorkspaceProps {
  account: Account
  onSignOut: () => void
}

export function SecurityWorkspace({ account, onSignOut }: SecurityWorkspaceProps) {
  const [qrs, setQrs] = useState<DepartmentQr[]>([])
  const [permissions, setPermissions] = useState<LatePermission[]>([])
  const [entryHistory, setEntryHistory] = useState<GateEntryEvent[]>([])
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [qrDepartmentFilter, setQrDepartmentFilter] = useState('all')
  const [selectedPermission, setSelectedPermission] = useState<LatePermission | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [copiedQrId, setCopiedQrId] = useState<number | null>(null)
  const [entryFeedback, setEntryFeedback] = useState('')
  const [isConfirmingEntry, setIsConfirmingEntry] = useState(false)
  const [isQuickMenuOpen, setIsQuickMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState<'dashboard' | 'history'>('dashboard')
  const [error, setError] = useState('')
  const [offlineWarning, setOfflineWarning] = useState('')
  const [connectionMode, setConnectionMode] = useState<'online' | 'offline' | 'expired'>('online')
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  useEffect(() => {
    let active = true
    const isNetworkFailure = (requestError: unknown) => !navigator.onLine || requestError instanceof TypeError
    const loadWorkspace = async () => {
      let cache: OfflineCache | null = null
      try {
        cache = loadOfflineCache(account.id)
        const [items, queue, history] = await Promise.all([
          getSecurityDepartmentQrs(),
          getSecurityApprovedStudents(),
          getSecurityEntryHistory(),
        ])
        let snapshot: OfflineSecuritySnapshot | null = null
        let snapshotQueue: LatePermission[] = []
        let warning = ''
        try {
          const receivedSnapshot = await getSecurityOfflineSnapshot()
          snapshotQueue = await verifyOfflineSnapshot(receivedSnapshot, account)
          snapshot = receivedSnapshot
        } catch (snapshotError) {
          warning = snapshotError instanceof Error
            ? snapshotError.message
            : 'Offline verification is not configured for this device.'
        }

        const attemptedPermissionIds = new Set<string>()
        const syncedEvents: GateEntryEvent[] = []
        if (snapshot) {
          const nextCache: OfflineCache = {
            snapshot,
            pending: cache?.pending ?? [],
            rejected: cache?.rejected ?? [],
          }
          if (nextCache.pending.length > 0) {
            try {
              const payload: OfflineEntrySyncItem[] = nextCache.pending.map(
                ({ client_event_id, signed_token, verified_at, entered_at }) => ({
                  client_event_id,
                  signed_token,
                  verified_at,
                  entered_at,
                }),
              )
              const results = await syncSecurityOfflineEntries(payload)
              const resultsById = new Map(results.map((result) => [result.client_event_id, result]))
              const pendingEntries = nextCache.pending.filter((entry) => !resultsById.has(entry.client_event_id))
              const rejectedEntries = [...nextCache.rejected]
              for (const entry of nextCache.pending) {
                const result = resultsById.get(entry.client_event_id)
                if (!result) continue
                attemptedPermissionIds.add(entry.event.permission_id)
                if (result.status === 'synced' && result.event) {
                  syncedEvents.push(result.event)
                } else {
                  rejectedEntries.push({
                    ...entry,
                    reason: result.reason ?? 'The server rejected this offline entry. Contact an administrator.',
                  })
                }
              }
              nextCache.pending = pendingEntries
              nextCache.rejected = rejectedEntries
            } catch (syncError) {
              if (!isNetworkFailure(syncError)) {
                warning = syncError instanceof Error ? syncError.message : 'Offline entries could not be synchronized.'
              }
            }
          }
          cache = nextCache
          saveOfflineCache(account.id, cache)
          setLastSyncAt(snapshot.issued_at)
        } else if (cache) {
          setLastSyncAt(cache.snapshot.issued_at)
        }

        for (const entry of [...(cache?.pending ?? []), ...(cache?.rejected ?? [])]) {
          attemptedPermissionIds.add(entry.event.permission_id)
        }
        const availableQueue = snapshot ? snapshotQueue : queue
        const nextPermissions = availableQueue.filter((permission) => !attemptedPermissionIds.has(permission.permission_id))
        const localEvents = [...(cache?.pending ?? []), ...(cache?.rejected ?? [])].map((entry) => entry.event)
        const mergedHistory = [...syncedEvents, ...localEvents, ...history]
        const uniqueHistory = mergedHistory.filter((event, index, all) =>
          all.findIndex((candidate) => candidate.client_event_id
            ? candidate.client_event_id === event.client_event_id
            : candidate.id === event.id) === index,
        )
        if (active) {
          setQrs(items)
          setPermissions(nextPermissions)
          setEntryHistory(uniqueHistory)
          setSelectedPermission((current) => current && nextPermissions.some((permission) => permission.permission_id === current.permission_id) ? current : null)
          setConnectionMode('online')
          setPendingSyncCount((cache?.pending.length ?? 0) + (cache?.rejected.length ?? 0))
          setOfflineWarning(warning)
          setError('')
        }
      } catch (requestError) {
        if (!active) return
        if (isNetworkFailure(requestError)) {
          try {
            cache = loadOfflineCache(account.id)
            if (!cache) throw new Error('No signed offline cache is available. Reconnect before verifying any permissions.')
            const cachedPermissions = await verifyOfflineSnapshot(cache.snapshot, account)
            const usedPermissionIds = new Set([
              ...cache.pending.map((entry) => entry.event.permission_id),
              ...cache.rejected.map((entry) => entry.event.permission_id),
            ])
            const validPermissions = cachedPermissions.filter(
              (permission) => !usedPermissionIds.has(permission.permission_id),
            )
            setPermissions(validPermissions)
            setEntryHistory([
              ...cache.rejected.map((entry) => entry.event),
              ...cache.pending.map((entry) => entry.event),
            ])
            setConnectionMode('offline')
            setLastSyncAt(cache.snapshot.issued_at)
            setPendingSyncCount(cache.pending.length + cache.rejected.length)
            setOfflineWarning('')
            setError('')
            setSelectedPermission((current) => current && validPermissions.some((permission) => permission.permission_id === current.permission_id) ? current : null)
          } catch (cacheError) {
            setPermissions([])
            setConnectionMode('expired')
            setLastSyncAt(cache?.snapshot.issued_at ?? null)
            setPendingSyncCount((cache?.pending.length ?? 0) + (cache?.rejected.length ?? 0))
            setError(cacheError instanceof Error ? cacheError.message : 'Offline verification is unavailable.')
          }
        } else {
          setError(requestError instanceof Error ? requestError.message : 'Could not load the assigned gate directory.')
        }
      }
    }
    void loadWorkspace()
    const refreshWhenOnline = () => setRefreshKey((value) => value + 1)
    window.addEventListener('online', refreshWhenOnline)
    window.addEventListener('offline', refreshWhenOnline)
    return () => {
      active = false
      window.removeEventListener('online', refreshWhenOnline)
      window.removeEventListener('offline', refreshWhenOnline)
    }
  }, [account, refreshKey])

  const orderedQrs = useMemo(() => {
    const departmentOrder: Record<string, number> = {
      CCE: 1,
      CSE: 2,
      ECE: 3,
      EEE: 4,
      MECH: 5,
      CIVIL: 6,
    }

    return [...qrs].sort((left, right) => {
      const leftCode = left.department_code?.toUpperCase() ?? ''
      const rightCode = right.department_code?.toUpperCase() ?? ''
      const leftOrder = departmentOrder[leftCode] ?? 999
      const rightOrder = departmentOrder[rightCode] ?? 999
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return (left.department_name ?? '').localeCompare(right.department_name ?? '')
    })
  }, [qrs])

  const departmentOptions = useMemo(
    () => ['all', ...new Set(orderedQrs.map((qr) => qr.department_code.toUpperCase()))],
    [orderedQrs],
  )

  const visibleQrs = useMemo(
    () => qrDepartmentFilter === 'all'
      ? orderedQrs
      : orderedQrs.filter((qr) => qr.department_code.toUpperCase() === qrDepartmentFilter),
    [orderedQrs, qrDepartmentFilter],
  )

  const visiblePermissions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return permissions.filter((permission) => {
      const matchesDepartment = departmentFilter === 'all' || permission.department_code?.toUpperCase() === departmentFilter
      const matchesSearch = !query || [
        permission.student_name,
        permission.department_code,
        permission.department_name,
        permission.approver_name,
        permission.approver_role,
      ].some((value) => value?.toLowerCase().includes(query))
      return matchesDepartment && matchesSearch
    })
  }, [departmentFilter, permissions, search])

  const stats = useMemo(() => ({
    approved: permissions.filter((permission) => permission.status === 'approved').length,
    waiting: visiblePermissions.length,
    entered: entryHistory.filter((event) => new Date(event.entered_at).toDateString() === new Date().toDateString()).length,
    expired: 0,
  }), [entryHistory, permissions, visiblePermissions.length])

  const currentPermission = selectedPermission

  function handleCancelEntry() {
    const studentName = currentPermission?.student_name ?? 'Student'
    setSelectedPermission(null)
    setEntryFeedback(`Entry check cancelled for ${studentName}. The approval remains in the waiting queue.`)
  }

  async function handleConfirmEntry(permission: LatePermission) {
    setIsConfirmingEntry(true)
    setError('')
    setEntryFeedback('')
    try {
      if (connectionMode === 'expired') {
        throw new Error('Offline verification has expired. Reconnect and synchronize before allowing another entry.')
      }
      if (connectionMode === 'offline') {
        const cache = loadOfflineCache(account.id)
        if (!cache) throw new Error('No signed offline cache is available. Reconnect before verifying any permissions.')
        const verified = await verifyCachedPermission(cache.snapshot, permission.permission_id, account)
        const timestamp = new Date().toISOString()
        const clientEventId = crypto.randomUUID()
        const event = offlineEntryEvent(
          verified.permission,
          account,
          clientEventId,
          timestamp,
          verified.signedToken,
        )
        const queuedEntry = {
          client_event_id: clientEventId,
          signed_token: verified.signedToken,
          verified_at: timestamp,
          entered_at: timestamp,
          event,
        }
        cache.pending.push(queuedEntry)
        saveOfflineCache(account.id, cache)
        setEntryHistory((current) => [event, ...current])
        setPermissions((current) => current.filter((item) => item.permission_id !== permission.permission_id))
        setPendingSyncCount((count) => count + 1)
        setSelectedPermission(null)
        setEntryFeedback(`${event.student_name} recorded locally in OFFLINE mode. It will sync when the connection returns.`)
        return
      }
      const event = await confirmSecurityEntry(permission.permission_id)
      setEntryHistory((current) => [event, ...current.filter((item) => item.id !== event.id)])
      setPermissions((current) => current.filter((item) => item.permission_id !== permission.permission_id))
      setSelectedPermission(null)
      setEntryFeedback(`${event.student_name} confirmed inside ${event.gate_name}. Entry saved to gate history.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not confirm this gate entry.')
    } finally {
      setIsConfirmingEntry(false)
    }
  }

  async function handleCopyQrPayload(qrId: number, payload: string) {
    try {
      await navigator.clipboard.writeText(payload)
      setCopiedQrId(qrId)
      window.setTimeout(() => setCopiedQrId((current) => (current === qrId ? null : current)), 1400)
    } catch {
      setError('Could not copy the QR payload from this browser.')
    }
  }

  return (
    <main className="workspace-area workspace-security-area">
      <header className="workspace-welcome">
        <div>
          <p className="workspace-eyebrow">CAMPUS OPERATIONS / SECURITY</p>
          <h1>{account.gate_assignment ?? 'Assigned gate'} <span>·</span> Security</h1>
          <p>{account.full_name} · Gate control dashboard</p>
        </div>
        <div className="workspace-welcome-actions">
          <div className="workspace-quick-menu-wrap" onKeyDown={(event) => { if (event.key === 'Escape') setIsQuickMenuOpen(false) }}>
            <button
              className="workspace-quiet-button workspace-quick-menu-trigger"
              type="button"
              aria-label="Quick actions"
              aria-expanded={isQuickMenuOpen}
              aria-controls="security-quick-actions"
              title="Quick actions"
              onClick={() => setIsQuickMenuOpen((open) => !open)}
            >
              <MoreVertical size={17} />
            </button>
            {isQuickMenuOpen && <div id="security-quick-actions" className="workspace-quick-menu" role="group" aria-label="Quick actions">
              {activeView === 'dashboard' ? (
                <button className="workspace-quick-menu-item" type="button" onClick={() => { setActiveView('history'); setIsQuickMenuOpen(false) }}><Clock3 size={15} /> History</button>
              ) : (
                <button className="workspace-quick-menu-item" type="button" onClick={() => { setActiveView('dashboard'); setIsQuickMenuOpen(false) }}><House size={15} /> Dashboard</button>
              )}
            </div>}
          </div>
          <button className="workspace-quiet-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15} /> Refresh</button>
          <button className="workspace-quiet-button" type="button" onClick={onSignOut}><span>Sign out</span></button>
        </div>
      </header>

      {error && <div className="workspace-alert"><CircleAlert size={15} />{error}</div>}
      <div className={`workspace-connectivity-state is-${connectionMode}`} role="status">
        <span className="workspace-connectivity-dot" />
        <strong>{connectionMode === 'online' ? 'ONLINE' : connectionMode === 'offline' ? 'OFFLINE MODE' : 'OFFLINE EXPIRED'}</strong>
        <span>{connectionMode === 'online'
          ? `Server verification active${lastSyncAt ? ` · cache synced ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
          : connectionMode === 'offline'
            ? `Using signed permissions${lastSyncAt ? ` · last sync ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
            : 'Offline grace period expired; new entry verification is blocked.'}</span>
        {pendingSyncCount > 0 && <span>{pendingSyncCount} offline record{pendingSyncCount === 1 ? '' : 's'} awaiting sync/review</span>}
      </div>
      {offlineWarning && connectionMode === 'online' && <div className="workspace-notice"><CircleAlert size={14} />{offlineWarning}</div>}
      {entryFeedback && <div className="workspace-entry-feedback" role="status"><Check size={16} />{entryFeedback}</div>}

      {activeView === 'dashboard' && <>
      <section className="workspace-stat-grid staff-stat-grid">
        <article><span>Approved</span><b>{stats.approved}</b><small>Ready for gate check</small></article>
        <article><span>Waiting</span><b>{stats.waiting}</b><small>Valid permissions</small></article>
        <article><span>Entered</span><b>{stats.entered}</b><small>Completed today</small></article>
        <article><span>Expired</span><b>{stats.expired}</b><small>Past validity</small></article>
      </section>

      <section className="workspace-main-grid security-main-grid">
        <div className="workspace-panel workspace-queue-panel">
          <div className="workspace-section-heading">
            <div>
              <span className="workspace-eyebrow">APPROVED STUDENTS / {connectionMode === 'online' ? 'LIVE' : 'SIGNED CACHE'}</span>
              <h2>{visiblePermissions.length} waiting at gate</h2>
            </div>
            <DoorOpen size={18} />
          </div>

          <div className="workspace-filter-row">
            <label className="workspace-field">
              <span>Search student / register</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student or department" />
            </label>
            <label className="workspace-field">
              <span>Department</span>
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                {departmentOptions.map((item) => (
                  <option key={item} value={item}>{item === 'all' ? 'All departments' : item}</option>
                ))}
              </select>
            </label>
          </div>

          {visiblePermissions.length === 0 ? (
            <div className="workspace-queue-empty" style={{ minHeight: '180px' }}>
              <span className="workspace-empty-mark"><ShieldCheck size={22} /></span>
              <b>No active approvals</b>
              <p>There are currently no valid late-entry permissions waiting at {account.gate_assignment ?? 'this gate'}.</p>
            </div>
          ) : (
            <div className="workspace-queue-list">
              {visiblePermissions.map((permission) => (
                <article key={permission.permission_id} className="workspace-queue-item">
                  <div className="workspace-queue-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                      <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#dbeafe', display: 'grid', placeItems: 'center', fontWeight: 700, color: '#1d4ed8' }}>
                        {permission.student_name?.charAt(0)?.toUpperCase() ?? 'S'}
                      </div>
                      <div>
                        <strong style={{ display: 'block' }}>{permission.student_name ?? `Student ${permission.student_id}`}</strong>
                        <small style={{ color: '#475569' }}>{permission.department_code ?? 'Department'} · Approved access</small>
                      </div>
                    </div>
                    <span className="workspace-approval-badge">APPROVED</span>
                  </div>

                  <div className="workspace-queue-details">
                    <div><strong>Student</strong>{permission.student_name ?? `#${permission.student_id}`}</div>
                    <div><strong>Department</strong>{permission.department_code ?? '—'} · {permission.department_name ?? '—'}</div>
                    <div><strong>Late arrival</strong>{new Date(permission.valid_from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div><strong>Valid until</strong>{new Date(permission.valid_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>

                  <div className="workspace-queue-meta">
                    <span><Clock3 size={12} /> Approved by {permission.approver_name ?? 'Staff'} ({permission.approver_role})</span>
                    <span>{new Date(permission.approved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <button
                    type="button"
                    className="primary-button workspace-verify-button"
                    onClick={() => { setEntryFeedback(''); setSelectedPermission(permission) }}
                  >
                    <UserCheck size={15} /> Verify entry
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="workspace-panel workspace-qr-panel">
          <div className="workspace-section-heading">
            <div>
              <span className="workspace-eyebrow">DEPARTMENT QR</span>
              <h2>Gate directory</h2>
            </div>
            <ScanLine size={18} />
          </div>

          <label className="workspace-field">
            <span>QR department</span>
            <select value={qrDepartmentFilter} onChange={(event) => setQrDepartmentFilter(event.target.value)}>
              {departmentOptions.map((item) => (
                <option key={item} value={item}>{item === 'all' ? 'All departments' : item}</option>
              ))}
            </select>
          </label>

          <div className="workspace-qr-grid">
            {visibleQrs.map((qr) => (
              <article key={qr.id} className="workspace-qr-item">
                <div className="workspace-qr-code-label">{qr.department_code}</div>
                <DepartmentQrPreview value={qr.qr_payload} label={`${qr.department_code} ${qr.gate_name} QR`} size={92} />
                <div className="workspace-qr-gate-name">{qr.gate_code}</div>
                <div style={{ marginTop: '0.7rem', width: '100%', display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>QR payload</span>
                  <code style={{ display: 'block', width: '100%', maxWidth: '100%', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', fontSize: '0.68rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.55rem 0.65rem', color: '#0f172a' }}>{qr.qr_payload}</code>
                  <button
                    type="button"
                    className="workspace-quiet-button"
                    onClick={() => void handleCopyQrPayload(qr.id, qr.qr_payload)}
                    style={{ justifySelf: 'flex-start', marginTop: '0.1rem' }}
                  >
                    {copiedQrId === qr.id ? 'Copied' : 'Copy payload'}
                  </button>
                </div>
                <span className={`workspace-qr-status ${qr.status === 'active' ? 'is-active' : 'is-quiet'}`}>{qr.status.toUpperCase()}</span>
              </article>
            ))}
            {visibleQrs.length === 0 && <p className="workspace-muted">No department QR records are available for this gate.</p>}
          </div>

          <div className="workspace-authority-note"><ShieldCheck size={16} /><span>QR codes are created by admin or HOD and shown here in read-only, fixed department order.</span></div>
        </div>
      </section>

      {currentPermission && (
        <section className="workspace-panel workspace-entry-panel">
          <div className="workspace-section-heading">
            <div>
              <span className="workspace-eyebrow">ENTRY VERIFICATION</span>
              <h2>Confirm physical identity</h2>
            </div>
            <Check size={18} />
          </div>

          <div className="workspace-entry-layout">
            <div className="workspace-entry-avatar">
              {currentPermission.student_name?.charAt(0)?.toUpperCase() ?? 'S'}
            </div>

            <div className="workspace-entry-copy">
              <strong>{currentPermission.student_name ?? `Student ${currentPermission.student_id}`}</strong>
              <div>
                <span>{currentPermission.department_code ?? 'Department'} · {currentPermission.department_name ?? 'Late entry permission'}</span>
                <span>Approved by {currentPermission.approver_name ?? 'Staff'} ({currentPermission.approver_role})</span>
                <span>Valid until {new Date(currentPermission.valid_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="workspace-entry-actions">
                <button type="button" className="workspace-quiet-button" onClick={handleCancelEntry} disabled={isConfirmingEntry}>Cancel</button>
                <button type="button" className="primary-button" onClick={() => void handleConfirmEntry(currentPermission)} disabled={isConfirmingEntry || connectionMode === 'expired'}>
                  <Check size={15} /> {isConfirmingEntry ? 'Recording…' : connectionMode === 'offline' ? 'Record offline entry' : 'Inside gate'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      </>}

      {activeView === 'history' && <section id="security-entry-history" className="workspace-panel workspace-entry-history">
        <div className="workspace-section-heading">
          <div>
            <span className="workspace-eyebrow">ENTRY HISTORY / {entryHistory.length} RECORDED</span>
            <h2>Recent confirmed entries</h2>
          </div>
          <Clock3 size={18} />
        </div>
        {entryHistory.length === 0 ? (
          <div className="workspace-queue-empty workspace-history-empty">
            <span className="workspace-empty-mark"><DoorOpen size={20} /></span>
            <b>No entries recorded yet</b>
            <p>Confirmed student entries at {account.gate_assignment ?? 'this gate'} will appear here.</p>
          </div>
        ) : (
          <div className="workspace-entry-history-list">
            {entryHistory.map((event) => (
              <article className="workspace-entry-history-row" key={event.id}>
                <div>
                  <strong>{event.student_name}</strong>
                  <small>{event.register_number ?? `Student ${event.student_id}`} · {event.department_code ?? 'Department'}</small>
                </div>
                <div>
                  <b>{event.gate_code} · {event.gate_name}</b>
                  <small>Verified by {event.security_name}</small>
                </div>
                <time dateTime={event.entered_at}>{new Date(event.entered_at).toLocaleString()}</time>
              </article>
            ))}
          </div>
        )}
      </section>}

      {activeView === 'dashboard' && <InboxPanel
        account={account}
        departmentLabels={Object.fromEntries(qrs.map((qr) => [qr.department_id, `${qr.department_code} · ${qr.department_name}`]))}
        gateLabels={Object.fromEntries(qrs.map((qr) => [qr.gate_id, qr.gate_code]))}
      />}
    </main>
  )
}
