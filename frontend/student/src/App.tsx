import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  Clock3,
  CircleAlert,
  ClipboardCheck,
  Eye,
  EyeOff,
  Fingerprint,
  GraduationCap,
  KeyRound,
  LogOut,
  QrCode,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import './App.css'
import { clearSession, getCollegeBranding, getCurrentUser, getStudentLateRequest, getStudentLateRequestHistory, hasSession, login, resolvePhotoUrl, submitLateEntryRequest, verifyDepartmentQr, type Account, type CollegeBranding, type LateRequest, type LateRequestHistoryItem, type StudentVerification } from './services/api'
import { AdminWorkspace } from './components/AdminWorkspace'
import { SecurityWorkspace } from './components/SecurityWorkspace'
import { StaffWorkspace } from './components/StaffWorkspace'
import { SuperAdminWorkspace } from './components/SuperAdminWorkspace'
import { LateRequestHistoryList } from './components/LateRequestHistoryList'
import { ProfileAvatar } from './components/ProfileAvatar'
const QRScanner = lazy(() => import('./components/QRScanner').then(({ QRScanner: Scanner }) => ({ default: Scanner })))

type PortalRole = 'student' | 'staff' | 'security' | 'admin'

const portalRoles = [
  { id: 'student', title: 'Student entry', detail: 'Student identity and gate QR verification', icon: GraduationCap },
  { id: 'staff', title: 'HOD / advisor', detail: 'Academic staff access', icon: ClipboardCheck },
  { id: 'security', title: 'Security staff', detail: 'Assigned gate operations', icon: ShieldCheck },
  { id: 'admin', title: 'College admin', detail: 'College and account administration', icon: Settings2 },
] as const

function matchesPortalRole(role: string, portal: PortalRole): boolean {
  if (portal === 'student') return role === 'student'
  if (portal === 'staff') return role === 'hod' || role === 'advisor'
  if (portal === 'security') return role === 'security'
  return role === 'admin' || role === 'super_admin'
}

