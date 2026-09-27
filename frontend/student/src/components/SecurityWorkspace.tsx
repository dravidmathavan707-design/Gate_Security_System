import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, Clock3, DoorOpen, RefreshCw, ScanLine, ShieldCheck, UserCheck } from 'lucide-react'
import { getSecurityApprovedStudents, getSecurityDepartmentQrs, type Account, type DepartmentQr, type LatePermission } from '../services/api'
import { DepartmentQrPreview } from './DepartmentQrPreview'
import { InboxPanel } from './InboxPanel'

interface SecurityWorkspaceProps {
  account: Account
  onSignOut: () => void
}

export function SecurityWorkspace({ account, onSignOut }: SecurityWorkspaceProps) {
  const [qrs, setQrs] = useState<DepartmentQr[]>([])
  const [permissions, setPermissions] = useState<LatePermission[]>([])
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [selectedPermission, setSelectedPermission] = useState<LatePermission | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      getSecurityDepartmentQrs(),
      getSecurityApprovedStudents(),
    ])
      .then(([items, queue]) => {
        if (active) {
          setQrs(items)
          setPermissions(queue)
          setSelectedPermission((current) => current && queue.some((permission) => permission.permission_id === current.permission_id) ? current : null)
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load the assigned gate directory.')
      })
    return () => { active = false }
  }, [refreshKey])

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
    entered: 0,
    expired: 0,
  }), [permissions, visiblePermissions.length])

  const currentPermission = selectedPermission ?? visiblePermissions[0] ?? null

  return (
    <main className="workspace-area workspace-security-area">
      <header className="workspace-welcome">
        <div>
          <p className="workspace-eyebrow">CAMPUS OPERATIONS / SECURITY</p>
          <h1>{account.gate_assignment ?? 'Assigned gate'} <span>·</span> Security</h1>
          <p>{account.full_name} · Gate control dashboard</p>
        </div>
        <div className="workspace-welcome-actions">
          <button className="workspace-quiet-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15} /> Refresh</button>
          <button className="workspace-quiet-button" type="button" onClick={onSignOut}><span>Sign out</span></button>
        </div>
      </header>

      {error && <div className="workspace-alert"><CircleAlert size={15} />{error}</div>}

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
              <span className="workspace-eyebrow">APPROVED STUDENTS / LIVE</span>
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
                    onClick={() => setSelectedPermission(permission)}
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

          <div className="workspace-qr-grid">
            {orderedQrs.map((qr) => (
              <article key={qr.id} className="workspace-qr-item">
                <div className="workspace-qr-code-label">{qr.department_code}</div>
                <DepartmentQrPreview value={qr.qr_payload} label={`${qr.department_code} ${qr.gate_name} QR`} size={92} />
                <div className="workspace-qr-gate-name">{qr.gate_code}</div>
                <span className={`workspace-qr-status ${qr.status === 'active' ? 'is-active' : 'is-quiet'}`}>{qr.status.toUpperCase()}</span>
              </article>
            ))}
            {orderedQrs.length === 0 && <p className="workspace-muted">No department QR records are available for this gate.</p>}
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
                <button type="button" className="workspace-quiet-button" onClick={() => setSelectedPermission(null)}>Cancel</button>
                <button type="button" className="primary-button" onClick={() => setSelectedPermission(null)}><Check size={15} /> Inside gate</button>
              </div>
            </div>
          </div>
        </section>
      )}

      <InboxPanel account={account} />
    </main>
  )
}
