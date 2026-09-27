from datetime import datetime, time, timezone
import secrets

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class College(Base):
    __tablename__ = "colleges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(180))
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_updated_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
    logo_updated_by_role: Mapped[str | None] = mapped_column(String(24), nullable=True)
    logo_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    previous_logo: Mapped[str | None] = mapped_column(String(500), nullable=True)
    new_logo: Mapped[str | None] = mapped_column(String(500), nullable=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    address: Mapped[str] = mapped_column(String(500))
    academic_year: Mapped[str] = mapped_column(String(16))
    working_days: Mapped[list[str]] = mapped_column(JSON)
    default_gate_closing_time: Mapped[time] = mapped_column(Time)
    monthly_late_limit: Mapped[int] = mapped_column(Integer)
    permission_validity_minutes: Mapped[int] = mapped_column(Integer)
    parent_notifications_enabled: Mapped[bool] = mapped_column(Boolean)
    emergency_permissions_enabled: Mapped[bool] = mapped_column(Boolean)
    holidays: Mapped[list[str]] = mapped_column(JSON)


class CollegeLogoAudit(Base):
    __tablename__ = "college_logo_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"), index=True)
    logo_updated_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    logo_updated_by: Mapped[str] = mapped_column(String(160))
    logo_updated_by_role: Mapped[str] = mapped_column(String(24))
    logo_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    previous_logo: Mapped[str | None] = mapped_column(String(500), nullable=True)
    new_logo: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("college_id", "code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(180))
    hod_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True
    )


class Gate(Base):
    __tablename__ = "gates"
    __table_args__ = (UniqueConstraint("college_id", "code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    college_id: Mapped[int] = mapped_column(ForeignKey("colleges.id"), index=True)
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class DepartmentGateQr(Base):
    __tablename__ = "department_gate_qrs"
    __table_args__ = (UniqueConstraint("department_id", "gate_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"), index=True)
    gate_id: Mapped[int] = mapped_column(ForeignKey("gates.id"), index=True)
    secure_token: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, default=lambda: secrets.token_urlsafe(32)
    )
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ClassAdvisorAssignment(Base):
    __tablename__ = "class_advisor_assignments"
    __table_args__ = (
        UniqueConstraint("department_id", "academic_year", "year", "section"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"))
    advisor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    academic_year: Mapped[str] = mapped_column(String(16))
    year: Mapped[str] = mapped_column(String(16))
    section: Mapped[str] = mapped_column(String(16))


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_class_assignment", "college_id", "department_id", "year", "section"),
        Index("ix_users_gate_id", "gate_id"),
        Index("uq_users_employee_id", "employee_id", unique=True),
        Index("uq_users_register_number", "register_number", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(24), default="student")
    student_id: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    register_number: Mapped[str | None] = mapped_column(String(48), nullable=True)
    employee_id: Mapped[str | None] = mapped_column(String(48), nullable=True)
    college_id: Mapped[int | None] = mapped_column(ForeignKey("colleges.id"), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True)
    gate_id: Mapped[int | None] = mapped_column(ForeignKey("gates.id"), nullable=True)
    year: Mapped[str | None] = mapped_column(String(16), nullable=True)
    section: Mapped[str | None] = mapped_column(String(16), nullable=True)
    advisor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    gate_assignment: Mapped[str | None] = mapped_column(String(100), nullable=True)
    parent_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    parent_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    parent_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    parent_relationship: Mapped[str | None] = mapped_column(String(24), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    qr_token: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, default=lambda: secrets.token_urlsafe(32)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class LateRequest(Base):
    __tablename__ = "late_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), index=True)
    advisor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    hod_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="pending_approval", index=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class LateEntryPermission(Base):
    __tablename__ = "late_entry_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    permission_id: Mapped[str] = mapped_column(
        String(32), unique=True, index=True, default=lambda: f"P-{secrets.token_hex(4).upper()}"
    )
    request_id: Mapped[int] = mapped_column(ForeignKey("late_requests.id", ondelete="CASCADE"), unique=True, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    approved_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    approver_role: Mapped[str] = mapped_column(String(24))
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    valid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="approved")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class DirectMessage(Base):
    __tablename__ = "direct_messages"
    __table_args__ = (
        UniqueConstraint("sender_id", "client_message_id", name="uq_direct_message_sender_client_id"),
        Index("ix_direct_messages_recipient_id_id", "recipient_id", "id"),
        Index("ix_direct_messages_sender_id_id", "sender_id", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    client_message_id: Mapped[str] = mapped_column(String(64))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RealtimeTicket(Base):
    __tablename__ = "realtime_tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
