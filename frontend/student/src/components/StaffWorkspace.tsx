import { useEffect, useState, type FormEvent } from 'react'
import { BadgeCheck, Check, CircleAlert, ClipboardCheck, Eye, EyeOff, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  approveStaffLateRequest,
  createDepartmentQr,
  createStaffStudentAccount,
  getHodDepartmentQrs,
  getHodGates,
  getStaffAssignments,
  getStaffLateRequests,
  getStaffLateRequestHistory,
  rejectStaffLateRequest,
  setDepartmentQrStatus,
  type Account,
  type DepartmentQr,
  type Gate,
  type LateRequest,
  type LateRequestHistoryItem,
  type StaffAssignments,
} from '../services/api'
import { DepartmentQrPreview } from './DepartmentQrPreview'
import { InboxPanel } from './InboxPanel'
import { LateRequestHistoryList } from './LateRequestHistoryList'

interface StaffWorkspaceProps {
  account: Account
  onSignOut: () => void
}

export function StaffWorkspace({ account, onSignOut }: StaffWorkspaceProps) {
  const [assignments, setAssignments] = useState<StaffAssignments | null>(null)
  const [qrs, setQrs] = useState<DepartmentQr[]>([])
  const [gates, setGates] = useState<Gate[]>([])
  const [selectedGate, setSelectedGate] = useState('')
  const [lateRequests, setLateRequests] = useState<LateRequest[]>([])
  const [lateRequestHistory, setLateRequestHistory] = useState<LateRequestHistoryItem[]>([])
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showStudentForm, setShowStudentForm] = useState(false)
  const isHod = account.role === 'hod'
  const canReviewLateRequests = account.role === 'hod' || account.role === 'advisor'

  useEffect(() => {
    let active = true
    const requests: [Promise<StaffAssignments>, Promise<DepartmentQr[]>, Promise<Gate[]>, Promise<LateRequest[]>, Promise<LateRequestHistoryItem[]>] = [
      getStaffAssignments(),
      isHod ? getHodDepartmentQrs() : Promise.resolve([]),
      isHod ? getHodGates() : Promise.resolve([]),
      canReviewLateRequests ? getStaffLateRequests() : Promise.resolve([]),
      canReviewLateRequests ? getStaffLateRequestHistory() : Promise.resolve([]),
    ]
    Promise.all(requests)
      .then(([assignmentData, qrData, gateData, staffLateRequests, staffHistory]) => {
        if (!active) return
        setAssignments(assignmentData)
        setQrs(qrData)
        setGates(gateData)
        setLateRequests(staffLateRequests)
        setLateRequestHistory(staffHistory)
        setSelectedGate((current) => current || String(gateData[0]?.id ?? ''))
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load staff assignments.')
      })
    return () => { active = false }
  }, [canReviewLateRequests, isHod, refreshKey])

  async function toggleQr(qr: DepartmentQr) {
    setIsBusy(true)
    setError('')
    try {
      await setDepartmentQrStatus(qr.id, qr.status === 'active' ? 'disabled' : 'active', true)
      setNotice(`Department QR ${qr.status === 'active' ? 'disabled' : 'reactivated'}.`)
      setRefreshKey((value) => value + 1)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'QR status could not be changed.')
    } finally { setIsBusy(false) }
  }

  async function makeQr() {
    if (!assignments || !selectedGate) return
    setIsBusy(true)
    setError('')
    try {
      await createDepartmentQr(assignments.department_id, Number(selectedGate), true)
      setNotice('Fixed department gate QR created.')
      setRefreshKey((value) => value + 1)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'QR could not be created.')
    } finally { setIsBusy(false) }
  }

  async function handleCreateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assignments) return
    const values = new FormData(event.currentTarget)
    setIsBusy(true)
    setError('')
    try {
      await createStaffStudentAccount({
        email: String(values.get('email')),
        full_name: String(values.get('full_name')),
        password: String(values.get('password')),
        student_id: String(values.get('student_id')),
        register_number: String(values.get('register_number')),
        department_id: assignments.department_id,
        year: String(values.get('year')),
        section: String(values.get('section')),
        parent_name: String(values.get('parent_name') || '') || undefined,
        parent_phone: String(values.get('parent_phone') || '') || undefined,
        parent_email: String(values.get('parent_email') || '') || undefined,
        parent_relationship: String(values.get('parent_relationship') || '') || undefined,
      })
      event.currentTarget?.reset?.()
      setShowStudentForm(false)
      setNotice('Student account created. Deletion remains Admin-only.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Student account could not be created.')
    } finally { setIsBusy(false) }
  }

  async function handleLateDecision(requestId: number, action: 'approve' | 'reject') {
    setIsBusy(true)
    setError('')
    try {
      const note = decisionNotes[requestId]?.trim()
      if (action === 'approve') {
        await approveStaffLateRequest(requestId, note)
        setNotice('Late-entry request approved.')
      } else {
        await rejectStaffLateRequest(requestId, note)
        setNotice('Late-entry request rejected.')
      }
      setDecisionNotes((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      setRefreshKey((value) => value + 1)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The late-entry decision could not be updated.')
    } finally { setIsBusy(false) }
  }

  return (
    <main className="workspace-area">
      <header className="workspace-welcome">
        <div>
          <p className="workspace-eyebrow">ACADEMIC WORKSPACE / {isHod ? 'HEAD OF DEPARTMENT' : 'CLASS ADVISOR'}</p>
          <h1>{assignments?.department_code ?? 'Department'} <span>·</span> {account.full_name}</h1>
          <p>{assignments?.department_name ?? 'Loading department assignment'} · {assignments?.classes.length ?? 0} assigned class sections</p>
        </div>
        <div className="workspace-welcome-actions">
          <button className="workspace-quiet-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15} /> Refresh</button>
          <button className="workspace-quiet-button" type="button" onClick={onSignOut}><span>Sign out</span></button>
        </div>
      </header>

      {notice && <div className="workspace-notice"><Check size={15} />{notice}</div>}
      {error && <div className="workspace-alert"><CircleAlert size={15} />{error}</div>}

      <section className="workspace-stat-grid staff-stat-grid">
        <article><span>Role</span><b>{isHod ? 'Department HOD' : 'Class advisor'}</b><small>Verified by your account</small></article>
        <article><span>Department</span><b>{assignments?.department_code ?? '—'}</b><small>{assignments?.department_name ?? 'Loading'}</small></article>
        <article><span>Assigned classes</span><b>{assignments?.classes.length ?? '—'}</b><small>Current academic year</small></article>
        <article><span>Department QR</span><b>{isHod ? qrs.filter((qr) => qr.status === 'active').length : 'View only'}</b><small>{isHod ? 'Active gate codes' : 'Managed by department HOD'}</small></article>
      </section>

      <section className="workspace-main-grid">
        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">CURRENT ASSIGNMENTS</span><h2>Class sections</h2></div><ClipboardCheck size={18} /></div>
          <div className="workspace-list">
            {assignments?.classes.map((classAssignment) => <div className="workspace-list-row" key={`${classAssignment.year}-${classAssignment.section}`}>
              <span className="department-code">{classAssignment.year}<br />{classAssignment.section}</span>
              <span><b>{assignments.department_code} · {classAssignment.year} year · Section {classAssignment.section}</b><small>Advisor · {classAssignment.advisor_name}</small></span>
            </div>)}
            {assignments?.classes.length === 0 && <p className="workspace-muted">No current class assignments are configured for this account.</p>}
          </div>
          <div className="workspace-authority-note"><ShieldCheck size={16} /><span>Late-entry approvals are active for this department. Pending requests are reviewed in the approval panel below.</span></div>
        </div>

        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">FIXED GATE CODES</span><h2>{isHod ? 'Department QRs' : 'HOD-managed QRs'}</h2></div><BadgeCheck size={18} /></div>
          {isHod && gates.length > 0 && <div className="workspace-create-qr">
            <label className="workspace-field"><span>Assign to gate</span><select value={selectedGate} onChange={(event) => setSelectedGate(event.target.value)}>{gates.map((gate) => <option key={gate.id} value={gate.id}>{gate.code} · {gate.name}</option>)}</select></label>
            <button className="primary-button" type="button" onClick={() => void makeQr()} disabled={isBusy}><Check size={15} /> Create fixed QR</button>
          </div>}
          <div className="workspace-list">
            {qrs.map((qr) => <div className="workspace-list-row workspace-qr-row" key={qr.id}>
              <span className={`gate-status ${qr.status === 'active' ? 'is-active' : ''}`} />
              <span>
                <b>{qr.department_code} / {qr.gate_name}</b>
                <small>{qr.status.toUpperCase()} · QR #{qr.id}</small>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <DepartmentQrPreview value={qr.qr_payload} label={`${qr.department_code} ${qr.gate_name} QR`} size={110} />
                  <code style={{ maxWidth: '240px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{qr.qr_payload}</code>
                </div>
              </span>
              {isHod && <button className="workspace-quiet-button" type="button" disabled={isBusy} onClick={() => void toggleQr(qr)}>{qr.status === 'active' ? 'Disable' : 'Activate'}</button>}
            </div>)}
            {isHod && qrs.length === 0 && <p className="workspace-muted">No gate QR is registered for this department.</p>}
            {!isHod && <p className="workspace-muted">Your HOD manages department QR codes.</p>}
          </div>
        </div>

        <div className="workspace-panel staff-student-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">STUDENT ACCESS / CREATE ONLY</span><h2>Add a student</h2></div><ClipboardCheck size={18} /></div>
          <div className="workspace-action-row"><p className="workspace-muted">{isHod ? 'Create students for your department classes.' : 'Create students only for your assigned class.'} Student deletion is available only to Admin.</p><button className="primary-button" type="button" onClick={() => setShowStudentForm((value) => !value)}>{showStudentForm ? 'Hide form' : 'Add student'}</button></div>
          {showStudentForm ? (
            <form className="workspace-form" onSubmit={handleCreateStudent}>
              <label className="workspace-field"><span>Student full name</span><input name="full_name" required minLength={2} /></label>
              <label className="workspace-field"><span>Student email</span><input name="email" type="email" required /></label>
              <label className="workspace-field"><span>Temporary password</span><span className="auth-password-control"><input name="password" type={showPassword ? 'text' : 'password'} minLength={12} required /><button className="auth-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
              <div className="workspace-inline-fields"><label className="workspace-field"><span>Student ID</span><input name="student_id" required /></label><label className="workspace-field"><span>Register number</span><input name="register_number" required /></label></div>
              <div className="workspace-inline-fields"><label className="workspace-field"><span>Year</span><input name="year" placeholder="II" required /></label><label className="workspace-field"><span>Section</span><input name="section" placeholder="A" required /></label></div>
              <label className="workspace-field"><span>Parent name</span><input name="parent_name" /></label>
              <label className="workspace-field"><span>Parent phone</span><input name="parent_phone" /></label>
              <button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Creating…' : <>Create student <Check size={15} /></>}</button>
            </form>
          ) : (
            <p className="workspace-muted" style={{ marginTop: '14px' }}>Use Add student to open the student form and create a new learner record.</p>
          )}
        </div>
      </section>

      {canReviewLateRequests && (
        <section className="workspace-panel late-approval-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">LATE ENTRY APPROVAL</span><h2>Pending requests</h2></div><ShieldCheck size={18} /></div>
          {lateRequests.length === 0 ? (
            <div className="workspace-empty-state"><div className="workspace-empty-mark"><ClipboardCheck size={18} /></div><b>No pending requests</b><p>Late entry approvals for this department will appear here as soon as students submit them.</p></div>
          ) : (
            <div className="late-request-list">
              {lateRequests.map((request) => (
                <article className="late-request-card" key={request.id}>
                  <div className="late-request-header">
                    <div>
                      <span className="late-request-label">Student #{request.student_id}</span>
                      <h3>Department #{request.department_id}</h3>
                    </div>
                    <span className="late-request-status">{request.status}</span>
                  </div>
                  <p className="late-request-reason">{request.reason}</p>
                  <p className="late-request-meta">Requested {new Date(request.requested_at).toLocaleString()}</p>
                  <label className="workspace-field late-request-note">
                    <span>Decision note</span>
                    <textarea
                      rows={3}
                      value={decisionNotes[request.id] ?? ''}
                      onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                      placeholder="Optional note for approval or rejection"
                    />
                  </label>
                  <div className="late-request-actions">
                    <button className="workspace-quiet-button danger-button" type="button" disabled={isBusy} onClick={() => void handleLateDecision(request.id, 'reject')}>Reject</button>
                    <button className="primary-button" type="button" disabled={isBusy} onClick={() => void handleLateDecision(request.id, 'approve')}>Approve</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {canReviewLateRequests && (
        <section className="workspace-panel late-history-panel">
          <div className="workspace-section-heading">
            <div><span className="workspace-eyebrow">{isHod ? 'DEPARTMENT RECORDS' : 'ASSIGNED CLASS RECORDS'}</span><h2>Late-entry history</h2></div>
            <ClipboardCheck size={18} />
          </div>
          <LateRequestHistoryList
            entries={lateRequestHistory}
            emptyMessage="Reviewed and pending late-entry requests for your assigned scope will appear here."
          />
        </section>
      )}

      <InboxPanel account={account} />
    </main>
  )
}