function portalForRole(role: string): PortalRole {
  if (role === 'hod' || role === 'advisor') return 'staff'
  if (role === 'security') return 'security'
  if (role === 'admin' || role === 'super_admin') return 'admin'
  return 'student'
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [collegeBranding, setCollegeBranding] = useState<CollegeBranding | null>(null)
  const [verifiedStudent, setVerifiedStudent] = useState<StudentVerification | null>(null)
  const [stage, setStage] = useState<'scan' | 'details' | 'status'>('scan')
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [lateReason, setLateReason] = useState('')
  const [lateRequest, setLateRequest] = useState<LateRequest | null>(null)
  const [statusRefreshError, setStatusRefreshError] = useState('')
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false)
  const [studentView, setStudentView] = useState<'checkin' | 'history'>('checkin')
  const [studentHistory, setStudentHistory] = useState<LateRequestHistoryItem[]>([])
  const [studentHistoryLoading, setStudentHistoryLoading] = useState(false)
  const [studentHistoryError, setStudentHistoryError] = useState('')
  const [studentHistoryRefreshKey, setStudentHistoryRefreshKey] = useState(0)
  const [scannerAttempt, setScannerAttempt] = useState(0)
  const [selectedRole, setSelectedRole] = useState<PortalRole | null>(null)
  const [isRestoring, setIsRestoring] = useState(() => hasSession())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [scannerError, setScannerError] = useState('')

  useEffect(() => {
    if (!hasSession()) {
      return
    }

    let active = true
    getCurrentUser()
      .then((currentUser) => {
        if (active) {
          setAccount(currentUser)
          setSelectedRole(portalForRole(currentUser.role))
        }
      })
      .catch(() => clearSession())
      .finally(() => {
        if (active) setIsRestoring(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!account) return
    let active = true
    getCollegeBranding()
      .then((branding) => { if (active) setCollegeBranding(branding) })
      .catch(() => { if (active) setCollegeBranding(null) })
    return () => { active = false }
  }, [account])

  useEffect(() => {
    const requestId = lateRequest?.id
    const requestStatus = lateRequest?.status
    if (account?.role !== 'student' || stage !== 'status' || !requestId || requestStatus !== 'pending_approval') return

    let active = true
    let requestInFlight = false
    const refreshStatus = async () => {
      if (requestInFlight) return
      requestInFlight = true
      try {
        const updatedRequest = await getStudentLateRequest(requestId)
        if (active) {
          setLateRequest(updatedRequest)
          setStatusRefreshError('')
        }
      } catch (requestError) {
        if (active) setStatusRefreshError(requestError instanceof Error ? requestError.message : 'Could not refresh request status.')
      } finally {
        requestInFlight = false
      }
    }

    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [account?.role, lateRequest?.id, lateRequest?.status, stage])

  useEffect(() => {
    if (account?.role !== 'student' || studentView !== 'history') return
    let active = true
    getStudentLateRequestHistory()
      .then((items) => {
        if (active) {
          setStudentHistory(items)
          setStudentHistoryError('')
        }
      })
      .catch((requestError) => {
        if (active) setStudentHistoryError(requestError instanceof Error ? requestError.message : 'Could not load your request history.')
      })
      .finally(() => {
        if (active) setStudentHistoryLoading(false)
      })
    return () => { active = false }
  }, [account?.role, lateRequest?.status, studentHistoryRefreshKey, studentView])

  async function refreshStudentRequestStatus() {
    if (!lateRequest) return
    setIsRefreshingStatus(true)
    try {
      const updatedRequest = await getStudentLateRequest(lateRequest.id)
      setLateRequest(updatedRequest)
      setStatusRefreshError('')
    } catch (requestError) {
      setStatusRefreshError(requestError instanceof Error ? requestError.message : 'Could not refresh request status.')
    } finally {
      setIsRefreshingStatus(false)
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!selectedRole) return
    setIsSubmitting(true)
    const values = new FormData(event.currentTarget)

    try {
      const account = await login(String(values.get('email')), String(values.get('password')))

      if (!matchesPortalRole(account.role, selectedRole)) {
        clearSession()
        throw new Error(`This account is registered as ${account.role.replace('_', ' ')}. Select its matching portal to continue.`)
      }
      setAccount(account)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Sign-in failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleQrValue(qrValue: string) {
    setError('')
    setScannerError('')
    setLateReason('')
    setLateRequest(null)
    setStatusRefreshError('')
    setIsSubmitting(true)
    try {
      const verified = await verifyDepartmentQr(qrValue.trim())
      setVerifiedStudent(verified)
      setIsConfirmed(false)
      setStage('details')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'QR verification failed.')
      setScannerAttempt((attempt) => attempt + 1)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleLateRequestSubmit() {
    if (!verifiedStudent) return
    const reason = lateReason.trim()
    if (!reason) {
      setError('Please add a brief reason before sending the late-entry request.')
      return
    }

    setIsSubmitting(true)
    setError('')
    try {
      const createdRequest = await submitLateEntryRequest(reason)
      setLateRequest(createdRequest)
      setStage('status')
      setLateReason('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The late-entry request could not be sent.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSignOut() {
    clearSession()
    setAccount(null)
    setCollegeBranding(null)
    setVerifiedStudent(null)
    setStage('scan')
    setSelectedRole(null)
    setLateReason('')
    setLateRequest(null)
    setStatusRefreshError('')
    setIsConfirmed(false)
    setStudentView('checkin')
    setStudentHistory([])
    setStudentHistoryError('')
    setError('')
  }

  if (isRestoring) {
    return <main className="loading-screen"><span className="loading-mark"><QrCode size={22} /></span><span>Connecting to SMARTGATE</span></main>
  }

  return (
    <div className="app-shell">
      <header className={`topbar ${account ? '' : 'gateway-topbar'}`}>
        <a className="brand" href="/" aria-label="SMARTGATE home">
          <span className="brand-mark">{collegeBranding?.photo_url ? <img src={resolvePhotoUrl(collegeBranding.photo_url) ?? undefined} alt="" /> : <QrCode size={19} strokeWidth={2.3} />}</span>
          <span>SMARTGATE<span className="brand-period">.</span></span>
        </a>
        {account ? (
          <div className="account-strip">
            <ProfileAvatar name={account.full_name} photoUrl={account.photo_url} size="small" />
            <span className="account-name">{account.full_name}</span>
            <button className="icon-button" type="button" onClick={handleSignOut} title="Sign out" aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        ) : (
          <span className="secure-label"><ShieldCheck size={15} /> COLLEGE ACCESS GATEWAY</span>
        )}
      </header>

      {account?.role === 'student' ? (
        <main className="content-area">
          <nav className="student-view-tabs" aria-label="Student sections">
            <button type="button" className={studentView === 'checkin' ? 'is-active' : ''} aria-pressed={studentView === 'checkin'} onClick={() => setStudentView('checkin')}>
              <QrCode size={16} /> Check in
            </button>
            <button type="button" className={studentView === 'history' ? 'is-active' : ''} aria-pressed={studentView === 'history'} onClick={() => {
              setStudentHistoryLoading(true)
              setStudentView('history')
            }}>
              <Clock3 size={16} /> Late-entry history
            </button>
          </nav>
          {studentView === 'history' ? (
            <section className="student-history-panel">
              <div className="page-heading student-history-heading">
                <div>
                  <p className="eyebrow"><span className="eyebrow-rule" /> STUDENT RECORDS <span className="eyebrow-divider">/</span> LATE ENTRY</p>
                  <h1>Your request history<span className="title-period">.</span></h1>
                  <p className="page-intro">Review request reasons, status, assigned staff, and decisions.</p>
                </div>
                <button className="text-button" type="button" onClick={() => {
                  setStudentHistoryLoading(true)
                  setStudentHistoryRefreshKey((value) => value + 1)
                }} disabled={studentHistoryLoading}>
                  <RefreshCw size={16} /> {studentHistoryLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              {studentHistoryError && <p className="error-message" role="alert"><CircleAlert size={16} />{studentHistoryError}</p>}
              {studentHistoryLoading && studentHistory.length === 0
                ? <div className="late-history-empty">Loading your late-entry history…</div>
                : <LateRequestHistoryList entries={studentHistory} emptyMessage="Your submitted late-entry requests will appear here." showStudent={false} />}
            </section>
          ) : (
            <>
          <div className="page-heading">
            <div>
              <p className="eyebrow"><span className="eyebrow-rule" /> STUDENT CHECK-IN <span className="eyebrow-divider">/</span> {stage === 'scan' ? 'IDENTITY' : stage === 'details' ? 'CONFIRM DETAILS' : 'REQUEST STATUS'}</p>
              <h1>{stage === 'status' ? 'Late-entry request' : 'Verify your identity'}<span className="title-period">.</span></h1>
              <p className="page-intro">{stage === 'status' ? 'Track your request while your assigned staff review it.' : 'A quick check before your campus entry request.'}</p>
            </div>
            <div className="step-count"><span>{stage === 'scan' ? '01' : stage === 'details' ? '02' : '03'}</span><i />03</div>
          </div>

          <div className="verification-layout">
            <aside className="step-rail" aria-label="Verification steps">
              <div className={`step-item ${stage === 'scan' ? 'is-current' : 'is-complete'}`}>
                <span className="step-icon">{stage === 'scan' ? <QrCode size={18} /> : <Check size={18} />}</span>
                <span><b>Department QR</b><small>Scan your gate code</small></span>
              </div>
              <div className="step-connector" />
              <div className={`step-item ${stage === 'details' ? 'is-current' : stage === 'status' ? 'is-complete' : ''}`}>
                <span className="step-icon">{stage === 'status' ? <Check size={18} /> : <Fingerprint size={18} />}</span>
                <span><b>Confirm details</b><small>Review your record</small></span>
              </div>
              <div className="step-connector" />
              <div className={`step-item ${stage === 'status' ? 'is-current' : ''}`}>
                <span className="step-icon">{lateRequest?.status === 'approved' ? <Check size={18} /> : <Clock3 size={18} />}</span>
                <span><b>Request status</b><small>{lateRequest?.status === 'approved' ? 'Approved' : lateRequest?.status === 'rejected' ? 'Declined' : 'Waiting'}</small></span>
              </div>
              <div className="rail-note"><ShieldCheck size={16} /><span>Identity is checked against your student account.</span></div>
            </aside>

            <section className="workflow-panel" key={stage}>
              {stage === 'scan' ? (
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">STEP 01 <span>/</span> SCAN</span>
                      <h2>Scan the department QR</h2>
                      <p>Scan the fixed code posted at your department's gate.</p>
                    </div>
                    <span className="panel-symbol"><QrCode size={20} /></span>
                  </div>
                  <Suspense fallback={<div className="scanner-loading"><QrCode size={22} />Starting camera...</div>}>
                    <QRScanner
                      key={scannerAttempt}
                      onDetected={handleQrValue}
                      onError={(message) => setScannerError(message)}
                    />
                  </Suspense>
                  {scannerError && <p className="scanner-note"><CircleAlert size={15} /> {scannerError}</p>}
                  <div className="manual-entry">
                    <div className="manual-divider"><span />OR PASTE QR VALUE<span /></div>
                    <form className="manual-form" onSubmit={(event) => {
                      event.preventDefault()
                      const data = new FormData(event.currentTarget)
                      void handleQrValue(String(data.get('qr-value') ?? ''))
                    }}>
                      <label className="sr-only" htmlFor="qr-value">Department QR value</label>
                      <input id="qr-value" name="qr-value" autoComplete="off" placeholder="Paste the department QR payload" required />
                      <button className="primary-button compact" type="submit" disabled={isSubmitting}>
                        {isSubmitting ? 'Checking…' : <>Verify <ArrowRight size={16} /></>}
                      </button>
                    </form>
                  </div>
                  {error && <p className="error-message" role="alert"><CircleAlert size={16} />{error}</p>}
                </>
              ) : stage === 'details' ? (
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">STEP 02 <span>/</span> CONFIRM</span>
                      <h2>Is this you?</h2>
                      <p>These details came from your student account.</p>
                    </div>
                    <span className="verified-mark"><BadgeCheck size={22} /></span>
                  </div>
                  <div className="identity-banner">
                    <ProfileAvatar name={verifiedStudent?.full_name ?? ''} photoUrl={verifiedStudent?.photo_url} size="large" />
                    <span><small>VERIFIED STUDENT</small><b>{verifiedStudent?.full_name}</b></span>
                    <BadgeCheck className="identity-check" size={20} />
                  </div>
                  <dl className="details-list">
                    <div><dt>Register number</dt><dd>{verifiedStudent?.register_number}</dd></div>
                    <div><dt>Department</dt><dd>{verifiedStudent?.department_code} · {verifiedStudent?.department_name}</dd></div>
                    <div><dt>Year / section</dt><dd>{verifiedStudent?.year} · {verifiedStudent?.section}</dd></div>
                    <div><dt>Gate</dt><dd>{verifiedStudent?.gate_code} · {verifiedStudent?.gate_name}</dd></div>
                  </dl>
                  {error && <p className="error-message" role="alert"><CircleAlert size={16} />{error}</p>}
                  {isConfirmed && <p className="confirmation-note"><Check size={16} /> Your identity is confirmed against the student account.</p>}
                  {isConfirmed && (
                    <div className="late-request-box">
                      <label className="workspace-field late-request-field">
                        <span>Reason for late entry</span>
                        <textarea
                          rows={3}
                          value={lateReason}
                          onChange={(event) => setLateReason(event.target.value)}
                          placeholder="Tell the HOD or advisor why you are arriving late"
                        />
                      </label>
                    </div>
                  )}
                  <div className="confirm-actions">
                    <button className="text-button" type="button" onClick={() => { setStage('scan'); setVerifiedStudent(null); setIsConfirmed(false); setLateReason(''); setLateRequest(null); setError('') }}>
                      <RotateCcw size={16} /> Scan again
                    </button>
                    {!isConfirmed ? (
                      <button className="primary-button" type="button" disabled={isSubmitting} onClick={() => setIsConfirmed(true)}>
                        Confirm details <ChevronRight size={17} />
                      </button>
                    ) : (
                      <button className="primary-button" type="button" disabled={isSubmitting || !lateReason.trim()} onClick={() => void handleLateRequestSubmit()}>
                        {isSubmitting ? 'Sending…' : <>Send late request <Check size={17} /></>}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">STEP 03 <span>/</span> REQUEST STATUS</span>
                      <h2>{lateRequest?.status === 'approved' ? 'Request approved' : lateRequest?.status === 'rejected' ? 'Request not approved' : 'Waiting for approval'}</h2>
                      <p>{lateRequest?.status === 'approved'
                        ? 'Your late-entry request was approved. Show this status to security at the gate.'
                        : lateRequest?.status === 'rejected'
                          ? 'Your assigned staff reviewed this late-entry request.'
                          : 'Your request was sent to the responsible staff. This page checks for updates automatically.'}</p>
                    </div>
                    <span className={`request-status-mark ${lateRequest?.status === 'approved' ? 'is-approved' : lateRequest?.status === 'rejected' ? 'is-rejected' : 'is-pending'}`}>
                      {lateRequest?.status === 'approved' ? <Check size={21} /> : lateRequest?.status === 'rejected' ? <CircleAlert size={21} /> : <Clock3 size={21} />}
                    </span>
                  </div>

                  <div className={`request-status-banner ${lateRequest?.status === 'approved' ? 'is-approved' : lateRequest?.status === 'rejected' ? 'is-rejected' : 'is-pending'}`} role="status">
                    <b>{lateRequest?.status === 'approved' ? 'APPROVED' : lateRequest?.status === 'rejected' ? 'NOT APPROVED' : 'PENDING REVIEW'}</b>
                    <span>{lateRequest?.approved_by_name
                      ? `${lateRequest.approved_by_name} (${lateRequest.approved_by_role === 'hod' ? 'HOD' : 'Advisor'}) ${lateRequest.status === 'approved' ? 'approved' : 'reviewed'} your request.`
                      : 'Sent to your assigned advisor and HOD. Either authorized staff member can review it.'}</span>
                  </div>

                  <dl className="details-list request-status-details">
                    <div><dt>Request</dt><dd>#{lateRequest?.id ?? '—'}</dd></div>
                    <div><dt>Department</dt><dd>{verifiedStudent?.department_code ?? '—'}</dd></div>
                    <div><dt>Reason</dt><dd>{lateRequest?.reason ?? '—'}</dd></div>
                    <div><dt>Assigned advisor</dt><dd>{lateRequest?.advisor_name ?? 'Your class advisor'}</dd></div>
                    <div><dt>Department HOD</dt><dd>{lateRequest?.hod_name ?? 'Your department HOD'}</dd></div>
                    {lateRequest?.decision_note && <div><dt>Staff note</dt><dd>{lateRequest.decision_note}</dd></div>}
                  </dl>

                  {statusRefreshError && <p className="error-message" role="alert"><CircleAlert size={16} />{statusRefreshError}</p>}
                  <div className="confirm-actions request-status-actions">
                    <button className="text-button" type="button" onClick={() => void refreshStudentRequestStatus()} disabled={isRefreshingStatus}>
                      <RefreshCw size={16} /> {isRefreshingStatus ? 'Checking…' : 'Check status'}
                    </button>
                    {lateRequest?.status !== 'pending_approval' && (
                      <button className="primary-button" type="button" onClick={() => {
                        setStage('scan')
                        setVerifiedStudent(null)
                        setLateRequest(null)
                        setIsConfirmed(false)
                        setError('')
                      }}>
                        Start another check <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>

          <footer className="page-footer"><span>SMARTGATE <b>/</b> STUDENT PORTAL</span><span><KeyRound size={13} /> SESSION ENCRYPTED</span></footer>
            </>
          )}
        </main>
      ) : account?.role === 'super_admin' ? (
        <SuperAdminWorkspace account={account} onSignOut={handleSignOut} />
      ) : account?.role === 'admin' ? (
        <AdminWorkspace account={account} onSignOut={handleSignOut} />
      ) : account?.role === 'hod' || account?.role === 'advisor' ? (
        <StaffWorkspace account={account} onSignOut={handleSignOut} />
      ) : account?.role === 'security' ? (
        <SecurityWorkspace account={account} onSignOut={handleSignOut} />
      ) : (
        <main className="gateway-area">
          <section className="gateway-heading">
            <p className="gateway-kicker"><span /> CAMPUS ACCESS / AUTHENTICATED PORTALS</p>
            <h1>SMARTGATE</h1>
            <p className="gateway-subtitle">Late entry & identity verification</p>
            <div className="gateway-rule" />
          </section>

          <section className="role-grid" aria-label="Choose your portal">
            {portalRoles.map(({ id, title, detail, icon: RoleIcon }) => (
              <button
                key={id}
                className={`role-card ${selectedRole === id ? 'is-selected' : ''}`}
                type="button"
                aria-pressed={selectedRole === id}
                onClick={() => { setSelectedRole(id); setError('') }}
              >
                <span className="role-card-icon"><RoleIcon size={21} strokeWidth={1.8} /></span>
                <span className="role-card-copy"><b>{title}</b><small>{detail}</small></span>
                <ArrowRight className="role-card-arrow" size={16} />
              </button>
            ))}
          </section>

          <section className={`auth-pocket ${selectedRole ? 'is-open' : ''}`} aria-hidden={!selectedRole}>
            {selectedRole && (() => {
              const role = portalRoles.find(({ id }) => id === selectedRole)!
              const RoleIcon = role.icon
              return <div className="auth-panel">
                <div className="auth-panel-top">
                  <span className="auth-role-badge"><RoleIcon size={15} /> {role.title}</span>
                  <span className="auth-lock"><KeyRound size={14} /> VERIFIED SIGN-IN</span>
                </div>
                <h2>Initialize access</h2>
                <p className="auth-lead">Use the account issued by your college administrator.</p>
                <form className="auth-form" onSubmit={handleAuth}>
                  <label>Official college email<input name="email" type="email" autoComplete="username" required /></label>
                  <label className="auth-password-field"><span>Password</span><span className="auth-password-control"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required /><button className="auth-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
                  {error && <p className="error-message" role="alert"><CircleAlert size={16} />{error}</p>}
                  <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Checking account…' : <>Authorize session <ArrowRight size={17} /></>}
                  </button>
                </form>
                <div className="auth-footnote"><ShieldCheck size={14} /><span>Portal choice does not grant access. SMARTGATE verifies your assigned role.</span></div>
              </div>
            })()}
          </section>
          <footer className="gateway-footer"><span>SMARTGATE / COLLEGE ACCESS</span><span><KeyRound size={13} /> ROLE VERIFIED BY SERVER</span></footer>
        </main>
      )}
    </div>
  )
}

export default App
