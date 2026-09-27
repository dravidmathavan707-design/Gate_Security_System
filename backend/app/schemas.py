from datetime import datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=10, max_length=128)
    student_id: str = Field(min_length=2, max_length=40)


class CollegeUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    photo_url: str | None = Field(default=None, max_length=500)
    code: str = Field(min_length=2, max_length=32)
    address: str = Field(min_length=2, max_length=300)
    academic_year: str = Field(min_length=4, max_length=16)
    working_days: list[str] = Field(min_length=1, max_length=7)
    default_gate_closing_time: time
    monthly_late_limit: int = Field(ge=0)
    permission_validity_minutes: int = Field(ge=1)
    parent_notifications_enabled: bool
    emergency_permissions_enabled: bool
    holidays: list[str]


class CollegeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    photo_url: str | None
    logo_updated_by: str | None
    logo_updated_by_role: str | None
    logo_updated_at: datetime | None
    previous_logo: str | None
    new_logo: str | None
    code: str
    address: str
    academic_year: str
    working_days: list[str]
    default_gate_closing_time: time
    monthly_late_limit: int
    permission_validity_minutes: int
    parent_notifications_enabled: bool
    emergency_permissions_enabled: bool
    holidays: list[str]


class CollegeBrandingResponse(BaseModel):
    name: str
    photo_url: str | None
    logo_updated_by: str | None
    logo_updated_by_role: str | None
    logo_updated_at: datetime | None


class CollegeAdminCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=12, max_length=128)
    photo_url: str | None = Field(default=None, max_length=500)


class ProfilePhotoUpdate(BaseModel):
    photo_url: str | None = Field(default=None, max_length=500)


class DepartmentCreate(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=2, max_length=180)


class DepartmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    college_id: int
    code: str
    name: str
    hod_user_id: int | None


class StaffClassAssignment(BaseModel):
    academic_year: str
    year: str
    section: str
    advisor_user_id: int
    advisor_name: str


class StaffAssignmentResponse(BaseModel):
    role: str
    department_id: int
    department_code: str
    department_name: str
    hod_name: str | None
    classes: list[StaffClassAssignment]


class GateCreate(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=2, max_length=100)


class GateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    college_id: int
    code: str
    name: str
    is_active: bool


class DepartmentGateQrStatusUpdate(BaseModel):
    status: Literal["active", "disabled"]


class DepartmentGateQrResponse(BaseModel):
    id: int
    department_id: int
    department_code: str
    department_name: str
    gate_id: int
    gate_code: str
    gate_name: str
    status: Literal["active", "disabled"]
    qr_payload: str
    created_by_user_id: int


class DepartmentQrPayload(BaseModel):
    department_qr_id: int
    secure_token: str = Field(min_length=20, max_length=64)
    gate_id: int


class DepartmentQrScanRequest(BaseModel):
    qr_value: str = Field(min_length=2, max_length=500)


class EmployeeCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=12, max_length=128)
    employee_id: str = Field(min_length=2, max_length=48)
    photo_url: str | None = Field(default=None, max_length=500)


class AdvisorCreate(EmployeeCreate):
    department_id: int
    year: str = Field(min_length=1, max_length=16)
    section: str = Field(min_length=1, max_length=16)


class SecurityStaffCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=12, max_length=128)
    employee_id: str = Field(min_length=2, max_length=48)
    gate_id: int
    photo_url: str | None = Field(default=None, max_length=500)


class StudentCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=12, max_length=128)
    student_id: str = Field(min_length=2, max_length=40)
    register_number: str = Field(min_length=2, max_length=48)
    department_id: int
    year: str = Field(min_length=1, max_length=16)
    section: str = Field(min_length=1, max_length=16)
    parent_name: str | None = Field(default=None, max_length=160)
    parent_phone: str | None = Field(default=None, max_length=32)
    parent_email: EmailStr | None = None
    parent_relationship: str | None = Field(default=None, max_length=24)
    photo_url: str | None = Field(default=None, max_length=500)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    role: str
    student_id: str | None
    employee_id: str | None
    register_number: str | None
    college_id: int | None
    department_id: int | None
    gate_id: int | None
    year: str | None
    section: str | None
    advisor_user_id: int | None
    gate_assignment: str | None
    photo_url: str | None


class StudentVerificationResponse(UserResponse):
    department_code: str
    department_name: str
    gate_code: str
    gate_name: str


class LateRequestCreate(BaseModel):
    reason: str = Field(min_length=2, max_length=500)


class LateRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: int
    department_id: int
    advisor_user_id: int | None
    hod_user_id: int | None
    reason: str
    status: str
    decision_note: str | None
    requested_at: datetime
    approved_at: datetime | None
    approved_by_user_id: int | None


class LateEntryPermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    permission_id: str
    request_id: int
    student_id: int
    student_name: str | None = None
    department_id: int | None = None
    department_code: str | None = None
    department_name: str | None = None
    approved_by_user_id: int
    approver_name: str | None = None
    approver_role: str
    approved_at: datetime
    valid_from: datetime
    valid_until: datetime
    status: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class DirectMessageCreate(BaseModel):
    recipient_id: int = Field(gt=0)
    client_message_id: UUID
    body: str = Field(min_length=1, max_length=2000)


class DirectMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sender_id: int
    recipient_id: int
    client_message_id: UUID
    body: str
    created_at: datetime
    delivered_at: datetime | None


class DirectMessagePage(BaseModel):
    items: list[DirectMessageResponse]
    next_cursor: int


class RealtimeTicketResponse(BaseModel):
    ticket: str
    expires_at: datetime
