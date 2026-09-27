from datetime import datetime, timedelta, timezone
import hashlib
import json
import secrets
from pathlib import Path
from uuid import uuid4

import jwt
from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from pydantic import ValidationError
from sqlalchemy import delete, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.staticfiles import StaticFiles

from .config import ACCESS_TOKEN_MINUTES, CORS_ORIGIN_REGEX, CORS_ORIGINS, JWT_ALGORITHM, JWT_SECRET
from .database import SessionLocal, get_db
from .models import (
    ClassAdvisorAssignment,
    College,
    CollegeLogoAudit,
    Department,
    DepartmentGateQr,
    DirectMessage,
    Gate,
    LateEntryPermission,
    LateRequest,
    RealtimeTicket,
    User,
)
from .schemas import (
    AdvisorCreate,
    AuthResponse,
    CollegeAdminCreate,
    CollegeBrandingResponse,
    CollegeResponse,
    CollegeUpdate,
    DepartmentCreate,
    DepartmentGateQrResponse,
    DepartmentGateQrStatusUpdate,
    DepartmentResponse,
    DepartmentQrPayload,
    DepartmentQrScanRequest,
    DirectMessageCreate,
    DirectMessagePage,
    DirectMessageResponse,
    EmployeeCreate,
    GateCreate,
    GateResponse,
    LateEntryPermissionResponse,
    LateRequestCreate,
    LateRequestResponse,
    LoginRequest,
    ProfilePhotoUpdate,
    RegisterRequest,
    RealtimeTicketResponse,
    SecurityStaffCreate,
    StaffAssignmentResponse,
    StudentCreate,
    StudentVerificationResponse,
    UserResponse,
)
from .realtime import realtime_manager


app = FastAPI(title="SMARTGATE API", version="0.1.0")
MEDIA_DIR = Path(__file__).resolve().parents[1] / "uploads"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer()
MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024
PROFILE_IMAGE_TYPES = {
    "image/jpeg": (".jpg", lambda content: content.startswith(b"\xff\xd8\xff")),
    "image/png": (".png", lambda content: content.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": (".webp", lambda content: len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"),
}


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def auth_response(user: User) -> AuthResponse:
    return AuthResponse(access_token=create_access_token(user), user=user)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp"]},
        )
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"admin", "super_admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="College admin access is required",
        )
    return user


def require_security(user: User = Depends(get_current_user)) -> User:
    if user.role != "security":
        raise HTTPException(status_code=403, detail="Security staff access is required")
    return user


def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access is required")
    return user


def get_college(db: Session) -> College:
    college = db.scalar(select(College).order_by(College.id).limit(1))
    if college is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete college setup before creating accounts",
        )
    return college


def get_department(db: Session, department_id: int, college_id: int) -> Department:
    department = db.get(Department, department_id)
    if department is None or department.college_id != college_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Department not found in this college",
        )
    return department


DEPARTMENT_DISPLAY_ORDER = {
    "CCE": 1,
    "CSE": 2,
    "ECE": 3,
    "EEE": 4,
    "MECH": 5,
    "CIVIL": 6,
}


def department_display_key(code: str | None) -> tuple[int, str]:
    normalized = (code or "").strip().upper()
    return (DEPARTMENT_DISPLAY_ORDER.get(normalized, 999), normalized)


def sort_department_qrs(db: Session, qrs: list[DepartmentGateQr]) -> list[DepartmentGateQr]:
    department_ids = {qr.department_id for qr in qrs}
    departments = db.scalars(select(Department).where(Department.id.in_(department_ids))).all()
    department_codes = {department.id: department.code for department in departments}
    return sorted(
        qrs,
        key=lambda qr: (
            department_display_key(department_codes.get(qr.department_id)),
            qr.gate_id,
            qr.id,
        ),
    )


