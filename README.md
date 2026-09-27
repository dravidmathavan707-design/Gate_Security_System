# SMARTGATE

SMARTGATE is a late-entry authorization system for students, advisors, and campus security. React, TypeScript, and Vite power the student client; FastAPI is the source of truth for college onboarding, identity, and department QR verification.

## Current status

The implemented foundation includes a CLI-bootstrapped super admin, college profile and configurable rules, departments, HOD/advisor/security/student provisioning, automatic class-advisor assignment, gate records, and admin/HOD-controlled fixed department QR codes. Public registration is disabled. Students sign in with college-issued accounts, scan their department's active gate QR, and receive backend-sourced identity/class details. Security can read the registered QR list for its assigned gate but cannot create or edit QR codes.

The complete workflow is not implemented yet. Late requests, HOD/advisor approval decisions, the live approved-student queue, processing locks, time-limited permissions, entry confirmation, WebSockets, history/audit events, parent notifications, and admin UI are still future phases. Approval identity/timestamps/expiry and one-time entry status must remain backend-owned when those phases are added. The current database is SQLite; PostgreSQL deployment is also pending.

The message transport foundation is implemented: authenticated same-college direct messages are persisted, idempotent client keys make retries safe, inbox cursors recover messages after reconnect, and WebSockets push online messages with explicit delivery acknowledgement. Approval and entry workflows do not emit these messages yet because their request/permission records have not been implemented.

## Run the API

Requires Python 3.10 or newer.

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
# Generate a value with this command and put it in JWT_SECRET in .env:
py -c "import secrets; print(secrets.token_urlsafe(48))"
py -m alembic upgrade head
py -m app.bootstrap_admin
py -m uvicorn app.main:app --reload --reload-dir app
```

The API is available at `http://127.0.0.1:8000`; interactive API documentation is at `/docs`. Paste the generated value into `JWT_SECRET` in `backend/.env` before running migrations or starting the API. SQLite data is stored in `backend/smartgate.db` by default. `.env` is git-ignored and must never be committed.

The development reload watcher is limited to `backend/app`, so installing packages in `.venv` will not repeatedly restart Uvicorn. The in-memory WebSocket fan-out is for single-worker development; use Redis Pub/Sub or a shared broker before running multiple API workers.

The bootstrap command prompts for the first super-admin credentials and refuses to create another privileged account. Sign in as that account to create the college profile; then provision departments, HODs, advisors, gates, security accounts, and students through the admin API. After college setup, a super admin can create college-admin accounts. The API does not accept client-selected roles during registration.

### Local demo accounts

For a disposable local SQLite database only, configure unique emails and passwords in `backend/.env`, then opt in to seed a demo college with CCE, a main gate, HOD, advisor, student, security account, and active CCE gate QR. Each demo password must be at least 12 characters and different from the others:

```powershell
$env:SMARTGATE_ENABLE_DEMO_SEED = "1"
py -m app.seed_demo
Remove-Item Env:SMARTGATE_ENABLE_DEMO_SEED
```

Set `SMARTGATE_DEMO_ADMIN_EMAIL` / `SMARTGATE_DEMO_ADMIN_PASSWORD`, `SMARTGATE_DEMO_HOD_EMAIL` / `SMARTGATE_DEMO_HOD_PASSWORD`, `SMARTGATE_DEMO_ADVISOR_EMAIL` / `SMARTGATE_DEMO_ADVISOR_PASSWORD`, `SMARTGATE_DEMO_STUDENT_EMAIL` / `SMARTGATE_DEMO_STUDENT_PASSWORD`, and `SMARTGATE_DEMO_SECURITY_EMAIL` / `SMARTGATE_DEMO_SECURITY_PASSWORD` in the ignored `.env` file. The command refuses non-SQLite databases and databases containing a non-demo college. It is repeatable, prints account emails but never passwords, and prints the active department QR payload for manual scanner testing. Real account passwords are hashed before storage; there are no built-in demo passwords.

The student portal can scan the printed CCE QR payload. Use the email and password values you configured in `.env` to sign in to each demo role.

## Run the student client

Requires Node.js and npm.

```powershell
cd frontend/student
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). The API base defaults to `http://127.0.0.1:8000`; set `VITE_API_BASE_URL` when the API runs elsewhere. Camera scanning requires browser camera permission and a secure context (`localhost` is allowed during development).

## Verify the QR slice

```powershell
cd backend
py -m pip install -r requirements-dev.txt
py -m pytest -q
```

Key onboarding endpoints are `POST /admin/college`, `POST /admin/departments`, `POST /admin/gates`, `POST /admin/departments/{department_id}/hod`, `POST /admin/advisors`, `POST /admin/security-staff`, and `POST /admin/students`. Super-admin-only account provisioning is `POST /super-admin/college-admins`.

Admins and the assigned HOD can create/manage fixed department/gate QR records through `/admin/departments/{department_id}/gates/{gate_id}/qr` and `/hod/departments/{department_id}/gates/{gate_id}/qr`. QR status changes use the matching `/admin/department-qrs/{qr_id}` or `/hod/department-qrs/{qr_id}` endpoint. Security reads `/security/department-qrs`, filtered to its assigned gate. Students submit the scanned opaque payload to `POST /students/verify-department-qr`; the backend checks QR status, gate, college, and department before returning the student profile. The QR contains no student information.

## Messaging and live updates

- `POST /messages` persists a same-college message. Send a UUID `client_message_id`; retry the same request after a timeout to receive the original message instead of creating a duplicate.
- `GET /messages?after_id=0&limit=50` incrementally syncs sent and received messages after reconnect. Continue with the returned `next_cursor`.
- `POST /messages/{message_id}/ack` acknowledges receipt. Only the intended recipient can acknowledge it.
- `POST /realtime/ticket` returns a short-lived, one-use WebSocket ticket. Connect to `ws://127.0.0.1:8000/ws/messages?ticket=...` immediately after fetching it.
- The server pushes `{"type":"message.new","message":...}`. Reply with `{"type":"message.ack","message_id":123}`; heartbeat with `{"type":"ping"}` and receive `{"type":"pong"}`.

The database is authoritative: a disconnected client catches up through the cursor endpoint, and live delivery never replaces persistence. Approval and entry event producers will be connected when those workflow records are implemented.

## Repository layout

- `frontend/student`: student web client
- `frontend/staff`: advisor and HOD review client
- `frontend/security`: gate verification client
- `frontend/parent`: parent notifications and history client
- `frontend/admin`: administration and analytics client
- `backend/app`: API, database, models, and authentication
- `docs`: workflow, architecture, API, and security notes
- `database`: schema and seed data

## Planned phases

1. Authentication and database
2. QR and student verification
3. Late-entry request
4. HOD/advisor approval
5. Live permission on student phone
6. Security verification
7. Entry and history
8. Parent notification
9. Admin and analytics
10. Security testing and deployment
