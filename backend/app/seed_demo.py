import json
import os
from datetime import time

from pwdlib import PasswordHash
from sqlalchemy import select

from .config import DATABASE_URL
from .database import SessionLocal
from .models import (
    ClassAdvisorAssignment,
    College,
    Department,
    DepartmentGateQr,
    Gate,
    User,
)


DEMO_USERS = {
    "admin": {
        "email_env": "SMARTGATE_DEMO_ADMIN_EMAIL",
        "password_env": "SMARTGATE_DEMO_ADMIN_PASSWORD",
        "name": "Demo College Admin",
        "role": "admin",
    },
    "hod": {
        "email_env": "SMARTGATE_DEMO_HOD_EMAIL",
        "password_env": "SMARTGATE_DEMO_HOD_PASSWORD",
        "name": "Demo CCE HOD",
        "role": "hod",
        "employee_id": "EMP-DEMO-HOD-CCE",
    },
    "advisor": {
        "email_env": "SMARTGATE_DEMO_ADVISOR_EMAIL",
        "password_env": "SMARTGATE_DEMO_ADVISOR_PASSWORD",
        "name": "Demo CCE Advisor",
        "role": "advisor",
        "employee_id": "EMP-DEMO-ADV-CCE",
    },
    "student": {
        "email_env": "SMARTGATE_DEMO_STUDENT_EMAIL",
        "password_env": "SMARTGATE_DEMO_STUDENT_PASSWORD",
        "name": "Demo Student",
        "role": "student",
        "student_id": "STU-DEMO-CCE-001",
        "register_number": "REG-DEMO-CCE-001",
    },
    "security": {
        "email_env": "SMARTGATE_DEMO_SECURITY_EMAIL",
        "password_env": "SMARTGATE_DEMO_SECURITY_PASSWORD",
        "name": "Demo Main Gate Security",
        "role": "security",
        "employee_id": "EMP-DEMO-SEC-001",
    },
}


def load_demo_users() -> dict[str, dict[str, str]]:
    demo_users = {}
    for key, values in DEMO_USERS.items():
        email = os.getenv(values["email_env"], "").strip().lower()
        password = os.getenv(values["password_env"], "")
        if "@" not in email or len(password) < 12:
            raise SystemExit(
                f"Set {values['email_env']} and {values['password_env']} in backend/.env; "
                "demo passwords must contain at least 12 characters."
            )
        demo_users[key] = {**values, "email": email, "password": password}

    emails = [user["email"] for user in demo_users.values()]
    passwords = [user["password"] for user in demo_users.values()]
    if len(set(emails)) != len(emails):
        raise SystemExit("Each SMARTGATE demo account must have a unique email address.")
    if len(set(passwords)) != len(passwords):
        raise SystemExit("Use a different password for each SMARTGATE demo account.")
    return demo_users


def upsert_user(db, values: dict[str, str], password_hash: PasswordHash, **assignments) -> User:
    user = db.scalar(select(User).where(User.email == values["email"]))
    if user is None:
        legacy_email = values["email"].replace("@demo-smartgate.com", "@demo.smartgate.test")
        user = db.scalar(select(User).where(User.email == legacy_email))
    if user is None:
        user = User(
            email=values["email"],
            full_name=values["name"],
            password_hash=password_hash.hash(values["password"]),
            role=values["role"],
            **assignments,
        )
        db.add(user)
    else:
        user.email = values["email"]
        user.full_name = values["name"]
        user.password_hash = password_hash.hash(values["password"])
        user.role = values["role"]
        for field, value in assignments.items():
            setattr(user, field, value)
    if "employee_id" in values:
        user.employee_id = values["employee_id"]
    if "student_id" in values:
        user.student_id = values["student_id"]
    if "register_number" in values:
        user.register_number = values["register_number"]
    return user


