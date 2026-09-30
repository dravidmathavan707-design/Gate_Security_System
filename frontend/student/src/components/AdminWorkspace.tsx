import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Building2, Check, CircleAlert, DoorOpen, Eye, EyeOff, LogOut, QrCode, RefreshCw, Settings2, UsersRound } from 'lucide-react'
import {
  createAdvisor,
  createDepartment,
  createDepartmentQr,
  createGate,
  createHod,
  createSecurityAccount,
  createStudentAccount,
  deleteDepartment,
  deleteUser,
  getAdminLateRequestHistory,
  getAdminDepartmentQrs,
  getAdminUsers,
  getCollege,
  getDepartments,
  getGates,
  setDepartmentQrStatus,
  updateUserPhoto,
  uploadProfileImage,
  updateCollege,
  updateCollegePhoto,
  type Account,
  type CollegeProfile,
  type Department,
  type DepartmentQr,
  type Gate,
  type LateRequestHistoryItem,
} from '../services/api'
import { LateRequestHistoryList } from './LateRequestHistoryList'
import { DepartmentQrPreview } from './DepartmentQrPreview'
import { InboxPanel } from './InboxPanel'
import { ProfileAvatar } from './ProfileAvatar'

interface AdminWorkspaceProps {
  account: Account
  onSignOut: () => void
}

type AdminTab = 'overview' | 'departments' | 'accounts' | 'gates' | 'rules' | 'history'
type NewAccountRole = 'hod' | 'advisor' | 'security' | 'student'