def serialize_department_qr(db: Session, qr: DepartmentGateQr) -> DepartmentGateQrResponse:
    department = db.get(Department, qr.department_id)
    gate = db.get(Gate, qr.gate_id)
    return DepartmentGateQrResponse(
        id=qr.id,
        department_id=department.id,
        department_code=department.code,
        department_name=department.name,
        gate_id=gate.id,
        gate_code=gate.code,
        gate_name=gate.name,
        status=qr.status,
        qr_payload=json.dumps(
            {
                "department_qr_id": qr.id,
                "secure_token": qr.secure_token,
                "gate_id": gate.id,
                "status": "active",
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        created_by_user_id=qr.created_by_user_id,
    )


def serialize_late_entry_permission(db: Session, permission: LateEntryPermission) -> LateEntryPermissionResponse:
    student = db.get(User, permission.student_id)
    approver = db.get(User, permission.approved_by_user_id)
    department = db.get(Department, student.department_id) if student and student.department_id is not None else None
    return LateEntryPermissionResponse(
        permission_id=permission.permission_id,
        request_id=permission.request_id,
        student_id=permission.student_id,
        student_name=student.full_name if student else None,
        department_id=department.id if department else None,
        department_code=department.code if department else None,
        department_name=department.name if department else None,
        approved_by_user_id=permission.approved_by_user_id,
        approver_name=approver.full_name if approver else None,
        approver_role=permission.approver_role,
        approved_at=permission.approved_at,
        valid_from=permission.valid_from,
        valid_until=permission.valid_until,
        status=permission.status,
    )


def create_late_entry_permission(
    late_request: LateRequest,
    approving_staff: User,
    approver_role: str,
    db: Session,
    valid_minutes: int,
) -> LateEntryPermission:
    existing = db.scalar(select(LateEntryPermission).where(LateEntryPermission.request_id == late_request.id))
    if existing is not None:
        return existing

    now = datetime.now(timezone.utc)
    permission = LateEntryPermission(
        request_id=late_request.id,
        student_id=late_request.student_id,
        approved_by_user_id=approving_staff.id,
        approver_role=approver_role,
        approved_at=now,
        valid_from=now,
        valid_until=now + timedelta(minutes=valid_minutes),
        status="approved",
    )
    db.add(permission)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Permission already exists for this request") from exc
    db.refresh(permission)
    return permission


def create_department_qr(
    department_id: int,
    gate_id: int,
    actor: User,
    db: Session,
) -> DepartmentGateQr:
    college = get_college(db)
    department = get_department(db, department_id, college.id)
    gate = db.get(Gate, gate_id)
    if gate is None or gate.college_id != college.id or not gate.is_active:
        raise HTTPException(status_code=404, detail="Active gate not found in this college")
    if actor.role == "hod" and (
        actor.department_id != department.id or department.hod_user_id != actor.id
    ):
        raise HTTPException(status_code=403, detail="HODs can manage QR codes only for their department")
    existing = db.scalar(
        select(DepartmentGateQr.id).where(
            DepartmentGateQr.department_id == department.id,
            DepartmentGateQr.gate_id == gate.id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="A department QR already exists for this gate")
    qr = DepartmentGateQr(
        department_id=department.id,
        gate_id=gate.id,
        created_by_user_id=actor.id,
    )
    db.add(qr)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A department QR already exists for this gate") from exc
    db.refresh(qr)
    return qr


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/admin/profile-images", status_code=201)
async def upload_profile_image(
    image: UploadFile = File(...),
    _admin: User = Depends(require_admin),
) -> dict[str, str]:
    image_type = PROFILE_IMAGE_TYPES.get(image.content_type or "")
    if image_type is None:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP image")

    content = await image.read(MAX_PROFILE_IMAGE_SIZE + 1)
    await image.close()
    if len(content) > MAX_PROFILE_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Profile images must be 5 MB or smaller")
    extension, signature_is_valid = image_type
    if not signature_is_valid(content):
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid image")

    filename = f"{uuid4().hex}{extension}"
    (MEDIA_DIR / filename).write_bytes(content)
    return {"photo_url": f"/media/{filename}"}


def validate_uploaded_photo_url(photo_url: str | None) -> None:
    if photo_url is not None and not photo_url.startswith("/media/"):
        raise HTTPException(status_code=422, detail="Profile images must be uploaded through SMARTGATE")


def record_college_logo_change(
    college: College,
    actor: User,
    photo_url: str | None,
    db: Session,
) -> None:
    validate_uploaded_photo_url(photo_url)
    previous_logo = college.photo_url
    if previous_logo == photo_url:
        return

    changed_at = datetime.now(timezone.utc)
    college.photo_url = photo_url
    college.logo_updated_by = actor.full_name
    college.logo_updated_by_role = actor.role
    college.logo_updated_at = changed_at
    college.previous_logo = previous_logo
    college.new_logo = photo_url
    db.add(CollegeLogoAudit(
        college_id=college.id,
        logo_updated_by_user_id=actor.id,
        logo_updated_by=actor.full_name,
        logo_updated_by_role=actor.role,
        logo_updated_at=changed_at,
        previous_logo=previous_logo,
        new_logo=photo_url,
    ))


@app.put("/admin/college/photo", response_model=CollegeResponse)
def update_college_photo(
    payload: ProfilePhotoUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> College:
    college = get_college(db)
    record_college_logo_change(college, admin, payload.photo_url, db)
    db.commit()
    db.refresh(college)
    return college


@app.put("/admin/users/{user_id}/photo", response_model=UserResponse)
def update_user_photo(
    user_id: int,
    payload: ProfilePhotoUpdate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    validate_uploaded_photo_url(payload.photo_url)
    college = get_college(db)
    user = db.get(User, user_id)
    if user is None or user.college_id != college.id:
        raise HTTPException(status_code=404, detail="Account not found")
    user.photo_url = payload.photo_url
    db.commit()
    db.refresh(user)
    return user


@app.get("/college/branding", response_model=CollegeBrandingResponse)
def read_college_branding(
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> College:
    return get_college(db)


@app.post("/auth/register", response_model=AuthResponse, status_code=201, include_in_schema=False)
def register(payload: RegisterRequest) -> None:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Student accounts are created by the college admin",
    )


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if user is None or not password_hash.verify(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return auth_response(user)


@app.get("/auth/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@app.post("/super-admin/college-admins", response_model=UserResponse, status_code=201)
def create_college_admin(
    payload: CollegeAdminCreate,
    _super_admin: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> User:
    college = get_college(db)
    validate_uploaded_photo_url(payload.photo_url)
    admin = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name.strip(),
        password_hash=password_hash.hash(payload.password),
        role="admin",
        college_id=college.id,
        photo_url=payload.photo_url,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists") from exc
    db.refresh(admin)
    return admin


@app.post("/admin/college", response_model=CollegeResponse, status_code=201)
def create_college(
    payload: CollegeUpdate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> College:
    validate_uploaded_photo_url(payload.photo_url)
    if db.scalar(select(College.id).limit(1)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This SMARTGATE instance already has a college profile",
        )
    payload_values = payload.model_dump(exclude={"photo_url"})
    college = College(**payload_values)
    db.add(college)
    try:
        db.flush()
        record_college_logo_change(college, _admin, payload.photo_url, db)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="College code already exists") from exc
    db.refresh(college)

    if _admin.college_id is None:
        _admin.college_id = college.id
        db.add(_admin)
        db.commit()

    return college


@app.get("/admin/college", response_model=CollegeResponse)
def read_college(
    _admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> College:
    return get_college(db)


@app.put("/admin/college", response_model=CollegeResponse)
def update_college(
    payload: CollegeUpdate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> College:
    college = get_college(db)
    values = payload.model_dump(exclude_unset=True)
    if "photo_url" in values:
        record_college_logo_change(college, _admin, values.pop("photo_url"), db)
    for field, value in values.items():
        setattr(college, field, value)
    db.commit()
    db.refresh(college)
    return college


@app.post("/admin/departments", response_model=DepartmentResponse, status_code=201)
def create_department(
    payload: DepartmentCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Department:
    college = get_college(db)
    department = Department(
        college_id=college.id,
        code=payload.code.strip().upper(),
        name=payload.name.strip(),
    )
    db.add(department)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Department code already exists") from exc
    db.refresh(department)
    return department


@app.get("/admin/departments", response_model=list[DepartmentResponse])
def list_departments(
    _admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[Department]:
    college = get_college(db)
    return list(
        db.scalars(
            select(Department)
            .where(Department.college_id == college.id)
            .order_by(Department.code)
        )
    )


@app.delete("/admin/departments/{department_id}")
def delete_department(
    department_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, bool | int]:
    college = get_college(db)
    department = db.get(Department, department_id)
    if department is None or department.college_id != college.id:
        raise HTTPException(status_code=404, detail="Department not found")

    if department.hod_user_id is not None:
        hod = db.get(User, department.hod_user_id)
        if hod is not None:
            hod.department_id = None
            hod.year = None
            hod.section = None

    db.execute(
        update(User)
        .where(User.department_id == department.id)
        .values(department_id=None, year=None, section=None, advisor_user_id=None)
    )
    db.execute(delete(ClassAdvisorAssignment).where(ClassAdvisorAssignment.department_id == department.id))
    db.execute(delete(DepartmentGateQr).where(DepartmentGateQr.department_id == department.id))
    db.delete(department)
    db.commit()
    return {"ok": True, "deleted_department_id": department_id}


@app.get("/admin/gates", response_model=list[GateResponse])
def list_gates(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[Gate]:
    college = get_college(db)
    return list(
        db.scalars(
            select(Gate).where(Gate.college_id == college.id).order_by(Gate.code)
        )
    )


@app.delete("/admin/users/{user_id}")
def delete_user_account(
    user_id: int,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, bool | int]:
    if current_admin.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account")

    user = db.get(User, user_id)
    college = get_college(db)
    if user is None or user.college_id != college.id:
        raise HTTPException(status_code=404, detail="Account not found")

    if user.role == "hod":
        department = db.get(Department, user.department_id)
        if department is not None and department.hod_user_id == user.id:
            department.hod_user_id = None
    elif user.role == "advisor":
        db.execute(delete(ClassAdvisorAssignment).where(ClassAdvisorAssignment.advisor_user_id == user.id))
    elif user.role == "security":
        user.gate_id = None
        user.gate_assignment = None

    if user.department_id is not None:
        db.execute(
            update(User)
            .where(User.id == user.id)
            .values(department_id=None, year=None, section=None, advisor_user_id=None)
        )

    db.delete(user)
    db.commit()
    return {"ok": True, "deleted_user_id": user_id}


@app.get("/admin/users", response_model=list[UserResponse])
def list_admin_users(
    role: str | None = None,
    department_id: int | None = None,
    search: str | None = Query(default=None, max_length=100),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    college = get_college(db)
    query = select(User).where(User.college_id == college.id)
    if role is not None:
        if role not in {"admin", "hod", "advisor", "security", "student"}:
            raise HTTPException(status_code=422, detail="Unsupported account role filter")
        query = query.where(User.role == role)
    if department_id is not None:
        query = query.where(User.department_id == department_id)
    if search:
        search_term = f"%{search.strip()}%"
        query = query.where(
            User.full_name.ilike(search_term)
            | User.email.ilike(search_term)
            | User.student_id.ilike(search_term)
            | User.register_number.ilike(search_term)
            | User.employee_id.ilike(search_term)
        )
    return list(db.scalars(query.order_by(User.role, User.full_name).limit(500)))


@app.get("/admin/department-qrs", response_model=list[DepartmentGateQrResponse])
def list_admin_department_qrs(
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[DepartmentGateQrResponse]:
    college = get_college(db)
    qrs = list(
        db.scalars(
            select(DepartmentGateQr)
            .join(Department, Department.id == DepartmentGateQr.department_id)
            .where(Department.college_id == college.id)
        )
    )
    return [serialize_department_qr(db, qr) for qr in sort_department_qrs(db, qrs)]


@app.get("/staff/assignments", response_model=StaffAssignmentResponse)
def get_staff_assignments(
    staff: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StaffAssignmentResponse:
    if staff.role not in {"hod", "advisor"} or staff.department_id is None:
        raise HTTPException(status_code=403, detail="HOD or advisor access is required")
    department = db.get(Department, staff.department_id)
    if department is None or department.college_id != staff.college_id:
        raise HTTPException(status_code=404, detail="Assigned department not found")
    hod = db.get(User, department.hod_user_id) if department.hod_user_id else None
    statement = (
        select(ClassAdvisorAssignment, User)
        .join(User, User.id == ClassAdvisorAssignment.advisor_user_id)
        .where(
            ClassAdvisorAssignment.department_id == department.id,
            ClassAdvisorAssignment.academic_year == get_college(db).academic_year,
        )
    )
    if staff.role == "advisor":
        statement = statement.where(ClassAdvisorAssignment.advisor_user_id == staff.id)
    assignments = db.execute(statement.order_by(ClassAdvisorAssignment.year, ClassAdvisorAssignment.section))
    return StaffAssignmentResponse(
        role=staff.role,
        department_id=department.id,
        department_code=department.code,
        department_name=department.name,
        hod_name=hod.full_name if hod else None,
        classes=[
            {
                "academic_year": assignment.academic_year,
                "year": assignment.year,
                "section": assignment.section,
                "advisor_user_id": advisor.id,
                "advisor_name": advisor.full_name,
            }
            for assignment, advisor in assignments
        ],
    )


@app.post("/staff/students", response_model=UserResponse, status_code=201)
def create_staff_student(
    payload: StudentCreate,
    staff: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if staff.role not in {"hod", "advisor"} or staff.department_id is None:
        raise HTTPException(status_code=403, detail="HOD or advisor access is required")

    college = get_college(db)
    validate_uploaded_photo_url(payload.photo_url)
    if payload.department_id != staff.department_id:
        raise HTTPException(status_code=403, detail="Staff can create students only in their department")
    department = get_department(db, payload.department_id, college.id)
    class_year = payload.year.strip()
    class_section = payload.section.strip()
    assignment_query = select(ClassAdvisorAssignment).where(
        ClassAdvisorAssignment.department_id == department.id,
        ClassAdvisorAssignment.academic_year == college.academic_year,
        ClassAdvisorAssignment.year == class_year,
        ClassAdvisorAssignment.section == class_section,
    )
    assignment = db.scalar(assignment_query)
    if assignment is None:
        raise HTTPException(status_code=409, detail="Assign an advisor to this class before creating students")
    if staff.role == "advisor" and assignment.advisor_user_id != staff.id:
        raise HTTPException(status_code=403, detail="Advisors can create students only in their assigned class")

    student = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name.strip(),
        password_hash=password_hash.hash(payload.password),
        role="student",
        student_id=payload.student_id.strip(),
        register_number=payload.register_number.strip(),
        college_id=college.id,
        department_id=department.id,
        year=class_year,
        section=class_section,
        advisor_user_id=assignment.advisor_user_id,
        parent_name=payload.parent_name.strip() if payload.parent_name else None,
        parent_phone=payload.parent_phone.strip() if payload.parent_phone else None,
        parent_email=str(payload.parent_email).lower() if payload.parent_email else None,
        parent_relationship=payload.parent_relationship.strip() if payload.parent_relationship else None,
        photo_url=payload.photo_url.strip() if payload.photo_url else None,
    )
    db.add(student)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email, student ID, or register number already exists") from exc
    db.refresh(student)
    return student


@app.post("/late-requests", response_model=LateRequestResponse, status_code=201)
def create_late_request(
    payload: LateRequestCreate,
    student: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LateRequest:
    if student.role != "student":
        raise HTTPException(status_code=403, detail="Student account required")
    if student.department_id is None:
        raise HTTPException(status_code=409, detail="Student is not assigned to a department")
    college = get_college(db)
    department = db.get(Department, student.department_id)
    if department is None or department.college_id != college.id:
        raise HTTPException(status_code=404, detail="Assigned department not found")
    if department.hod_user_id is None:
        raise HTTPException(status_code=409, detail="Assign a department HOD before creating late requests")

    assignment = db.scalar(
        select(ClassAdvisorAssignment).where(
            ClassAdvisorAssignment.department_id == department.id,
            ClassAdvisorAssignment.academic_year == college.academic_year,
            ClassAdvisorAssignment.year == student.year,
            ClassAdvisorAssignment.section == student.section,
        )
    )
    if assignment is None:
        raise HTTPException(status_code=409, detail="Assign an advisor to this class before creating late requests")

    advisor = db.get(User, assignment.advisor_user_id)
    if advisor is None:
        raise HTTPException(status_code=409, detail="Assigned advisor is unavailable")

    late_request = LateRequest(
        student_id=student.id,
        department_id=department.id,
        advisor_user_id=advisor.id,
        hod_user_id=department.hod_user_id,
        reason=payload.reason.strip(),
        status="pending_approval",
    )
    db.add(late_request)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Late request could not be created") from exc
    db.refresh(late_request)
    return late_request


@app.get("/staff/late-requests", response_model=list[LateRequestResponse])
def list_staff_late_requests(
    staff: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LateRequest]:
    if staff.role not in {"advisor", "hod"}:
        raise HTTPException(status_code=403, detail="Staff access is required")

    query = select(LateRequest).where(LateRequest.status == "pending_approval")
    if staff.role == "advisor":
        query = query.where(LateRequest.advisor_user_id == staff.id)
    else:
        if staff.department_id is None:
            raise HTTPException(status_code=403, detail="Department assignment required")
        query = query.where(LateRequest.hod_user_id == staff.id)
    return list(db.scalars(query.order_by(LateRequest.requested_at.desc())))


@app.post("/staff/late-requests/{request_id}/approve", response_model=LateRequestResponse)
def approve_late_request(
    request_id: int,
    payload: dict[str, str] | None = None,
    staff: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LateRequest:
    if staff.role not in {"advisor", "hod"}:
        raise HTTPException(status_code=403, detail="Staff access is required")

    late_request = db.get(LateRequest, request_id)
    if late_request is None:
        raise HTTPException(status_code=404, detail="Late request not found")
    if late_request.status != "pending_approval":
        raise HTTPException(status_code=409, detail="This request is no longer pending approval")
    if staff.role == "advisor" and late_request.advisor_user_id != staff.id:
        raise HTTPException(status_code=403, detail="This request is not assigned to your advisory class")
    if staff.role == "hod" and late_request.hod_user_id != staff.id:
        raise HTTPException(status_code=403, detail="This request is not assigned to your department")

    now = datetime.now(timezone.utc)
    college = get_college(db)
    late_request.status = "approved"
    late_request.approved_at = now
    late_request.approved_by_user_id = staff.id
    late_request.decision_note = (payload or {}).get("decision_note") or "Approved"

    permission = create_late_entry_permission(
        late_request=late_request,
        approving_staff=staff,
        approver_role=staff.role,
        db=db,
        valid_minutes=college.permission_validity_minutes,
    )
    db.refresh(late_request)
    db.refresh(permission)
    return late_request


@app.post("/staff/late-requests/{request_id}/reject", response_model=LateRequestResponse)
def reject_late_request(
    request_id: int,
    payload: dict[str, str] | None = None,
    staff: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LateRequest:
    if staff.role not in {"advisor", "hod"}:
        raise HTTPException(status_code=403, detail="Staff access is required")

    late_request = db.get(LateRequest, request_id)
    if late_request is None:
        raise HTTPException(status_code=404, detail="Late request not found")
    if late_request.status != "pending_approval":
        raise HTTPException(status_code=409, detail="This request is no longer pending approval")
    if staff.role == "advisor" and late_request.advisor_user_id != staff.id:
        raise HTTPException(status_code=403, detail="This request is not assigned to your advisory class")
    if staff.role == "hod" and late_request.hod_user_id != staff.id:
        raise HTTPException(status_code=403, detail="This request is not assigned to your department")

    late_request.status = "rejected"
    late_request.approved_at = datetime.now(timezone.utc)
    late_request.approved_by_user_id = staff.id
    late_request.decision_note = (payload or {}).get("decision_note") or "Rejected"
    db.commit()
    db.refresh(late_request)
    return late_request


@app.get("/workspace/contacts", response_model=list[UserResponse])
def list_workspace_contacts(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[User]:
    if user.college_id is None:
        return []

    contact_ids: set[int] = set()
    if user.role in {"admin", "super_admin"}:
        query = select(User).where(User.college_id == user.college_id, User.id != user.id)
        return list(db.scalars(query.order_by(User.role, User.full_name).limit(500)))

    if user.role in {"hod", "advisor"} and user.department_id is not None:
        department = db.get(Department, user.department_id)
        if department is None or department.college_id != user.college_id:
            return []
        contact_ids.update(
            db.scalars(
                select(User.id).where(
                    User.college_id == user.college_id,
                    User.department_id == department.id,
                    User.role.in_(("hod", "advisor")),
                    User.id != user.id,
                )
            )
        )
        if user.role == "hod":
            contact_ids.update(
                db.scalars(
                    select(User.id).where(
                        User.department_id == department.id,
                        User.role == "student",
                    )
                )
            )
        else:
            assignments = db.scalars(
                select(ClassAdvisorAssignment).where(
                    ClassAdvisorAssignment.advisor_user_id == user.id,
                    ClassAdvisorAssignment.academic_year == get_college(db).academic_year,
                )
            )
            class_pairs = {(assignment.year, assignment.section) for assignment in assignments}
            if class_pairs:
                contact_ids.update(
                    db.scalars(
                        select(User.id).where(
                            User.department_id == department.id,
                            User.role == "student",
                            tuple_(User.year, User.section).in_(class_pairs),
                        )
                    )
                )

    elif user.role == "student":
        if user.advisor_user_id is not None:
            contact_ids.add(user.advisor_user_id)
        if user.department_id is not None:
            department = db.get(Department, user.department_id)
            if department is not None and department.hod_user_id is not None:
                contact_ids.add(department.hod_user_id)
    elif user.role == "security" and user.gate_id is not None:
        contact_ids.update(
            db.scalars(
                select(User.id).where(
                    User.college_id == user.college_id,
                    User.role == "admin",
                )
            )
        )
        contact_ids.update(
            db.scalars(
                select(Department.hod_user_id)
                .join(DepartmentGateQr, DepartmentGateQr.department_id == Department.id)
                .where(
                    DepartmentGateQr.gate_id == user.gate_id,
                    Department.hod_user_id.is_not(None),
                )
            )
        )

    if not contact_ids:
        return []
    return list(
        db.scalars(
            select(User)
            .where(User.id.in_(contact_ids), User.id != user.id)
            .order_by(User.role, User.full_name)
        )
    )


@app.post("/admin/gates", response_model=GateResponse, status_code=201)
def create_gate(
    payload: GateCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Gate:
    college = get_college(db)
    gate = Gate(
        college_id=college.id,
        code=payload.code.strip().upper(),
        name=payload.name.strip(),
    )
    db.add(gate)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Gate code already exists") from exc
    db.refresh(gate)
    return gate


@app.post(
    "/admin/departments/{department_id}/gates/{gate_id}/qr",
    response_model=DepartmentGateQrResponse,
    status_code=201,
)
def admin_create_department_qr(
    department_id: int,
    gate_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DepartmentGateQrResponse:
    qr = create_department_qr(department_id, gate_id, admin, db)
    return serialize_department_qr(db, qr)


@app.post(
    "/hod/departments/{department_id}/gates/{gate_id}/qr",
    response_model=DepartmentGateQrResponse,
    status_code=201,
)
def hod_create_department_qr(
    department_id: int,
    gate_id: int,
    hod: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DepartmentGateQrResponse:
    if hod.role != "hod":
        raise HTTPException(status_code=403, detail="HOD access is required")
    qr = create_department_qr(department_id, gate_id, hod, db)
    return serialize_department_qr(db, qr)


@app.get("/hod/department-qrs", response_model=list[DepartmentGateQrResponse])
def list_hod_department_qrs(
    hod: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DepartmentGateQrResponse]:
    if hod.role != "hod" or hod.department_id is None:
        raise HTTPException(status_code=403, detail="HOD access is required")
    department = db.get(Department, hod.department_id)
    if department is None or department.hod_user_id != hod.id:
        raise HTTPException(status_code=403, detail="This account is not the assigned department HOD")
    qrs = list(
        db.scalars(
            select(DepartmentGateQr)
            .where(DepartmentGateQr.department_id == department.id)
        )
    )
    return [serialize_department_qr(db, qr) for qr in sort_department_qrs(db, qrs)]


@app.get("/hod/gates", response_model=list[GateResponse])
def list_hod_gates(
    hod: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Gate]:
    if hod.role != "hod" or hod.department_id is None:
        raise HTTPException(status_code=403, detail="HOD access is required")
    department = db.get(Department, hod.department_id)
    if department is None or department.hod_user_id != hod.id:
        raise HTTPException(status_code=403, detail="This account is not the assigned department HOD")
    return list(
        db.scalars(
            select(Gate)
            .where(Gate.college_id == department.college_id, Gate.is_active.is_(True))
            .order_by(Gate.code)
        )
    )


def set_department_qr_status(
    qr_id: int,
    status_value: str,
    actor: User,
    db: Session,
) -> DepartmentGateQrResponse:
    qr = db.get(DepartmentGateQr, qr_id)
    if qr is None:
        raise HTTPException(status_code=404, detail="Department QR not found")
    if actor.role == "hod":
        department = db.get(Department, qr.department_id)
        if department is None or department.hod_user_id != actor.id:
            raise HTTPException(status_code=403, detail="HODs can manage QR codes only for their department")
    if status_value == "active":
        gate = db.get(Gate, qr.gate_id)
        if gate is None or not gate.is_active:
            raise HTTPException(status_code=409, detail="An inactive gate cannot accept new requests")
    qr.status = status_value
    db.commit()
    db.refresh(qr)
    return serialize_department_qr(db, qr)


@app.put("/admin/department-qrs/{qr_id}", response_model=DepartmentGateQrResponse)
def admin_update_department_qr(
    qr_id: int,
    payload: DepartmentGateQrStatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DepartmentGateQrResponse:
    return set_department_qr_status(qr_id, payload.status, admin, db)


@app.put("/hod/department-qrs/{qr_id}", response_model=DepartmentGateQrResponse)
def hod_update_department_qr(
    qr_id: int,
    payload: DepartmentGateQrStatusUpdate,
    hod: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DepartmentGateQrResponse:
    if hod.role != "hod":
        raise HTTPException(status_code=403, detail="HOD access is required")
    return set_department_qr_status(qr_id, payload.status, hod, db)


@app.get("/security/department-qrs", response_model=list[DepartmentGateQrResponse])
def list_security_department_qrs(
    security: User = Depends(require_security),
    db: Session = Depends(get_db),
) -> list[DepartmentGateQrResponse]:
    if security.college_id is None:
        raise HTTPException(status_code=403, detail="Security staff must belong to a college")
    if security.gate_id is None:
        raise HTTPException(status_code=403, detail="Security staff must be assigned to a gate")

    qrs = list(
        db.scalars(
            select(DepartmentGateQr)
            .join(Department, Department.id == DepartmentGateQr.department_id)
            .join(Gate, Gate.id == DepartmentGateQr.gate_id)
            .where(
                Department.college_id == security.college_id,
                Gate.college_id == security.college_id,
                Gate.is_active.is_(True),
                DepartmentGateQr.gate_id == security.gate_id,
            )
        )
    )
    return [serialize_department_qr(db, qr) for qr in sort_department_qrs(db, qrs)]


@app.get("/students/permissions", response_model=list[LateEntryPermissionResponse])
def list_student_permissions(
    student: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LateEntryPermissionResponse]:
    if student.role != "student":
        raise HTTPException(status_code=403, detail="Student access is required")

    now = datetime.now(timezone.utc)
    permissions = db.scalars(
        select(LateEntryPermission)
        .where(
            LateEntryPermission.student_id == student.id,
            LateEntryPermission.status == "approved",
            LateEntryPermission.valid_until > now,
        )
        .order_by(LateEntryPermission.valid_until.desc())
    ).all()
    return [serialize_late_entry_permission(db, permission) for permission in permissions]


@app.get("/security/approved-students", response_model=list[LateEntryPermissionResponse])
def list_security_approved_students(
    security: User = Depends(require_security),
    db: Session = Depends(get_db),
) -> list[LateEntryPermissionResponse]:
    if security.college_id is None:
        raise HTTPException(status_code=403, detail="Security staff must belong to a college")

    now = datetime.now(timezone.utc)
    permissions = db.scalars(
        select(LateEntryPermission)
        .join(User, User.id == LateEntryPermission.student_id)
        .where(
            User.college_id == security.college_id,
            LateEntryPermission.status == "approved",
            LateEntryPermission.valid_until > now,
        )
        .order_by(LateEntryPermission.valid_until.asc())
    ).all()
    return [serialize_late_entry_permission(db, permission) for permission in permissions]


@app.post("/admin/departments/{department_id}/hod", response_model=UserResponse, status_code=201)
def create_hod(
    department_id: int,
    payload: EmployeeCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    college = get_college(db)
    validate_uploaded_photo_url(payload.photo_url)
    department = get_department(db, department_id, college.id)
    if department.hod_user_id is not None:
        raise HTTPException(status_code=409, detail="This department already has an HOD")
    hod = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name.strip(),
        password_hash=password_hash.hash(payload.password),
        role="hod",
        employee_id=payload.employee_id.strip(),
        college_id=college.id,
        department_id=department.id,
        photo_url=payload.photo_url,
    )
    db.add(hod)
    try:
        db.flush()
        department.hod_user_id = hod.id
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or employee ID already exists") from exc
    db.refresh(hod)
    return hod


@app.post("/admin/advisors", response_model=UserResponse, status_code=201)
def create_advisor(
    payload: AdvisorCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    college = get_college(db)
    validate_uploaded_photo_url(payload.photo_url)
    department = get_department(db, payload.department_id, college.id)
    if department.hod_user_id is None:
        raise HTTPException(status_code=409, detail="Assign the department HOD before its advisors")
    class_year = payload.year.strip()
    class_section = payload.section.strip()
    existing_advisor = db.scalar(
        select(ClassAdvisorAssignment.id).where(
            ClassAdvisorAssignment.department_id == department.id,
            ClassAdvisorAssignment.academic_year == college.academic_year,
            ClassAdvisorAssignment.year == class_year,
            ClassAdvisorAssignment.section == class_section,
        )
    )
    if existing_advisor is not None:
        raise HTTPException(status_code=409, detail="This class section already has an advisor")
    advisor = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name.strip(),
        password_hash=password_hash.hash(payload.password),
        role="advisor",
        employee_id=payload.employee_id.strip(),
        college_id=college.id,
        department_id=department.id,
        photo_url=payload.photo_url,
    )
    db.add(advisor)
    try:
        db.flush()
        db.add(
            ClassAdvisorAssignment(
                department_id=department.id,
                advisor_user_id=advisor.id,
                academic_year=college.academic_year,
                year=class_year,
                section=class_section,
            )
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or employee ID already exists") from exc
    db.refresh(advisor)
    return advisor


@app.post("/admin/security-staff", response_model=UserResponse, status_code=201)
def create_security_staff(
    payload: SecurityStaffCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    college = get_college(db)
    validate_uploaded_photo_url(payload.photo_url)
    gate = db.get(Gate, payload.gate_id)
    if gate is None or gate.college_id != college.id or not gate.is_active:
        raise HTTPException(status_code=404, detail="Active gate not found in this college")
    staff = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name.strip(),
        password_hash=password_hash.hash(payload.password),
        role="security",
        employee_id=payload.employee_id.strip(),
        college_id=college.id,
        gate_id=gate.id,
        gate_assignment=gate.name,
        photo_url=payload.photo_url,
    )
    db.add(staff)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or employee ID already exists") from exc
    db.refresh(staff)
    return staff


@app.post("/admin/students", response_model=UserResponse, status_code=201)
def create_student(
    payload: StudentCreate,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    college = get_college(db)
    validate_uploaded_photo_url(payload.photo_url)
    department = get_department(db, payload.department_id, college.id)
    if department.hod_user_id is None:
        raise HTTPException(status_code=409, detail="Assign the department HOD before its students")
    class_year = payload.year.strip()
    class_section = payload.section.strip()
    advisor = db.scalar(
        select(User)
        .join(ClassAdvisorAssignment, ClassAdvisorAssignment.advisor_user_id == User.id)
        .where(
            ClassAdvisorAssignment.department_id == department.id,
            ClassAdvisorAssignment.academic_year == college.academic_year,
            ClassAdvisorAssignment.year == class_year,
            ClassAdvisorAssignment.section == class_section,
        )
    )
    if advisor is None:
        raise HTTPException(status_code=409, detail="Assign a class advisor before creating its students")
    student = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name.strip(),
        password_hash=password_hash.hash(payload.password),
        role="student",
        student_id=payload.student_id.strip(),
        register_number=payload.register_number.strip(),
        college_id=college.id,
        department_id=department.id,
        year=class_year,
        section=class_section,
        advisor_user_id=advisor.id,
        parent_name=payload.parent_name.strip() if payload.parent_name else None,
        parent_phone=payload.parent_phone.strip() if payload.parent_phone else None,
        parent_email=str(payload.parent_email).lower() if payload.parent_email else None,
        parent_relationship=(
            payload.parent_relationship.strip() if payload.parent_relationship else None
        ),
        photo_url=payload.photo_url.strip() if payload.photo_url else None,
    )
    db.add(student)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Email, student ID, or register number already exists",
        ) from exc
    db.refresh(student)
    return student


@app.post("/students/verify-department-qr", response_model=StudentVerificationResponse)
def verify_student_qr(
    payload: DepartmentQrScanRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StudentVerificationResponse:
    if user.role != "student" or user.student_id is None or user.department_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A student account is required for QR verification",
        )

    try:
        qr_payload = DepartmentQrPayload.model_validate_json(payload.qr_value)
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail="The scanned value is not a valid department gate QR",
        ) from exc

    qr = db.get(DepartmentGateQr, qr_payload.department_qr_id)
    if qr is None or not secrets.compare_digest(qr_payload.secure_token, qr.secure_token):
        raise HTTPException(status_code=404, detail="Department gate QR not found")
    if qr_payload.gate_id != qr.gate_id:
        raise HTTPException(status_code=404, detail="Department gate QR not found")
    if qr.status != "active":
        raise HTTPException(status_code=410, detail="This department gate QR is disabled")

    department = db.get(Department, qr.department_id)
    gate = db.get(Gate, qr.gate_id)
    if department is None or gate is None or not gate.is_active:
        raise HTTPException(status_code=410, detail="This department gate QR is disabled")
    if user.college_id != department.college_id or user.department_id != department.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This QR is not assigned to your student department",
        )

    response = UserResponse.model_validate(user).model_dump()
    response.update(
        department_code=department.code,
        department_name=department.name,
        gate_code=gate.code,
        gate_name=gate.name,
    )
    return StudentVerificationResponse.model_validate(response)


def message_event(message: DirectMessage) -> dict[str, object]:
    return {
        "type": "message.new",
        "message": DirectMessageResponse.model_validate(message).model_dump(mode="json"),
    }


def acknowledge_message(message_id: int, recipient_id: int) -> DirectMessage | None:
    with SessionLocal() as db:
        message = db.scalar(
            select(DirectMessage).where(
                DirectMessage.id == message_id,
                DirectMessage.recipient_id == recipient_id,
            )
        )
        if message is None:
            return None
        if message.delivered_at is None:
            message.delivered_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(message)
        return message


@app.post("/messages", response_model=DirectMessageResponse, status_code=201)
async def send_direct_message(
    payload: DirectMessageCreate,
    response: Response,
    sender: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DirectMessage:
    recipient = db.get(User, payload.recipient_id)
    if recipient is None or sender.college_id is None or recipient.college_id != sender.college_id:
        raise HTTPException(status_code=404, detail="Recipient not found in your college")
    if recipient.id == sender.id:
        raise HTTPException(status_code=422, detail="Messages cannot be sent to yourself")

    message_body = payload.body.strip()
    if not message_body:
        raise HTTPException(status_code=422, detail="Message body cannot be blank")
    client_message_id = str(payload.client_message_id)
    message = db.scalar(
        select(DirectMessage).where(
            DirectMessage.sender_id == sender.id,
            DirectMessage.client_message_id == client_message_id,
        )
    )
    if message is not None:
        if message.recipient_id != recipient.id or message.body != message_body:
            raise HTTPException(
                status_code=409,
                detail="This idempotency key was already used for a different message",
            )
        response.status_code = status.HTTP_200_OK
        if message.delivered_at is None:
            await realtime_manager.publish(recipient.id, message_event(message))
        return message

    message = DirectMessage(
        sender_id=sender.id,
        recipient_id=recipient.id,
        client_message_id=client_message_id,
        body=message_body,
    )
    db.add(message)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        duplicate = db.scalar(
            select(DirectMessage).where(
                DirectMessage.sender_id == sender.id,
                DirectMessage.client_message_id == client_message_id,
            )
        )
        if duplicate is None:
            raise HTTPException(status_code=409, detail="Unable to save message") from exc
        if duplicate.recipient_id != recipient.id or duplicate.body != message_body:
            raise HTTPException(
                status_code=409,
                detail="This idempotency key was already used for a different message",
            ) from exc
        message = duplicate
        response.status_code = status.HTTP_200_OK
    else:
        db.refresh(message)

    if message.delivered_at is None:
        await realtime_manager.publish(recipient.id, message_event(message))
    return message


@app.get("/messages", response_model=DirectMessagePage)
def list_direct_messages(
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DirectMessagePage:
    messages = list(
        db.scalars(
            select(DirectMessage)
            .where(
                DirectMessage.id > after_id,
                (DirectMessage.sender_id == user.id) | (DirectMessage.recipient_id == user.id),
            )
            .order_by(DirectMessage.id)
            .limit(limit)
        )
    )
    next_cursor = messages[-1].id if messages else after_id
    return DirectMessagePage(
        items=[DirectMessageResponse.model_validate(message) for message in messages],
        next_cursor=next_cursor,
    )


@app.post("/messages/{message_id}/ack", response_model=DirectMessageResponse)
def ack_direct_message(
    message_id: int,
    user: User = Depends(get_current_user),
) -> DirectMessage:
    message = acknowledge_message(message_id, user.id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found in your inbox")
    return message


@app.post("/realtime/ticket", response_model=RealtimeTicketResponse)
def create_realtime_ticket(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RealtimeTicketResponse:
    raw_ticket = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=30)
    db.add(
        RealtimeTicket(
            token_hash=hashlib.sha256(raw_ticket.encode()).hexdigest(),
            user_id=user.id,
            expires_at=expires_at,
        )
    )
    db.commit()
    return RealtimeTicketResponse(ticket=raw_ticket, expires_at=expires_at)


@app.websocket("/ws/messages")
async def messages_websocket(websocket: WebSocket, ticket: str = Query(min_length=32, max_length=64)) -> None:
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in CORS_ORIGINS:
        await websocket.close(code=4403)
        return

    token_hash = hashlib.sha256(ticket.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        ticket_row = db.scalar(
            select(RealtimeTicket).where(RealtimeTicket.token_hash == token_hash)
        )
        if ticket_row is None:
            await websocket.close(code=4401)
            return
        user_id = ticket_row.user_id
        claimed = db.execute(
            update(RealtimeTicket)
            .execution_options(synchronize_session=False)
            .where(
                RealtimeTicket.id == ticket_row.id,
                RealtimeTicket.used_at.is_(None),
                RealtimeTicket.expires_at > now,
            )
            .values(used_at=now)
        )
        if claimed.rowcount != 1:
            db.rollback()
            await websocket.close(code=4401)
            return
        db.commit()

    await realtime_manager.connect(user_id, websocket)
    try:
        while True:
            event = await websocket.receive_json()
            if event.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif event.get("type") == "message.ack":
                try:
                    message_id = int(event.get("message_id"))
                except (TypeError, ValueError):
                    await websocket.send_json({"type": "error", "detail": "Invalid message ID"})
                    continue
                message = acknowledge_message(message_id, user_id)
                if message is None:
                    await websocket.send_json({"type": "error", "detail": "Message not found"})
                else:
                    await websocket.send_json(
                        {"type": "message.acknowledged", "message_id": message.id}
                    )
            else:
                await websocket.send_json({"type": "error", "detail": "Unsupported event"})
    except WebSocketDisconnect:
        realtime_manager.disconnect(user_id, websocket)