def main() -> None:
    if os.getenv("SMARTGATE_ENABLE_DEMO_SEED") != "1":
        raise SystemExit("Set SMARTGATE_ENABLE_DEMO_SEED=1 to seed local demo accounts.")
    if not DATABASE_URL.startswith("sqlite:"):
        raise SystemExit("Demo seeding is allowed only when DATABASE_URL uses SQLite.")
    demo_users = load_demo_users()

    db = SessionLocal()
    password_hash = PasswordHash.recommended()
    try:
        college = db.scalar(select(College).order_by(College.id).limit(1))
        if college is None:
            college = College(
                name="SMARTGATE Demo College",
                code="DEMO",
                address="1 Demo Campus Road",
                academic_year="2026-27",
                working_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                default_gate_closing_time=time(9, 30),
                monthly_late_limit=3,
                permission_validity_minutes=15,
                parent_notifications_enabled=True,
                emergency_permissions_enabled=True,
                holidays=[],
            )
            db.add(college)
            db.flush()
        elif college.code != "DEMO":
            raise SystemExit(
                "The configured database already has a non-demo college; refusing to alter it."
            )

        department = db.scalar(
            select(Department).where(
                Department.college_id == college.id,
                Department.code == "CCE",
            )
        )
        if department is None:
            department = Department(
                college_id=college.id,
                code="CCE",
                name="Computer and Communication Engineering",
            )
            db.add(department)
            db.flush()

        gate = db.scalar(
            select(Gate).where(Gate.college_id == college.id, Gate.code == "MAIN")
        )
        if gate is None:
            gate = Gate(college_id=college.id, code="MAIN", name="Main Gate", is_active=True)
            db.add(gate)
            db.flush()

        admin = upsert_user(db, demo_users["admin"], password_hash, college_id=college.id)
        hod = upsert_user(
            db,
            demo_users["hod"],
            password_hash,
            college_id=college.id,
            department_id=department.id,
        )
        db.flush()
        department.hod_user_id = hod.id

        advisor = upsert_user(
            db,
            demo_users["advisor"],
            password_hash,
            college_id=college.id,
            department_id=department.id,
        )
        student = upsert_user(
            db,
            demo_users["student"],
            password_hash,
            college_id=college.id,
            department_id=department.id,
            advisor_user_id=advisor.id,
            year="II",
            section="A",
            parent_name="Demo Parent",
            parent_phone="5550100123",
            parent_email="parent@demo-smartgate.com",
            parent_relationship="Guardian",
        )
        security = upsert_user(
            db,
            demo_users["security"],
            password_hash,
            college_id=college.id,
            gate_id=gate.id,
            gate_assignment=gate.name,
        )
        db.flush()

        assignment = db.scalar(
            select(ClassAdvisorAssignment).where(
                ClassAdvisorAssignment.department_id == department.id,
                ClassAdvisorAssignment.academic_year == college.academic_year,
                ClassAdvisorAssignment.year == "II",
                ClassAdvisorAssignment.section == "A",
            )
        )
        if assignment is None:
            db.add(
                ClassAdvisorAssignment(
                    department_id=department.id,
                    advisor_user_id=advisor.id,
                    academic_year=college.academic_year,
                    year="II",
                    section="A",
                )
            )
        else:
            assignment.advisor_user_id = advisor.id

        department_qr = db.scalar(
            select(DepartmentGateQr).where(
                DepartmentGateQr.department_id == department.id,
                DepartmentGateQr.gate_id == gate.id,
            )
        )
        if department_qr is None:
            department_qr = DepartmentGateQr(
                department_id=department.id,
                gate_id=gate.id,
                created_by_user_id=hod.id,
                status="active",
            )
            db.add(department_qr)
            db.flush()
        else:
            department_qr.status = "active"
            department_qr.created_by_user_id = hod.id

        db.commit()
        qr_payload = json.dumps(
            {
                "department_qr_id": department_qr.id,
                "secure_token": department_qr.secure_token,
                "gate_id": gate.id,
                "status": "active",
            },
            separators=(",", ":"),
            sort_keys=True,
        )
        print("SMARTGATE demo accounts seeded. These credentials are for local testing only.")
        for key, values in demo_users.items():
            print(f"{key:8} {values['email']}")
        print(f"\nActive CCE / Main Gate QR payload:\n{qr_payload}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