export function AdminWorkspace({ account, onSignOut }: AdminWorkspaceProps) {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number } | null>(null)
  const tabsRef = useRef<HTMLElement | null>(null)
  const [college, setCollege] = useState<CollegeProfile | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [gates, setGates] = useState<Gate[]>([])
  const [users, setUsers] = useState<Account[]>([])
  const [qrs, setQrs] = useState<DepartmentQr[]>([])
  const [lateRequestHistory, setLateRequestHistory] = useState<LateRequestHistoryItem[]>([])
  const [role, setRole] = useState<NewAccountRole>('hod')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useLayoutEffect(() => {
    const nav = tabsRef.current
    if (!nav) return

    function positionIndicator() {
      const activeButton = tabsRef.current?.querySelector<HTMLButtonElement>('.is-active')
      if (!activeButton) return
      setTabIndicator({ left: activeButton.offsetLeft, width: activeButton.offsetWidth })
    }

    positionIndicator()
    const resizeObserver = new ResizeObserver(positionIndicator)
    resizeObserver.observe(nav)
    return () => resizeObserver.disconnect()
  }, [tab])

  useEffect(() => {
    let active = true
    Promise.all([getCollege(), getDepartments(), getGates(), getAdminUsers(), getAdminDepartmentQrs(), getAdminLateRequestHistory()])
      .then(([collegeData, departmentData, gateData, userData, qrData, historyData]) => {
        if (!active) return
        setCollege(collegeData)
        setDepartments(departmentData)
        setGates(gateData)
        setUsers(userData)
        setQrs(qrData)
        setLateRequestHistory(historyData)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load college setup.')
      })
    return () => { active = false }
  }, [refreshKey])

  function finishAction(message: string) {
    setNotice(message)
    setError('')
    setRefreshKey((value) => value + 1)
  }

  async function handleCreateDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setIsBusy(true)
    setError('')
    try {
      await createDepartment({ code: String(values.get('code')), name: String(values.get('name')) })
      form?.reset?.()
      finishAction('Department added.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Department could not be created.')
    } finally { setIsBusy(false) }
  }

  async function handleDeleteDepartment(departmentId: number) {
    if (!window.confirm('Delete this department and remove its linked assignments and QR codes?')) return
    setIsBusy(true)
    setError('')
    try {
      await deleteDepartment(departmentId)
      finishAction('Department deleted.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Department could not be deleted.')
    } finally { setIsBusy(false) }
  }

  async function handleDeleteUser(userId: number) {
    if (!window.confirm('Delete this account? This action cannot be undone.')) return
    setIsBusy(true)
    setError('')
    try {
      await deleteUser(userId)
      finishAction('Account deleted.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Account could not be deleted.')
    } finally { setIsBusy(false) }
  }

  async function handleCreateGate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setIsBusy(true)
    setError('')
    try {
      await createGate({ code: String(values.get('code')), name: String(values.get('name')) })
      form?.reset?.()
      finishAction('Gate added.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Gate could not be created.')
    } finally { setIsBusy(false) }
  }

  async function handleCreateQr(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setIsBusy(true)
    setError('')
    try {
      await createDepartmentQr(Number(values.get('department_id')), Number(values.get('gate_id')))
      finishAction('Department gate QR created.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'QR could not be created.')
    } finally { setIsBusy(false) }
  }

  async function handleQrStatus(qr: DepartmentQr) {
    setIsBusy(true)
    setError('')
    try {
      await setDepartmentQrStatus(qr.id, qr.status === 'active' ? 'disabled' : 'active')
      finishAction(`QR ${qr.status === 'active' ? 'disabled' : 'activated'}.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'QR status could not be changed.')
    } finally { setIsBusy(false) }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const common = {
      email: String(values.get('email')),
      full_name: String(values.get('full_name')),
      password: String(values.get('password')),
    }
    setIsBusy(true)
    setError('')
    try {
      const image = values.get('profile_photo')
      const photoUrl = image instanceof File && image.size > 0 ? await uploadProfileImage(image) : undefined
      const accountDetails = { ...common, photo_url: photoUrl }
      if (role === 'hod') {
        await createHod(Number(values.get('department_id')), { ...accountDetails, employee_id: String(values.get('employee_id')) })
      } else if (role === 'advisor') {
        await createAdvisor({
          ...accountDetails,
          employee_id: String(values.get('employee_id')),
          department_id: Number(values.get('department_id')),
          year: String(values.get('year')),
          section: String(values.get('section')),
        })
      } else if (role === 'security') {
        await createSecurityAccount({ ...accountDetails, employee_id: String(values.get('employee_id')), gate_id: Number(values.get('gate_id')) })
      } else {
        await createStudentAccount({
          ...accountDetails,
          student_id: String(values.get('student_id')),
          register_number: String(values.get('register_number')),
          department_id: Number(values.get('department_id')),
          year: String(values.get('year')),
          section: String(values.get('section')),
          parent_name: String(values.get('parent_name') || '') || undefined,
          parent_phone: String(values.get('parent_phone') || '') || undefined,
          parent_email: String(values.get('parent_email') || '') || undefined,
          parent_relationship: String(values.get('parent_relationship') || '') || undefined,
        })
      }
      form?.reset?.()
      finishAction(`${role.toUpperCase()} account created.`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Account could not be created.')
    } finally { setIsBusy(false) }
  }

  async function handleReplaceUserPhoto(userId: number, image: File | undefined) {
    if (!image) return
    setIsBusy(true)
    setError('')
    try {
      const photoUrl = await uploadProfileImage(image)
      await updateUserPhoto(userId, photoUrl)
      finishAction('Account profile picture updated.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Account picture could not be updated.')
    } finally { setIsBusy(false) }
  }

  async function handleRemoveCollegePhoto() {
    if (!college?.photo_url || !window.confirm('Remove the college logo?')) return
    setIsBusy(true)
    setError('')
    try {
      await updateCollegePhoto(null)
      finishAction('College logo removed.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'College logo could not be removed.')
    } finally { setIsBusy(false) }
  }

  async function handleRulesSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!college) return
    const values = new FormData(event.currentTarget)
    setIsBusy(true)
    setError('')
    try {
      const image = values.get('college_photo')
      const photoUrl = image instanceof File && image.size > 0 ? await uploadProfileImage(image) : undefined
      const payload: Omit<CollegeProfile, 'id'> = {
        name: String(values.get('name')),
        code: String(values.get('code')),
        address: String(values.get('address')),
        academic_year: String(values.get('academic_year')),
        working_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].filter((day) => values.has(day)),
        default_gate_closing_time: `${String(values.get('default_gate_closing_time'))}:00`,
        monthly_late_limit: Number(values.get('monthly_late_limit')),
        permission_validity_minutes: Number(values.get('permission_validity_minutes')),
        parent_notifications_enabled: values.has('parent_notifications_enabled'),
        emergency_permissions_enabled: values.has('emergency_permissions_enabled'),
        holidays: String(values.get('holidays')).split(',').map((holiday) => holiday.trim()).filter(Boolean),
        ...(photoUrl ? { photo_url: photoUrl } : {}),
      }
      await updateCollege(payload)
      finishAction('College rules saved.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'College rules could not be saved.')
    } finally { setIsBusy(false) }
  }

  const filteredUsers = users.filter((user) => {
    const query = search.trim().toLowerCase()
    return !query || [user.full_name, user.email, user.role, user.student_id, user.register_number, user.employee_id]
      .some((value) => value?.toLowerCase().includes(query))
  })

  const departmentDisplayOrder: Record<string, number> = { CCE: 0, CSE: 1, ECE: 2, EEE: 3, MECH: 4, CIVIL: 5 }
  const lateHistoryTotals = departments
    .map((department) => {
      const requests = lateRequestHistory.filter((item) => item.department_id === department.id)
      return {
        department,
        total: requests.length,
        pending: requests.filter((item) => item.status === 'pending_approval').length,
        approved: requests.filter((item) => item.status === 'approved').length,
        rejected: requests.filter((item) => item.status === 'rejected').length,
      }
    })
    .sort((left, right) => {
      const leftCode = left.department.code.toUpperCase()
      const rightCode = right.department.code.toUpperCase()
      return (departmentDisplayOrder[leftCode] ?? 999) - (departmentDisplayOrder[rightCode] ?? 999)
        || leftCode.localeCompare(rightCode)
    })

  return (
    <main className="workspace-area">
      <header className="workspace-welcome">
        <div className="workspace-welcome-copy">
          <ProfileAvatar name={college?.name ?? 'College'} photoUrl={college?.photo_url} size="large" shape="rounded" />
          <div>
            <p className="workspace-eyebrow">COLLEGE CONTROL / ADMIN</p>
            <h1>{college?.name ?? 'College workspace'}</h1>
            <p>{college?.academic_year ?? 'Loading academic year'} · {account.full_name}</p>
          </div>
        </div>
        <div className="workspace-welcome-actions">
          <button className="workspace-quiet-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15} /> Refresh</button>
          <button className="workspace-quiet-button" type="button" onClick={onSignOut}><LogOut size={15} /> Sign out</button>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Admin sections" ref={tabsRef}>
        {tabIndicator && <span className="workspace-tab-indicator" aria-hidden="true" style={{ width: tabIndicator.width, transform: `translateX(${tabIndicator.left}px)` }} />}
        {([
          ['overview', 'Overview'], ['departments', 'Departments'], ['accounts', 'Accounts'], ['gates', 'Gates & QR'], ['history', 'Late history'], ['rules', 'College rules'],
        ] as const).map(([key, label]) => <button key={key} className={tab === key ? 'is-active' : ''} type="button" onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {notice && <div className="workspace-notice"><Check size={15} />{notice}</div>}
      {error && <div className="workspace-alert"><CircleAlert size={15} />{error}</div>}

      {tab === 'overview' && <>
        <section className="workspace-stat-grid">
          <button type="button" className="workspace-stat-card" onClick={() => setTab('departments')}>
            <span>Departments</span><b>{departments.length}</b><small>Configured for this college</small>
          </button>
          <button type="button" className="workspace-stat-card" onClick={() => setTab('accounts')}>
            <span>Accounts</span><b>{users.length}</b><small>Admin-managed identities</small>
          </button>
          <button type="button" className="workspace-stat-card" onClick={() => setTab('gates')}>
            <span>Active gates</span><b>{gates.filter((gate) => gate.is_active).length}</b><small>Physical entry points</small>
          </button>
          <button type="button" className="workspace-stat-card" onClick={() => setTab('gates')}>
            <span>Department QR</span><b>{qrs.filter((qr) => qr.status === 'active').length}</b><small>Active / {qrs.length} registered</small>
          </button>
        </section>
        <section className="workspace-main-grid">
          <div className="workspace-panel">
            <div className="workspace-section-heading"><div><span className="workspace-eyebrow">ORGANIZATION</span><h2>Departments</h2></div><Building2 size={18} /></div>
            <div className="workspace-list">
              {departments.map((department) => {
                const hod = users.find((user) => user.id === department.hod_user_id)
                return <div className="workspace-list-row" key={department.id}><span className="department-code">{department.code}</span><span><b>{department.name}</b><small>{hod ? `HOD · ${hod.full_name}` : 'HOD not assigned'}</small></span></div>
              })}
              {departments.length === 0 && <p className="workspace-muted">No departments configured.</p>}
            </div>
            <form className="workspace-form workspace-form-divider" onSubmit={handleCreateDepartment}>
              <h3>Add a department</h3>
              <label className="workspace-field"><span>Department code</span><input name="code" placeholder="CCE" required /></label>
              <label className="workspace-field"><span>Department name</span><input name="name" placeholder="Computer and Communication Engineering" required /></label>
              <button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Saving…' : 'Add department'}</button>
            </form>
                      {role !== 'security' && <label className="workspace-field"><span>Department</span><select name="department_id" required>{departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></label>}
                      {role !== 'student' && <label className="workspace-field"><span>Employee ID</span><input name="employee_id" required /></label>}
          </div>
          <div className="workspace-panel">
            <div className="workspace-section-heading"><div><span className="workspace-eyebrow">ENTRY POINTS</span><h2>Active gate QRs</h2></div><DoorOpen size={18} /></div>
            <div className="workspace-list">
              {qrs.filter((qr) => qr.status === 'active').slice(0, 5).map((qr) => <div className="workspace-list-row" key={qr.id}><span className="qr-status-dot" /><span><b>{qr.department_code} / {qr.gate_name}</b><small>Created by account {qr.created_by_user_id}</small></span></div>)}
              {qrs.filter((qr) => qr.status === 'active').length === 0 && <p className="workspace-muted">Create a department QR after configuring a gate.</p>}
            </div>
          </div>
        </section>
      </>}

      {tab === 'history' && <>
        <section className="workspace-panel late-history-summary-panel">
          <div className="workspace-section-heading">
            <div><span className="workspace-eyebrow">COLLEGE LATE ENTRY / {lateRequestHistory.length} TOTAL</span><h2>Department totals</h2></div>
            <UsersRound size={18} />
          </div>
          <div className="late-history-summary-grid">
            {lateHistoryTotals.map(({ department, total, pending, approved, rejected }) => (
              <article className="late-history-summary-item" key={department.id}>
                <div><strong>{department.code}</strong><span>{total} total</span></div>
                <small>{department.name}</small>
                <div className="late-history-summary-status"><span>{pending} waiting</span><span>{approved} approved</span><span>{rejected} rejected</span></div>
              </article>
            ))}
            {lateHistoryTotals.length === 0 && <p className="workspace-muted">No departments are configured.</p>}
          </div>
        </section>
        <section className="workspace-panel late-history-panel">
          <div className="workspace-section-heading">
            <div><span className="workspace-eyebrow">ALL DEPARTMENTS / FIXED ORDER</span><h2>Late-entry requests</h2></div>
            <Building2 size={18} />
          </div>
          <LateRequestHistoryList
            entries={lateRequestHistory}
            emptyMessage="Student late-entry requests will appear here with their department and approval history."
          />
        </section>
      </>}

      {tab === 'departments' && <section className="workspace-main-grid">
        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">ORGANIZATION / {departments.length} DEPARTMENTS</span><h2>Departments</h2></div><Building2 size={18} /></div>
          <div className="workspace-list">
            {departments.map((department) => {
              const hod = users.find((user) => user.id === department.hod_user_id)
              const staffCount = users.filter((user) => user.department_id === department.id).length
              return <div className="workspace-list-row workspace-row-actions" key={department.id}>
                <span className="department-code">{department.code}</span>
                <span><b>{department.name}</b><small>{hod ? `HOD · ${hod.full_name}` : 'No HOD assigned'} · {staffCount} linked staff</small></span>
                <button className="workspace-quiet-button danger-button" type="button" onClick={() => void handleDeleteDepartment(department.id)} disabled={isBusy}>Delete</button>
              </div>
            })}
            {departments.length === 0 && <p className="workspace-muted">No departments configured.</p>}
          </div>
          <form className="workspace-form workspace-form-divider" onSubmit={handleCreateDepartment}>
            <h3>Add a department</h3>
            <label className="workspace-field"><span>Department code</span><input name="code" placeholder="CCE" required /></label>
            <label className="workspace-field"><span>Department name</span><input name="name" placeholder="Computer and Communication Engineering" required /></label>
            <button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Saving…' : 'Add department'}</button>
          </form>
        </div>

        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">ROLE MANAGEMENT</span><h2>Department setup</h2></div><UsersRound size={18} /></div>
          <div className="workspace-setup-card">
            <p>Use the department list to remove a whole department, and use the account list below to remove any HOD, advisor, security, or staff member.</p>
            <button className="primary-button" type="button" onClick={() => setTab('accounts')}>Manage accounts</button>
          </div>
        </div>
      </section>}

      {tab === 'accounts' && <section className="workspace-main-grid">
        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">DIRECTORY / {users.length} ACCOUNTS</span><h2>College accounts</h2></div><UsersRound size={18} /></div>
          <label className="workspace-field"><span>Search by name, email, ID, or role</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts" /></label>
          <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Person</th><th>Role</th><th>Campus ID</th><th>Class</th><th>Actions</th></tr></thead><tbody>
            {filteredUsers.map((user) => <tr key={user.id}><td><span className="workspace-person-cell"><ProfileAvatar name={user.full_name} photoUrl={user.photo_url} size="small" /><span><b>{user.full_name}</b><small>{user.email}</small></span></span></td><td><span className="role-pill">{user.role}</span></td><td>{user.student_id ?? user.employee_id ?? user.register_number ?? '—'}</td><td>{user.department_id ? `${departments.find((department) => department.id === user.department_id)?.code ?? 'Dept'} ${user.year ?? ''}${user.section ? ` · ${user.section}` : ''}` : user.gate_assignment ?? '—'}</td><td><span className="workspace-action-group"><label className="workspace-photo-replace"><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Replace ${user.full_name} profile picture`} onChange={(event) => void handleReplaceUserPhoto(user.id, event.target.files?.[0])} disabled={isBusy} /><span>Photo</span></label>{user.id === account.id ? <span className="workspace-muted">Current session</span> : <button className="workspace-quiet-button danger-button" type="button" onClick={() => void handleDeleteUser(user.id)} disabled={isBusy}>Delete</button>}</span></td></tr>)}
            {filteredUsers.length === 0 && <tr><td colSpan={5} className="workspace-muted">No matching accounts.</td></tr>}
          </tbody></table></div>
        </div>
        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">ADMIN PROVISIONING</span><h2>Create staff or student</h2></div><UsersRound size={18} /></div>
          <p className="workspace-muted">Admin and Super Admin can create HODs, advisors, security staff, and students. Only Admin and Super Admin can delete student accounts.</p>
          <div className="workspace-segmented">{([['hod', 'HOD'], ['advisor', 'Advisor'], ['security', 'Security'], ['student', 'Student']] as const).map(([value, label]) => <button className={role === value ? 'is-active' : ''} type="button" key={value} onClick={() => setRole(value)}>{label}</button>)}</div>
          <form className="workspace-form" onSubmit={handleCreateAccount}>
            <label className="workspace-field"><span>Full name</span><input name="full_name" required minLength={2} /></label>
            <label className="workspace-field"><span>Official email</span><input name="email" type="email" required /></label>
            <label className="workspace-field"><span>Temporary password</span><span className="auth-password-control"><input name="password" type={showPassword ? 'text' : 'password'} minLength={12} required /><button className="auth-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            <label className="workspace-field"><span>Profile picture (optional)</span><input name="profile_photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
            <label className="workspace-field"><span>Employee ID</span><input name="employee_id" required minLength={2} /></label>
            {role !== 'security' && <label className="workspace-field"><span>Department</span><select name="department_id" required>{departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></label>}
            {role === 'security' && <label className="workspace-field"><span>Assigned gate</span><select name="gate_id" required>{gates.map((gate) => <option key={gate.id} value={gate.id}>{gate.code} · {gate.name}</option>)}</select></label>}
            {(role === 'advisor' || role === 'student') && <div className="workspace-inline-fields"><label className="workspace-field"><span>Year</span><input name="year" placeholder="II" required /></label><label className="workspace-field"><span>Section</span><input name="section" placeholder="A" required /></label></div>}
            {role === 'student' && <>
              <label className="workspace-field"><span>Student ID</span><input name="student_id" required /></label>
              <label className="workspace-field"><span>Register number</span><input name="register_number" required /></label>
              <label className="workspace-field"><span>Parent name</span><input name="parent_name" /></label>
              <label className="workspace-field"><span>Parent phone</span><input name="parent_phone" /></label>
              <label className="workspace-field"><span>Parent email</span><input name="parent_email" type="email" /></label>
              <label className="workspace-field"><span>Relationship</span><input name="parent_relationship" placeholder="Guardian" /></label>
            </>}
            <button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Saving…' : <>Create {role} <Check size={15} /></>}</button>
          </form>
        </div>
      </section>}

      {tab === 'gates' && <section className="workspace-main-grid">
        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">PHYSICAL ACCESS</span><h2>Gates</h2></div><DoorOpen size={18} /></div>
          <div className="workspace-list">{gates.map((gate) => <div className="workspace-list-row" key={gate.id}><span className={`gate-status ${gate.is_active ? 'is-active' : ''}`} /><span><b>{gate.code} · {gate.name}</b><small>{gate.is_active ? 'Active' : 'Inactive'}</small></span></div>)}{gates.length === 0 && <p className="workspace-muted">No gates configured.</p>}</div>
          <form className="workspace-form workspace-form-divider" onSubmit={handleCreateGate}>
            <h3>Add a gate</h3>
            <label className="workspace-field"><span>Gate code</span><input name="code" placeholder="MAIN" required /></label>
            <label className="workspace-field"><span>Gate name</span><input name="name" placeholder="Main Gate" required /></label>
            <button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Saving…' : 'Add gate'}</button>
          </form>
        </div>
        <div className="workspace-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">FIXED PRINTED CODES</span><h2>Department QRs</h2></div><QrCode size={18} /></div>
          <div className="workspace-list">{qrs.map((qr) => <div className="workspace-list-row workspace-qr-row" key={qr.id}><span className={`gate-status ${qr.status === 'active' ? 'is-active' : ''}`} /><span><b>{qr.department_code} · {qr.gate_name}</b><small>{qr.status.toUpperCase()} · QR #{qr.id}</small><div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}><DepartmentQrPreview value={qr.qr_payload} label={`${qr.department_code} ${qr.gate_name} QR`} size={110} /><code style={{ maxWidth: '240px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{qr.qr_payload}</code></div></span><button className="workspace-quiet-button" type="button" disabled={isBusy} onClick={() => void handleQrStatus(qr)}>{qr.status === 'active' ? 'Disable' : 'Activate'}</button></div>)}{qrs.length === 0 && <p className="workspace-muted">No department QR records yet.</p>}</div>
          <form className="workspace-form workspace-form-divider" onSubmit={handleCreateQr}>
            <h3>Create a department gate QR</h3>
            <label className="workspace-field"><span>Department</span><select name="department_id" required>{departments.map((department) => <option key={department.id} value={department.id}>{department.code} · {department.name}</option>)}</select></label>
            <label className="workspace-field"><span>Gate</span><select name="gate_id" required>{gates.filter((gate) => gate.is_active).map((gate) => <option key={gate.id} value={gate.id}>{gate.code} · {gate.name}</option>)}</select></label>
            <button className="primary-button" type="submit" disabled={isBusy || !departments.length || !gates.some((gate) => gate.is_active)}>{isBusy ? 'Creating…' : 'Create fixed QR'}</button>
          </form>
        </div>
      </section>}

      {tab === 'rules' && college && <section className="workspace-panel workspace-rules-panel">
        <div className="workspace-section-heading"><div><span className="workspace-eyebrow">CONFIGURATION</span><h2>College rules</h2></div><Settings2 size={18} /></div>
        <form className="workspace-form workspace-rules-form" onSubmit={handleRulesSave}>
          <div className="workspace-profile-photo-field"><ProfileAvatar name={college.name} photoUrl={college.photo_url} size="large" shape="rounded" /><div className="workspace-logo-controls"><label className="workspace-field"><span>College logo</span><input name="college_photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>{college.photo_url && <button className="workspace-quiet-button danger-button" type="button" onClick={() => void handleRemoveCollegePhoto()} disabled={isBusy}>Remove logo</button>}<small className="workspace-muted">{college.logo_updated_at ? `Last modified by ${college.logo_updated_by ?? 'admin'} (${college.logo_updated_by_role ?? 'admin'}) · ${new Date(college.logo_updated_at).toLocaleString()}` : 'No logo changes recorded yet.'} · Admin + Super Admin can update or remove this logo; others are read-only.</small></div></div>
          <label className="workspace-field"><span>College name</span><input name="name" defaultValue={college.name} required /></label>
          <label className="workspace-field"><span>College code</span><input name="code" defaultValue={college.code} required /></label>
          <label className="workspace-field"><span>Address</span><input name="address" defaultValue={college.address} required /></label>
          <label className="workspace-field"><span>Academic year</span><input name="academic_year" defaultValue={college.academic_year} required /></label>
          <label className="workspace-field"><span>Gate closing time</span><input name="default_gate_closing_time" type="time" defaultValue={college.default_gate_closing_time.slice(0, 5)} required /></label>
          <label className="workspace-field"><span>Monthly late limit</span><input name="monthly_late_limit" type="number" min="0" defaultValue={college.monthly_late_limit} required /></label>
          <label className="workspace-field"><span>Permission validity (minutes)</span><input name="permission_validity_minutes" type="number" min="1" defaultValue={college.permission_validity_minutes} required /></label>
          <label className="workspace-field"><span>Holidays (comma separated dates)</span><input name="holidays" defaultValue={college.holidays.join(', ')} placeholder="2026-12-25" /></label>
          <label className="workspace-field"><span>College profile picture</span><input name="college_photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
          <fieldset className="workspace-days-field">
            <legend>Working days</legend>
            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => <label className="workspace-toggle" key={day}><input name={day} type="checkbox" defaultChecked={college.working_days.includes(day)} /><span>{day}</span></label>)}
          </fieldset>
          <label className="workspace-toggle"><input name="parent_notifications_enabled" type="checkbox" defaultChecked={college.parent_notifications_enabled} /><span>Parent notifications enabled</span></label>
          <label className="workspace-toggle"><input name="emergency_permissions_enabled" type="checkbox" defaultChecked={college.emergency_permissions_enabled} /><span>Emergency permissions enabled</span></label>
          <div className="workspace-form-actions"><button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Saving…' : 'Save rules'}</button></div>
        </form>
      </section>}

      <InboxPanel
        account={account}
        departmentLabels={Object.fromEntries(departments.map((department) => [department.id, `${department.code} · ${department.name}`]))}
        gateLabels={Object.fromEntries(gates.map((gate) => [gate.id, gate.code]))}
      />
    </main>
  )
}
