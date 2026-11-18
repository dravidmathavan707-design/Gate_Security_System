# SMARTGATE

SMARTGATE is a late-entry authorization system for students, advisors, and campus security. React, TypeScript, and Vite power the student client; FastAPI is the source of truth for college onboarding, identity, and department QR verification.

## Current status

SMARTGATE includes college onboarding and account provisioning, student department-QR verification, late-entry requests, advisor/HOD approval, a security queue, one-time gate entry, and gate-entry history. Public registration is disabled. Approval, permission validity, and normal online entry decisions are backend-owned. Offline security verification is available after the server signing key and matching frontend public key are configured.

Parent notifications and the planned complete admin analytics experience remain future work. The current database defaults to SQLite; PostgreSQL deployment is supported through `DATABASE_URL` but still requires deployment configuration.

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

### Offline security verification

Offline verification uses a small, gate-scoped set of currently valid approvals signed by the API. The security browser verifies the RSA signatures using a public key pinned into its frontend build. A disconnected device can confirm an entry only while the signed snapshot and permission remain within their validity windows; the default grace period is 30 minutes and `OFFLINE_GRACE_MINUTES` can be set from 1 to 60. When connectivity returns, queued entries are submitted to the API. The server accepts each event at most once, rechecks that its permission is still approved, and records accepted events as `verification_mode=offline`. Revoked, already-used, invalid, or conflicting events are rejected and retained in the sync audit log for review.

Configure a dedicated RSA key pair; never reuse `JWT_SECRET` as the offline signing key. For a local setup, generate the key pair outside the repository:

```powershell
$keyDirectory = Join-Path $env:LOCALAPPDATA "SMARTGATE"
New-Item -ItemType Directory -Force $keyDirectory | Out-Null
$env:SMARTGATE_KEY_DIRECTORY = $keyDirectory
$backendDirectory = Join-Path (Get-Location) "backend"
& "$backendDirectory\.venv\Scripts\python.exe" -c "import os; from pathlib import Path; from cryptography.hazmat.primitives.asymmetric import rsa; from cryptography.hazmat.primitives import serialization; d=Path(os.environ['SMARTGATE_KEY_DIRECTORY']); k=rsa.generate_private_key(public_exponent=65537,key_size=3072); d.joinpath('offline-private.pem').write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())); d.joinpath('offline-public.pem').write_bytes(k.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo))"
```

Set `OFFLINE_SIGNING_PRIVATE_KEY_FILE` in `backend/.env` to the generated private-key path. Copy `frontend/student/.env.example` to `frontend/student/.env.local` and set `VITE_OFFLINE_PUBLIC_KEY` to the matching public PEM (preserve the PEM header/footer and newlines), then rebuild/restart the frontend. The public key is not secret; the private key must be protected, backed up securely, and excluded from source control. Offline verification remains disabled if a signing key is unavailable or the frontend key pin does not match.

The offline cache is stored in the security browser's local storage and is not encrypted by this web application. Use a managed, access-controlled gate device, keep it signed in before an outage, and serve the client over HTTPS in production. The app currently verifies the cached approved queue and still requires the guard to physically confirm the student's identity; it does not scan a student permission QR offline. Offline timestamps come from the device clock, so deployments that need stronger time assurance should use managed-device controls or hardware-backed time before relying on offline acceptance.

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

Keep the security dashboard open and signed in while the device is online so its signed permission snapshot is available before a network outage. Offline entry attempts are shown as pending until server synchronization; a rejected item requires review rather than being silently treated as an accepted server record.

## Run frontend and API on one port

For a single browser origin, build the frontend and let FastAPI serve the built files alongside its API on port 8000:

```powershell
Set-Location frontend/student
npm run build
Set-Location ../../backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app
```

Open `http://127.0.0.1:8000/`. The Vite dev server on port 5173 remains available for hot-reload development, but it is not needed in this single-port mode. The backend serves the frontend build when `frontend/student/dist` exists.

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



run comment : backend:

 cd "c:\Users\dravi\OneDrive\Desktop\late_entery\backend"; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload


 run comment: forndent:

  Set-Location 'c:\Users\dravi\OneDrive\Desktop\late_entery\frontend\student'; npm run dev



cd "c:\Users\dravi\OneDrive\Desktop\late_entery\frontend\student"
npm run build




cd "c:\Users\dravi\OneDrive\Desktop\late_entery\backend"
.\.venv\Scripts\python.exe -m pytest -q tests/test_student_qr.py



$root = "C:\Users\dravi\OneDrive\Desktop\late_entery"
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm --prefix "$root\frontend\student" run build

$backend = "$root\backend"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:JWT_SECRET -ErrorAction SilentlyContinue
& "$backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir $backend --host 127.0.0.1 --port 8000 --reload --reload-dir "$backend\app"

Open http://127.0.0.1:8000/


Backend (PostgreSQL API on port 8000):

$backend = "C:\Users\dravi\OneDrive\Desktop\late_entery\backend"
Remove-Item Env:DATABASE_URL, Env:JWT_SECRET -ErrorAction SilentlyContinue
& "$backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir $backend --host 127.0.0.1 --port 8000 --reload --reload-dir "$backend\app"

Frontend (Vite on port 5173, using the API on 8000):

$frontend = "C:\Users\dravi\OneDrive\Desktop\late_entery\frontend\student"
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm --prefix $frontend run dev


Then open http://127.0.0.1:5173/. These are the separate development-server commands; the single-port mode is served at http://127.0.0.1:8000/ without starting Vite.

11:47


http://127.0.0.1:8000/




Backend:

$backend = "C:\Users\dravi\OneDrive\Desktop\late_entery\backend"
Remove-Item Env:DATABASE_URL, Env:JWT_SECRET -ErrorAction SilentlyContinue
& "$backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir $backend --host 127.0.0.1 --port 8000 --reload --reload-dir "$backend\app"



Frontend:

$frontend = "C:\Users\dravi\OneDrive\Desktop\late_entery\frontend\student"
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm --prefix $frontend run dev