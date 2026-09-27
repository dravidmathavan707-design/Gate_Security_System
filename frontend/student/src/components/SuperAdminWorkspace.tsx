import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Check, CircleAlert, Eye, EyeOff, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react'
import { createCollege, createCollegeAdmin, getAdminUsers, getCollege, updateCollegePhoto, updateUserPhoto, uploadProfileImage, type Account, type CollegeProfile } from '../services/api'
import { ProfileAvatar } from './ProfileAvatar'

interface SuperAdminWorkspaceProps {
  account: Account
  onSignOut: () => void
}

const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function SuperAdminWorkspace({ account, onSignOut }: SuperAdminWorkspaceProps) {
  const [college, setCollege] = useState<CollegeProfile | null>(null)
  const [collegeAdmins, setCollegeAdmins] = useState<Account[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let active = true
    getCollege()
      .then(async (collegeData) => {
        if (!active) return
        setCollege(collegeData)
        const accounts = await getAdminUsers({ role: 'admin' })
        if (active) setCollegeAdmins(accounts)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        const message = loadError instanceof Error ? loadError.message : 'Could not load system setup.'
        if (message.toLowerCase().includes('college setup')) {
          setCollege(null)
          setCollegeAdmins([])
        } else {
          setError(message)
        }
      })
    return () => { active = false }
  }, [refreshKey])

  function finishAction(message: string) {
    setNotice(message)
    setError('')
    setRefreshKey((value) => value + 1)
  }

  async function handleCreateCollege(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setIsBusy(true)
    setError('')
    try {
      const image = values.get('college_photo')
      const photoUrl = image instanceof File && image.size > 0 ? await uploadProfileImage(image) : null
      const payload: Omit<CollegeProfile, 'id'> = {
        name: String(values.get('name')),
        photo_url: photoUrl,
        code: String(values.get('code')),
        address: String(values.get('address')),
        academic_year: String(values.get('academic_year')),
        working_days: weekDays.filter((day) => values.has(day)),
        default_gate_closing_time: `${String(values.get('default_gate_closing_time'))}:00`,
        monthly_late_limit: Number(values.get('monthly_late_limit')),
        permission_validity_minutes: Number(values.get('permission_validity_minutes')),
        parent_notifications_enabled: values.has('parent_notifications_enabled'),
        emergency_permissions_enabled: values.has('emergency_permissions_enabled'),
        holidays: String(values.get('holidays')).split(',').map((day) => day.trim()).filter(Boolean),
      }
      await createCollege(payload)
      finishAction('College profile created. You can now provision its college admin.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'College profile could not be created.')
    } finally { setIsBusy(false) }
  }

  async function handleReplaceCollegePhoto(image: File | undefined) {
    if (!image || !college) return
    setIsBusy(true)
    setError('')
    try {
      const photoUrl = await uploadProfileImage(image)
      await updateCollegePhoto(photoUrl)
      finishAction('College profile picture updated.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'College profile picture could not be updated.')
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

  async function handleReplaceAdminPhoto(adminId: number, image: File | undefined) {
    if (!image) return
    setIsBusy(true)
    setError('')
    try {
      const photoUrl = await uploadProfileImage(image)
      await updateUserPhoto(adminId, photoUrl)
      finishAction('College admin picture updated.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'College admin picture could not be updated.')
    } finally { setIsBusy(false) }
  }

  async function handleCreateAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setIsBusy(true)
    setError('')
    try {
      const image = values.get('profile_photo')
      const photoUrl = image instanceof File && image.size > 0 ? await uploadProfileImage(image) : undefined
      await createCollegeAdmin({
        full_name: String(values.get('full_name')),
        email: String(values.get('email')),
        password: String(values.get('password')),
        photo_url: photoUrl,
      })
      form?.reset?.()
      finishAction('College admin account created.')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'College admin account could not be created.')
    } finally { setIsBusy(false) }
  }

  return (
    <main className="workspace-area super-admin-workspace">
      <header className="workspace-welcome">
        <div>
          <p className="workspace-eyebrow">SMARTGATE / SYSTEM ADMINISTRATION</p>
          <h1>{college?.name ?? 'Super admin workspace'}</h1>
          <p><ShieldCheck size={14} /> System-wide access · {account.full_name}</p>
        </div>
        <div className="workspace-welcome-actions">
          <button className="workspace-quiet-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15} /> Refresh</button>
          <button className="workspace-quiet-button" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {notice && <div className="workspace-notice"><Check size={15} />{notice}</div>}
      {error && <div className="workspace-alert"><CircleAlert size={15} />{error}</div>}

      <section className="workspace-stat-grid super-admin-stat-grid">
        <article><span>System role</span><b>Super admin</b><small>Authenticated account</small></article>
        <article><span>College profile</span><b>{college ? 'Configured' : 'Setup needed'}</b><small>{college?.code ?? 'Create the first college profile'}</small></article>
        <article><span>College admins</span><b>{collegeAdmins.length}</b><small>Accounts under your control</small></article>
      </section>

      <div className={`super-admin-setup-steps ${college ? 'is-step-two' : 'is-step-one'}`} role="group" aria-label="Super admin setup progress">
        <span className="super-admin-step-island" aria-hidden="true" />
        <ol>
          <li className={college ? 'is-complete' : 'is-current'}>
            <span className="super-admin-step-number">{college ? <Check size={15} /> : '1'}</span>
            <span className="super-admin-step-copy"><span className="super-admin-step-heading"><b>Create college profile</b><strong>{college ? 'Complete' : 'Current'}</strong></span><small>Enter the official college details and rules.</small></span>
          </li>
          <li className={college ? 'is-current' : 'is-next'}>
            <span className="super-admin-step-number">2</span>
            <span className="super-admin-step-copy"><span className="super-admin-step-heading"><b>Create college admin</b><strong>{college ? 'Current' : 'Next'}</strong></span><small>Set the name, email, and initial password.</small></span>
          </li>
        </ol>
      </div>

      {!college ? (
        <section className="workspace-panel super-admin-setup-panel">
          <div className="workspace-section-heading"><div><span className="workspace-eyebrow">FIRST-TIME SETUP</span><h2>Create the college profile</h2></div><Building2 size={20} /></div>
          <p className="super-admin-lead">Save the official profile first. The admin form will unlock in Step 2.</p>
          <form className="workspace-form workspace-rules-form" onSubmit={handleCreateCollege}>
            <div className="workspace-profile-photo-field">
              <ProfileAvatar name="College" size="large" shape="rounded" />
              <label className="workspace-field"><span>College profile picture (optional)</span><input name="college_photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
            </div>
            <label className="workspace-field"><span>Official college name</span><input name="name" required minLength={2} /></label>
            <label className="workspace-field"><span>College code</span><input name="code" required minLength={2} /></label>
            <label className="workspace-field"><span>Address</span><input name="address" required minLength={2} /></label>
            <label className="workspace-field"><span>Academic year</span><input name="academic_year" placeholder="2026-27" required minLength={4} /></label>
            <label className="workspace-field"><span>Default gate closing time</span><input name="default_gate_closing_time" type="time" defaultValue="09:30" required /></label>
            <label className="workspace-field"><span>Monthly late limit</span><input name="monthly_late_limit" type="number" min="0" defaultValue="3" required /></label>
            <label className="workspace-field"><span>Permission validity (minutes)</span><input name="permission_validity_minutes" type="number" min="1" defaultValue="15" required /></label>
            <label className="workspace-field"><span>Holidays (comma-separated dates)</span><input name="holidays" placeholder="2026-12-25" /></label>
            <fieldset className="workspace-days-field"><legend>Working days</legend>
              {weekDays.map((day) => <label className="workspace-toggle" key={day}><input name={day} type="checkbox" defaultChecked={weekDays.indexOf(day) < 5} /><span>{day}</span></label>)}
            </fieldset>
            <label className="workspace-toggle"><input name="parent_notifications_enabled" type="checkbox" defaultChecked /><span>Enable parent notifications</span></label>
            <label className="workspace-toggle"><input name="emergency_permissions_enabled" type="checkbox" defaultChecked /><span>Enable emergency permissions</span></label>
            <div className="workspace-form-actions"><button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Creating…' : <>Create college profile <Check size={15} /></>}</button></div>
          </form>
        </section>
      ) : (
        <section className="workspace-main-grid super-admin-main-grid">
          <div className="workspace-panel">
            <div className="workspace-section-heading"><div><span className="workspace-eyebrow">COLLEGE PROFILE</span><h2>{college.name}</h2></div><Building2 size={20} /></div>
            <div className="workspace-profile-photo-field">
              <ProfileAvatar name={college.name} photoUrl={college.photo_url} size="large" shape="rounded" />
              <div className="workspace-logo-controls"><label className="workspace-field"><span>Change college picture</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handleReplaceCollegePhoto(event.target.files?.[0])} disabled={isBusy} /></label>{college.photo_url && <button className="workspace-quiet-button danger-button" type="button" onClick={() => void handleRemoveCollegePhoto()} disabled={isBusy}>Remove logo</button>}<small className="workspace-muted">{college.logo_updated_at ? `Last modified by ${college.logo_updated_by ?? 'admin'} (${college.logo_updated_by_role ?? 'admin'}) · ${new Date(college.logo_updated_at).toLocaleString()}` : 'No logo changes recorded yet.'} · Super Admin and Admin have full write access; every other role is read-only.</small></div>
            </div>
            <dl className="super-admin-college-details">
              <div><dt>College code</dt><dd>{college.code}</dd></div>
              <div><dt>Address</dt><dd>{college.address}</dd></div>
              <div><dt>Academic year</dt><dd>{college.academic_year}</dd></div>
              <div><dt>Working days</dt><dd>{college.working_days.join(', ')}</dd></div>
            </dl>
          </div>

          <div className="workspace-panel">
            <div className="workspace-section-heading"><div><span className="workspace-eyebrow">STEP 2 / COLLEGE ADMINISTRATION</span><h2>Create a college admin</h2></div><UsersRound size={20} /></div>
            <p className="super-admin-lead">This creates the regular admin account for <b>{college.name}</b>. They sign in through the existing College admin portal.</p>
            <form className="workspace-form" onSubmit={handleCreateAdmin}>
              <label className="workspace-field"><span>Profile picture (optional)</span><input name="profile_photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
              <label className="workspace-field"><span>Full name</span><input name="full_name" autoComplete="name" required minLength={2} /></label>
              <label className="workspace-field"><span>Official email</span><input name="email" type="email" autoComplete="email" required /></label>
              <label className="workspace-field"><span>Temporary password</span><span className="auth-password-control"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required /><button className="auth-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
              <p className="workspace-muted">Use a unique password with at least 12 characters. Share it with the admin through a secure channel.</p>
              <button className="primary-button" type="submit" disabled={isBusy}>{isBusy ? 'Creating…' : <>Create college admin <Check size={15} /></>}</button>
            </form>
          </div>

          <div className="workspace-panel super-admin-admin-list">
            <div className="workspace-section-heading"><div><span className="workspace-eyebrow">COLLEGE ADMINS / {collegeAdmins.length}</span><h2>College admin accounts</h2></div><UsersRound size={20} /></div>
            <div className="workspace-list">
              {collegeAdmins.map((admin) => <div className="workspace-list-row" key={admin.id}><ProfileAvatar name={admin.full_name} photoUrl={admin.photo_url} size="small" /><span><b>{admin.full_name}</b><small>{admin.email}</small></span><label className="workspace-photo-replace"><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Replace ${admin.full_name} profile picture`} onChange={(event) => void handleReplaceAdminPhoto(admin.id, event.target.files?.[0])} disabled={isBusy} /><span>Change photo</span></label></div>)}
              {collegeAdmins.length === 0 && <p className="workspace-muted">No college admins have been created yet.</p>}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}