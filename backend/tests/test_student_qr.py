import os
import tempfile
import uuid
import importlib
from datetime import time
from pathlib import Path
from uuid import uuid4

import pytest
from pwdlib import PasswordHash

_test_database_directory = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_test_database_directory.name) / 'test.db'}"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256"

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import User
from app.models import College, CollegeLogoAudit, Department, DepartmentGateQr, Gate, LateEntryPermission


@pytest.fixture(scope="session", autouse=True)
def dispose_test_database():
    yield
    engine.dispose()
    _test_database_directory.cleanup()


@pytest.fixture(autouse=True)
def reset_test_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def provision_student(client: TestClient) -> tuple[dict[str, object], dict[str, str], dict[str, object]]:
    suffix = uuid.uuid4().hex[:10]
    admin = User(
        email=f"admin-{suffix}@example.edu",
        full_name="College Admin",
        password_hash=PasswordHash.recommended().hash("admin-test-password"),
        role="admin",
    )
    db = SessionLocal()
    db.add(admin)
    db.commit()
    db.refresh(admin)
    db.close()

    admin_login = client.post(
        "/auth/login",
        json={
            "email": admin.email,
            "password": "admin-test-password",
        },
    )
    assert admin_login.status_code == 200
    admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

    college = client.post(
        "/admin/college",
        headers=admin_headers,
        json={
            "name": "Test College",
            "code": f"TC-{suffix}",
            "address": "1 Test Road",
            "academic_year": "2026-27",
            "working_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            "default_gate_closing_time": "09:30:00",
            "monthly_late_limit": 3,
            "permission_validity_minutes": 15,
            "parent_notifications_enabled": True,
            "emergency_permissions_enabled": True,
            "holidays": [],
        },
    )
    assert college.status_code == 201

    department = client.post(
        "/admin/departments",
        headers=admin_headers,
        json={"code": "CCE", "name": "Computer and Communication Engineering"},
    )
    assert department.status_code == 201
    department_id = department.json()["id"]

    gate = client.post(
        "/admin/gates",
        headers=admin_headers,
        json={"code": "MAIN", "name": "Main Gate"},
    )
    assert gate.status_code == 201

    hod = client.post(
        f"/admin/departments/{department_id}/hod",
        headers=admin_headers,
        json={
            "email": f"hod-{suffix}@example.edu",
            "full_name": "Test HOD",
            "password": "hod-test-password",
            "employee_id": f"EMP-HOD-{suffix}",
            "department_id": department_id,
        },
    )
    assert hod.status_code == 201

    advisor = client.post(
        "/admin/advisors",
        headers=admin_headers,
        json={
            "email": f"advisor-{suffix}@example.edu",
            "full_name": "Test Advisor",
            "password": "advisor-test-password",
            "employee_id": f"EMP-ADV-{suffix}",
            "department_id": department_id,
            "year": "II",
            "section": "A",
        },
    )
    assert advisor.status_code == 201

    advisor_login = client.post(
        "/auth/login",
        json={"email": f"advisor-{suffix}@example.edu", "password": "advisor-test-password"},
    )
    assert advisor_login.status_code == 200
    advisor_headers = {"Authorization": f"Bearer {advisor_login.json()['access_token']}"}

    hod_login = client.post(
        "/auth/login",
        json={"email": f"hod-{suffix}@example.edu", "password": "hod-test-password"},
    )
    assert hod_login.status_code == 200
    hod_headers = {"Authorization": f"Bearer {hod_login.json()['access_token']}"}
    department_qr = client.post(
        f"/hod/departments/{department_id}/gates/{gate.json()['id']}/qr",
        headers=hod_headers,
    )
    assert department_qr.status_code == 201

    student = client.post(
        "/admin/students",
        headers=admin_headers,
        json={
            "email": f"student-{suffix}@example.edu",
            "full_name": "Test Student",
            "password": "valid-test-password",
            "student_id": f"STU-{suffix}",
            "register_number": f"REG-{suffix}",
            "department_id": department_id,
            "year": "II",
            "section": "A",
            "parent_name": "Test Parent",
            "parent_phone": "5550100",
            "parent_email": f"parent-{suffix}@example.edu",
            "parent_relationship": "Guardian",
        },
    )
    assert student.status_code == 201
    student_login = client.post(
        "/auth/login",
        json={
            "email": f"student-{suffix}@example.edu",
            "password": "valid-test-password",
        },
    )
    assert student_login.status_code == 200
    student_headers = {"Authorization": f"Bearer {student_login.json()['access_token']}"}
    return student_login.json(), student_headers, {
        "college": college.json(),
        "department": department.json(),
        "gate": gate.json(),
        "department_qr": department_qr.json(),
        "hod": hod.json(),
        "hod_headers": hod_headers,
        "advisor": advisor.json(),
        "advisor_headers": advisor_headers,
        "student": student.json(),
        "admin_headers": admin_headers,
    }


def test_legacy_local_email_can_log_in() -> None:
    password = "legacy-test-password"
    user = User(
        email="admin@smartgate.local",
        full_name="Legacy Admin",
        password_hash=PasswordHash.recommended().hash(password),
        role="admin",
    )
    db = SessionLocal()
    db.add(user)
    db.commit()
    email = user.email
    db.close()

    with TestClient(app) as client:
        response = client.post(
            "/auth/login",
            json={"email": email, "password": password},
        )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == email


def test_department_qr_verifies_matching_student_to_backend_profile() -> None:
    with TestClient(app) as client:
        auth, headers, onboarding = provision_student(client)
        qr_value = onboarding["department_qr"]["qr_payload"]
        assert auth["user"]["student_id"] not in qr_value

        verification = client.post(
            "/students/verify-department-qr",
            headers=headers,
            json={"qr_value": qr_value},
        )
        assert verification.status_code == 200
        assert verification.json()["id"] == auth["user"]["id"]
        assert verification.json()["student_id"] == auth["user"]["student_id"]
        assert verification.json()["department_code"] == "CCE"
        assert verification.json()["gate_code"] == "MAIN"


def test_department_qr_rejects_malformed_payload() -> None:
    with TestClient(app) as client:
        _auth, headers, _onboarding = provision_student(client)

        response = client.post(
            "/students/verify-department-qr",
            headers=headers,
            json={"qr_value": "not-a-department-qr"},
        )

        assert response.status_code == 400


def test_admin_uploads_and_audits_college_logo_and_account_photos(tmp_path, monkeypatch) -> None:
    main_module = importlib.import_module("app.main")
    monkeypatch.setattr(main_module, "MEDIA_DIR", tmp_path)
    png = b"\x89PNG\r\n\x1a\nSMARTGATE-TEST-IMAGE"

    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        admin_headers = onboarding["admin_headers"]

        upload = client.post(
            "/admin/profile-images",
            headers=admin_headers,
            files={"image": ("college.png", png, "image/png")},
        )
        assert upload.status_code == 201
        first_logo = upload.json()["photo_url"]

        set_logo = client.put(
            "/admin/college/photo",
            headers=admin_headers,
            json={"photo_url": first_logo},
        )
        assert set_logo.status_code == 200
        assert set_logo.json()["photo_url"] == first_logo
        assert set_logo.json()["logo_updated_by_role"] == "admin"
        assert set_logo.json()["previous_logo"] is None
        assert set_logo.json()["new_logo"] == first_logo

        account_photo = client.put(
            f"/admin/users/{onboarding['student']['id']}/photo",
            headers=admin_headers,
            json={"photo_url": first_logo},
        )
        assert account_photo.status_code == 200
        assert account_photo.json()["photo_url"] == first_logo

        read_only_branding = client.get("/college/branding", headers=student_headers)
        assert read_only_branding.status_code == 200
        assert read_only_branding.json()["photo_url"] == first_logo

        denied_upload = client.post(
            "/admin/profile-images",
            headers=student_headers,
            files={"image": ("college.png", png, "image/png")},
        )
        assert denied_upload.status_code == 403

        remove_logo = client.put(
            "/admin/college/photo",
            headers=admin_headers,
            json={"photo_url": None},
        )
        assert remove_logo.status_code == 200
        assert remove_logo.json()["photo_url"] is None
        assert remove_logo.json()["previous_logo"] == first_logo
        assert remove_logo.json()["new_logo"] is None

        db = SessionLocal()
        audits = db.query(CollegeLogoAudit).order_by(CollegeLogoAudit.id).all()
        assert len(audits) == 2
        assert audits[0].logo_updated_by_role == "admin"
        assert audits[0].new_logo == first_logo
        assert audits[1].previous_logo == first_logo
        assert audits[1].new_logo is None
        db.close()


def test_super_admin_and_admin_can_manage_college_logo_but_students_cannot() -> None:
    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        admin_headers = onboarding["admin_headers"]

        super_admin = User(
            email=f"super-admin-{uuid.uuid4().hex[:8]}@example.edu",
            full_name="Super Admin",
            password_hash=PasswordHash.recommended().hash("super-admin-password"),
            role="super_admin",
        )
        db = SessionLocal()
        db.add(super_admin)
        db.commit()
        db.refresh(super_admin)
        db.close()

        super_login = client.post(
            "/auth/login",
            json={"email": super_admin.email, "password": "super-admin-password"},
        )
        assert super_login.status_code == 200
        super_headers = {"Authorization": f"Bearer {super_login.json()['access_token']}"}

        admin_update = client.put(
            "/admin/college/photo",
            headers=admin_headers,
            json={"photo_url": "/media/admin-logo.png"},
        )
        assert admin_update.status_code == 200
        assert admin_update.json()["photo_url"] == "/media/admin-logo.png"

        super_update = client.put(
            "/admin/college/photo",
            headers=super_headers,
            json={"photo_url": "/media/super-admin-logo.png"},
        )
        assert super_update.status_code == 200
        assert super_update.json()["photo_url"] == "/media/super-admin-logo.png"

        blocked = client.put(
            "/admin/college/photo",
            headers=student_headers,
            json={"photo_url": "/media/student-blocked-logo.png"},
        )
        assert blocked.status_code == 403


def test_security_department_qrs_are_sorted_by_fixed_department_order() -> None:
    with TestClient(app) as client:
        _auth, _student_headers, onboarding = provision_student(client)
        admin_headers = onboarding["admin_headers"]
        college = onboarding["college"]

        gate = onboarding["gate"]
        extra_departments = [
            {"code": "CSE", "name": "Computer Science & Engineering"},
            {"code": "EEE", "name": "Electrical & Electronics Engineering"},
            {"code": "CIVIL", "name": "Civil Engineering"},
            {"code": "MECH", "name": "Mechanical Engineering"},
            {"code": "ECE", "name": "Electronics & Communication Engineering"},
        ]

        created = []
        for department in extra_departments:
            response = client.post(
                "/admin/departments",
                headers=admin_headers,
                json=department,
            )
            assert response.status_code == 201
            created.append(response.json())

        for department in created:
            qr = client.post(
                f"/admin/departments/{department['id']}/gates/{gate['id']}/qr",
                headers=admin_headers,
            )
            assert qr.status_code == 201

        security = client.post(
            "/admin/security-staff",
            headers=admin_headers,
            json={
                "email": f"security-order-{uuid.uuid4().hex[:8]}@example.edu",
                "full_name": "Order Security",
                "password": "security-order-password",
                "employee_id": f"SEC-ORDER-{uuid.uuid4().hex[:8]}",
                "gate_id": gate["id"],
            },
        )
        assert security.status_code == 201

        security_login = client.post(
            "/auth/login",
            json={
                "email": security.json()["email"],
                "password": "security-order-password",
            },
        )
        assert security_login.status_code == 200
        security_headers = {"Authorization": f"Bearer {security_login.json()['access_token']}"}

        security_qrs = client.get(
            "/security/department-qrs",
            headers=security_headers,
        )
        assert security_qrs.status_code == 200

        codes = [item["department_code"] for item in security_qrs.json()]
        assert codes[:6] == ["CCE", "CSE", "ECE", "EEE", "MECH", "CIVIL"]


def test_security_department_qrs_follow_the_logged_in_security_college_and_gate() -> None:
    with TestClient(app) as client:
        _auth, _headers, onboarding = provision_student(client)
        admin_headers = onboarding["admin_headers"]

        db = SessionLocal()
        try:
            second_college = College(
                name="Second Test College",
                code=f"STC-{uuid.uuid4().hex[:6]}",
                address="2 Test Road",
                academic_year="2026-27",
                working_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                default_gate_closing_time=time(9, 30),
                monthly_late_limit=3,
                permission_validity_minutes=15,
                parent_notifications_enabled=True,
                emergency_permissions_enabled=True,
                holidays=[],
            )
            db.add(second_college)
            db.commit()
            db.refresh(second_college)

            second_department = Department(
                college_id=second_college.id,
                code="CSE",
                name="Computer Science Engineering",
            )
            second_gate = Gate(
                college_id=second_college.id,
                code="WEST",
                name="West Gate",
                is_active=True,
            )
            db.add_all([second_department, second_gate])
            db.commit()
            db.refresh(second_department)
            db.refresh(second_gate)

            security_email = f"security-{uuid.uuid4().hex[:8]}@example.edu"
            security_password = "security-second-password"
            security_user = User(
                email=security_email,
                full_name="Second Gate Security",
                password_hash=PasswordHash.recommended().hash(security_password),
                role="security",
                college_id=second_college.id,
                gate_id=second_gate.id,
                gate_assignment=second_gate.name,
            )
            db.add(security_user)
            db.commit()
            db.refresh(security_user)

            creator = db.query(User).filter_by(role="admin").one()
            qr = DepartmentGateQr(
                department_id=second_department.id,
                gate_id=second_gate.id,
                created_by_user_id=creator.id,
            )
            db.add(qr)
            db.commit()
            db.refresh(qr)
        finally:
            db.close()

        security_login = client.post(
            "/auth/login",
            json={
                "email": security_email,
                "password": security_password,
            },
        )
        assert security_login.status_code == 200
        security_headers = {"Authorization": f"Bearer {security_login.json()['access_token']}"}

        security_qrs = client.get(
            "/security/department-qrs",
            headers=security_headers,
        )
        assert security_qrs.status_code == 200
        assert [item["department_code"] for item in security_qrs.json()] == ["CSE"]


def test_student_can_submit_late_request_and_advisor_can_approve() -> None:
    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        student_id = onboarding["student"]["id"]

        qr_verification = client.post(
            "/students/verify-department-qr",
            headers=student_headers,
            json={"qr_value": onboarding["department_qr"]["qr_payload"]},
        )
        assert qr_verification.status_code == 200
        assert qr_verification.json()["id"] == student_id

        request_response = client.post(
            "/late-requests",
            headers=student_headers,
            json={"reason": "Bus delay"},
        )
        assert request_response.status_code == 201
        payload = request_response.json()
        assert payload["student_id"] == student_id
        assert payload["department_id"] == onboarding["department"]["id"]
        assert payload["status"] == "pending_approval"
        assert payload["hod_user_id"] == onboarding["hod"]["id"]
        assert payload["advisor_user_id"] == onboarding["advisor"]["id"]

        student_status = client.get(
            f"/students/late-requests/{payload['id']}",
            headers=student_headers,
        )
        assert student_status.status_code == 200
        assert student_status.json()["status"] == "pending_approval"
        assert student_status.json()["advisor_name"] == "Test Advisor"
        assert student_status.json()["hod_name"] == "Test HOD"
        assert client.get(
            f"/students/late-requests/{payload['id']}",
            headers=onboarding["advisor_headers"],
        ).status_code == 403

        pending = client.get(
            "/staff/late-requests",
            headers=onboarding["advisor_headers"],
        )
        assert pending.status_code == 200
        assert pending.json()[0]["status"] == "pending_approval"

        approved = client.post(
            f"/staff/late-requests/{payload['id']}/approve",
            headers=onboarding["advisor_headers"],
            json={"decision_note": "Approved for this session"},
        )
        assert approved.status_code == 200
        assert approved.json()["status"] == "approved"

        decided_status = client.get(
            f"/students/late-requests/{payload['id']}",
            headers=student_headers,
        )
        assert decided_status.status_code == 200
        assert decided_status.json()["approved_by_name"] == "Test Advisor"
        assert decided_status.json()["approved_by_role"] == "advisor"
        assert decided_status.json()["decision_note"] == "Approved for this session"

        duplicate = client.post(
            f"/staff/late-requests/{payload['id']}/approve",
            headers=onboarding["hod_headers"],
            json={"decision_note": "Second approval attempt"},
        )
        assert duplicate.status_code == 409

        db = SessionLocal()
        permission = db.query(LateEntryPermission).filter_by(request_id=payload["id"]).one()
        assert permission.approver_role == "advisor"
        assert permission.approved_by_user_id == onboarding["advisor"]["id"]
        assert permission.status == "approved"
        db.close()


def test_late_request_history_is_scoped_for_student_staff_and_admin() -> None:
    with TestClient(app) as client:
        _auth, first_student_headers, onboarding = provision_student(client)
        suffix = uuid.uuid4().hex[:8]
        second_student = client.post(
            "/admin/students",
            headers=onboarding["admin_headers"],
            json={
                "email": f"history-{suffix}@example.edu",
                "full_name": "History Student",
                "password": "history-student-password",
                "student_id": f"STU-HISTORY-{suffix}",
                "register_number": f"REG-HISTORY-{suffix}",
                "department_id": onboarding["department"]["id"],
                "year": "II",
                "section": "A",
            },
        )
        assert second_student.status_code == 201
        second_login = client.post(
            "/auth/login",
            json={"email": second_student.json()["email"], "password": "history-student-password"},
        )
        assert second_login.status_code == 200
        second_student_headers = {"Authorization": f"Bearer {second_login.json()['access_token']}"}

        first_request = client.post(
            "/late-requests", headers=first_student_headers, json={"reason": "Bus delay"}
        )
        second_request = client.post(
            "/late-requests", headers=second_student_headers, json={"reason": "Train delay"}
        )
        assert first_request.status_code == 201
        assert second_request.status_code == 201

        first_history = client.get("/students/late-requests", headers=first_student_headers)
        second_history = client.get("/students/late-requests", headers=second_student_headers)
        assert [item["id"] for item in first_history.json()] == [first_request.json()["id"]]
        assert [item["id"] for item in second_history.json()] == [second_request.json()["id"]]
        assert first_history.json()[0]["student_name"] == "Test Student"
        assert client.get(
            f"/students/late-requests/{second_request.json()['id']}",
            headers=first_student_headers,
        ).status_code == 404

        advisor_history = client.get(
            "/staff/late-requests/history", headers=onboarding["advisor_headers"]
        )
        hod_history = client.get(
            "/staff/late-requests/history", headers=onboarding["hod_headers"]
        )
        admin_history = client.get(
            "/admin/late-requests", headers=onboarding["admin_headers"]
        )
        assert {item["id"] for item in advisor_history.json()} == {
            first_request.json()["id"], second_request.json()["id"]
        }
        assert {item["id"] for item in hod_history.json()} == {
            first_request.json()["id"], second_request.json()["id"]
        }
        assert {item["id"] for item in admin_history.json()} == {
            first_request.json()["id"], second_request.json()["id"]
        }
        assert all(item["department_code"] == "CCE" for item in admin_history.json())
        assert client.get("/admin/late-requests", headers=first_student_headers).status_code == 403
        assert client.get("/staff/late-requests/history", headers=first_student_headers).status_code == 403


@pytest.mark.parametrize(
    ("role", "decision", "expected_status"),
    [
        ("advisor", "approve", "approved"),
        ("hod", "approve", "approved"),
        ("advisor", "reject", "rejected"),
        ("hod", "reject", "rejected"),
    ],
)
def test_assigned_staff_can_decide_request_once(
    role: str,
    decision: str,
    expected_status: str,
) -> None:
    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        request_response = client.post(
            "/late-requests",
            headers=student_headers,
            json={"reason": "Transit delay"},
        )
        request_id = request_response.json()["id"]
        staff_headers = onboarding[f"{role}_headers"]

        response = client.post(
            f"/staff/late-requests/{request_id}/{decision}",
            headers=staff_headers,
            json={"decision_note": "Reviewed"},
        )

        assert request_response.status_code == 201
        assert response.status_code == 200
        assert response.json()["status"] == expected_status
        assert response.json()["approved_by_user_id"] == onboarding[role]["id"]

        status_view = client.get(
            f"/students/late-requests/{request_id}",
            headers=student_headers,
        )
        assert status_view.status_code == 200
        assert status_view.json()["status"] == expected_status
        assert status_view.json()["approved_by_name"] == onboarding[role]["full_name"]
        assert status_view.json()["approved_by_role"] == role

        db = SessionLocal()
        permissions = db.query(LateEntryPermission).filter_by(request_id=request_id).all()
        db.close()
        assert len(permissions) == (1 if decision == "approve" else 0)

        other_role = "hod" if role == "advisor" else "advisor"
        duplicate = client.post(
            f"/staff/late-requests/{request_id}/{decision}",
            headers=onboarding[f"{other_role}_headers"],
            json={"decision_note": "Duplicate decision"},
        )
        assert duplicate.status_code == 409


def test_student_can_view_active_permission_and_security_can_queue_approved_students() -> None:
    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        request_response = client.post(
            "/late-requests",
            headers=student_headers,
            json={"reason": "Train delay"},
        )
        assert request_response.status_code == 201

        approved = client.post(
            f"/staff/late-requests/{request_response.json()['id']}/approve",
            headers=onboarding["advisor_headers"],
            json={"decision_note": "Approved for this evening"},
        )
        assert approved.status_code == 200

        student_permissions = client.get(
            "/students/permissions",
            headers=student_headers,
        )
        assert student_permissions.status_code == 200
        assert student_permissions.json()[0]["status"] == "approved"
        assert student_permissions.json()[0]["student_id"] == onboarding["student"]["id"]

        security = client.post(
            "/admin/security-staff",
            headers=onboarding["admin_headers"],
            json={
                "email": f"security-queue-{uuid.uuid4().hex[:8]}@example.edu",
                "full_name": "Queue Security",
                "password": "queue-security-password",
                "employee_id": f"SEC-QUEUE-{uuid.uuid4().hex[:8]}",
                "gate_id": onboarding["gate"]["id"],
            },
        )
        assert security.status_code == 201

        security_login = client.post(
            "/auth/login",
            json={
                "email": security.json()["email"],
                "password": "queue-security-password",
            },
        )
        assert security_login.status_code == 200
        security_headers = {"Authorization": f"Bearer {security_login.json()['access_token']}"}

        queue = client.get(
            "/security/approved-students",
            headers=security_headers,
        )
        assert queue.status_code == 200
        assert queue.json()[0]["student_id"] == onboarding["student"]["id"]
        assert queue.json()[0]["approved_by_user_id"] == onboarding["advisor"]["id"]

        permission_id = queue.json()[0]["permission_id"]
        entered = client.post(
            f"/security/permissions/{permission_id}/enter",
            headers=security_headers,
        )
        assert entered.status_code == 200
        assert entered.json()["student_name"] == onboarding["student"]["full_name"]
        assert entered.json()["gate_code"] == onboarding["gate"]["code"]

        queue_after_entry = client.get(
            "/security/approved-students",
            headers=security_headers,
        )
        assert queue_after_entry.status_code == 200
        assert queue_after_entry.json() == []

        history = client.get("/security/entry-history", headers=security_headers)
        assert history.status_code == 200
        assert len(history.json()) == 1
        assert history.json()[0]["permission_id"] == permission_id
        assert history.json()[0]["security_name"] == "Queue Security"

        duplicate_entry = client.post(
            f"/security/permissions/{permission_id}/enter",
            headers=security_headers,
        )
        assert duplicate_entry.status_code == 409

        denied_entry = client.post(
            f"/security/permissions/{permission_id}/enter",
            headers=student_headers,
        )
        assert denied_entry.status_code == 403


def test_department_qr_verification_requires_authentication() -> None:
    with TestClient(app) as client:
        verification = client.post(
            "/students/verify-department-qr",
            json={"qr_value": "some-token"},
        )

        assert verification.status_code == 401


def test_admin_can_delete_department_and_user_accounts() -> None:
    with TestClient(app) as client:
        _auth, _headers, onboarding = provision_student(client)

        delete_hod = client.delete(
            f"/admin/users/{onboarding['hod']['id']}",
            headers=onboarding["admin_headers"],
        )
        assert delete_hod.status_code == 200

        delete_advisor = client.delete(
            f"/admin/users/{onboarding['advisor']['id']}",
            headers=onboarding["admin_headers"],
        )
        assert delete_advisor.status_code == 200

        delete_student = client.delete(
            f"/admin/users/{onboarding['student']['id']}",
            headers=onboarding["admin_headers"],
        )
        assert delete_student.status_code == 200

        delete_department = client.delete(
            f"/admin/departments/{onboarding['department']['id']}",
            headers=onboarding["admin_headers"],
        )
        assert delete_department.status_code == 200

        remaining_departments = client.get(
            "/admin/departments",
            headers=onboarding["admin_headers"],
        )
        assert remaining_departments.status_code == 200
        assert remaining_departments.json() == []


def test_staff_can_create_students_but_cannot_delete_them() -> None:
    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        suffix = uuid.uuid4().hex[:10]
        staff_student = client.post(
            "/staff/students",
            headers=onboarding["hod_headers"],
            json={
                "email": f"staff-created-{suffix}@example.edu",
                "full_name": "Staff Created Student",
                "password": "staff-student-password",
                "student_id": f"STU-STAFF-{suffix}",
                "register_number": f"REG-STAFF-{suffix}",
                "department_id": onboarding["department"]["id"],
                "year": "II",
                "section": "A",
            },
        )
        assert staff_student.status_code == 201

        student_cannot_create = client.post(
            "/staff/students",
            headers=student_headers,
            json={
                "email": f"blocked-{suffix}@example.edu",
                "full_name": "Blocked Student",
                "password": "blocked-student-password",
                "student_id": f"STU-BLOCKED-{suffix}",
                "register_number": f"REG-BLOCKED-{suffix}",
                "department_id": onboarding["department"]["id"],
                "year": "II",
                "section": "A",
            },
        )
        assert student_cannot_create.status_code == 403


def test_only_admin_can_create_accounts_and_student_assignments_are_automatic() -> None:
    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        student = onboarding["student"]

        public_registration = client.post(
            "/auth/register",
            json={
                "email": "self-created@example.edu",
                "full_name": "Self Created",
                "password": "not-allowed-password",
                "student_id": "STU-SELF-CREATED",
            },
        )
        forbidden_admin_action = client.post(
            "/admin/departments",
            headers=student_headers,
            json={"code": "EEE", "name": "Electrical Engineering"},
        )
        forbidden_admin_provisioning = client.post(
            "/super-admin/college-admins",
            headers=onboarding["admin_headers"],
            json={
                "email": "admin-created-by-admin@example.edu",
                "full_name": "Unauthorized Admin",
                "password": "not-authorized-password",
            },
        )

        assert public_registration.status_code == 403
        assert forbidden_admin_action.status_code == 403
        assert forbidden_admin_provisioning.status_code == 403
        assert student["role"] == "student"
        assert student["advisor_user_id"] == onboarding["advisor"]["id"]
        assert student["department_id"] == onboarding["department"]["id"]
        assert student["college_id"] == onboarding["college"]["id"]

        other_department = client.post(
            "/admin/departments",
            headers=onboarding["admin_headers"],
            json={"code": "CSE", "name": "Computer Science Engineering"},
        )
        other_department_qr = client.post(
            f"/hod/departments/{other_department.json()['id']}/gates/{onboarding['gate']['id']}/qr",
            headers=onboarding["hod_headers"],
        )
        assert other_department.status_code == 201
        assert other_department_qr.status_code == 403


def test_security_staff_is_admin_created_and_cannot_verify_student_qr() -> None:
    with TestClient(app) as client:
        _auth, _student_headers, onboarding = provision_student(client)
        admin_headers = onboarding["admin_headers"]
        security = client.post(
            "/admin/security-staff",
            headers=admin_headers,
            json={
                "email": f"security-{uuid.uuid4().hex[:10]}@example.edu",
                "full_name": "Test Security",
                "password": "security-test-password",
                "employee_id": f"EMP-SEC-{uuid.uuid4().hex[:10]}",
                "gate_id": onboarding["gate"]["id"],
            },
        )
        assert security.status_code == 201
        assert security.json()["role"] == "security"
        security_login = client.post(
            "/auth/login",
            json={"email": security.json()["email"], "password": "security-test-password"},
        )
        verification = client.post(
            "/students/verify-department-qr",
            headers={"Authorization": f"Bearer {security_login.json()['access_token']}"},
            json={"qr_value": onboarding["department_qr"]["qr_payload"]},
        )
        assert verification.status_code == 403


def test_hod_can_disable_qr_admin_can_reenable_and_security_is_read_only() -> None:
    with TestClient(app) as client:
        _auth, student_headers, onboarding = provision_student(client)
        qr = onboarding["department_qr"]
        admin_headers = onboarding["admin_headers"]
        security = client.post(
            "/admin/security-staff",
            headers=admin_headers,
            json={
                "email": f"security-{uuid.uuid4().hex[:10]}@example.edu",
                "full_name": "Test Security",
                "password": "security-test-password",
                "employee_id": f"EMP-SEC-{uuid.uuid4().hex[:10]}",
                "gate_id": onboarding["gate"]["id"],
            },
        )
        assert security.status_code == 201
        security_login = client.post(
            "/auth/login",
            json={"email": security.json()["email"], "password": "security-test-password"},
        )
        security_headers = {"Authorization": f"Bearer {security_login.json()['access_token']}"}

        disabled = client.put(
            f"/hod/department-qrs/{qr['id']}",
            headers=onboarding["hod_headers"],
            json={"status": "disabled"},
        )
        rejected_scan = client.post(
            "/students/verify-department-qr",
            headers=student_headers,
            json={"qr_value": qr["qr_payload"]},
        )
        visible_qrs = client.get("/security/department-qrs", headers=security_headers)
        forbidden_edit = client.put(
            f"/admin/department-qrs/{qr['id']}",
            headers=security_headers,
            json={"status": "active"},
        )
        reenabled = client.put(
            f"/admin/department-qrs/{qr['id']}",
            headers=admin_headers,
            json={"status": "active"},
        )
        accepted_scan = client.post(
            "/students/verify-department-qr",
            headers=student_headers,
            json={"qr_value": qr["qr_payload"]},
        )

        assert disabled.status_code == 200
        assert rejected_scan.status_code == 410
        assert visible_qrs.status_code == 200
        assert visible_qrs.json()[0]["status"] == "disabled"
        assert forbidden_edit.status_code == 403
        assert reenabled.status_code == 200
        assert accepted_scan.status_code == 200


def test_bootstrapped_super_admin_can_create_college_admin() -> None:
    with TestClient(app) as client:
        suffix = uuid.uuid4().hex[:10]
        super_admin = User(
            email=f"super-admin-{suffix}@example.edu",
            full_name="Super Admin",
            password_hash=PasswordHash.recommended().hash("super-admin-password"),
            role="super_admin",
        )
        db = SessionLocal()
        db.add(super_admin)
        db.commit()
        db.refresh(super_admin)
        db.close()

        login_response = client.post(
            "/auth/login",
            json={"email": super_admin.email, "password": "super-admin-password"},
        )
        super_admin_headers = {
            "Authorization": f"Bearer {login_response.json()['access_token']}"
        }
        college = client.post(
            "/admin/college",
            headers=super_admin_headers,
            json={
                "name": "Super Admin College",
                "code": f"SAC-{suffix}",
                "address": "2 Admin Road",
                "academic_year": "2026-27",
                "working_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                "default_gate_closing_time": "09:30:00",
                "monthly_late_limit": 3,
                "permission_validity_minutes": 15,
                "parent_notifications_enabled": True,
                "emergency_permissions_enabled": True,
                "holidays": [],
            },
        )
        admin = client.post(
            "/super-admin/college-admins",
            headers=super_admin_headers,
            json={
                "email": f"college-admin-{suffix}@example.edu",
                "full_name": "College Admin",
                "password": "college-admin-password",
            },
        )

        assert college.status_code == 201
        assert admin.status_code == 201
        assert admin.json()["role"] == "admin"
        assert admin.json()["college_id"] == college.json()["id"]


def test_messages_send_receive_resend_and_acknowledge_without_duplicates() -> None:
    with TestClient(app) as client:
        student_auth, student_headers, onboarding = provision_student(client)
        client_message_id = str(uuid4())
        payload = {
            "recipient_id": onboarding["hod"]["id"],
            "client_message_id": client_message_id,
            "body": "Traffic delay at the entrance",
        }

        sent = client.post("/messages", headers=student_headers, json=payload)
        received = client.get("/messages?after_id=0&limit=10", headers=onboarding["hod_headers"])
        resent = client.post(
            "/messages",
            headers=student_headers,
            json={**payload, "body": " Traffic delay at the entrance "},
        )
        conflict = client.post(
            "/messages",
            headers=student_headers,
            json={**payload, "body": "A different message"},
        )
        ack = client.post(
            f"/messages/{sent.json()['id']}/ack",
            headers=onboarding["hod_headers"],
        )
        resent_after_ack = client.post("/messages", headers=student_headers, json=payload)
        student_outbox = client.get(
            f"/messages?after_id={sent.json()['id'] - 1}",
            headers=student_headers,
        )

        assert student_auth["user"]["id"] == sent.json()["sender_id"]
        assert sent.status_code == 201
        assert received.status_code == 200
        assert len(received.json()["items"]) == 1
        assert received.json()["items"][0]["body"] == payload["body"]
        assert resent.status_code == 200
        assert resent.json()["id"] == sent.json()["id"]
        assert conflict.status_code == 409
        assert ack.status_code == 200
        assert ack.json()["delivered_at"] is not None
        assert resent_after_ack.status_code == 200
        assert len(student_outbox.json()["items"]) == 1


def test_message_delete_is_private_to_each_participant_and_synced_live() -> None:
    with TestClient(app) as client:
        _student_auth, student_headers, onboarding = provision_student(client)
        payload = {
            "recipient_id": onboarding["hod"]["id"],
            "client_message_id": str(uuid4()),
            "body": "Please review my late-entry request",
        }
        sent = client.post("/messages", headers=student_headers, json=payload)
        message_id = sent.json()["id"]
        assert client.get("/messages", headers=student_headers).json()["items"]
        assert client.get("/messages", headers=onboarding["hod_headers"]).json()["items"]

        ticket = client.post("/realtime/ticket", headers=student_headers)
        with client.websocket_connect(
            f"/ws/messages?ticket={ticket.json()['ticket']}",
            headers={"origin": "http://127.0.0.1:8000"},
        ) as websocket:
            sender_delete = client.delete(f"/messages/{message_id}", headers=student_headers)
            deletion_event = websocket.receive_json()

        assert sender_delete.status_code == 200
        assert deletion_event == {"type": "message.deleted", "message_id": message_id}
        assert client.get("/messages", headers=student_headers).json()["items"] == []
        assert len(client.get("/messages", headers=onboarding["hod_headers"]).json()["items"]) == 1
        assert client.post("/messages", headers=student_headers, json=payload).status_code == 409

        recipient_delete = client.delete(
            f"/messages/{message_id}", headers=onboarding["hod_headers"]
        )
        assert recipient_delete.status_code == 200
        assert client.get("/messages", headers=onboarding["hod_headers"]).json()["items"] == []
        assert client.delete(
            f"/messages/{message_id}", headers=onboarding["admin_headers"]
        ).status_code == 404


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:8000"])
def test_websocket_delivers_live_message_and_accepts_receipt_ack(origin: str) -> None:
    with TestClient(app) as client:
        _student_auth, student_headers, onboarding = provision_student(client)
        ticket_response = client.post("/realtime/ticket", headers=onboarding["hod_headers"])
        assert ticket_response.status_code == 200
        ticket = ticket_response.json()["ticket"]

        with client.websocket_connect(
            f"/ws/messages?ticket={ticket}",
            headers={"origin": origin},
        ) as websocket:
            sent = client.post(
                "/messages",
                headers=student_headers,
                json={
                    "recipient_id": onboarding["hod"]["id"],
                    "client_message_id": str(uuid4()),
                    "body": "Please review my late entry request",
                },
            )
            event = websocket.receive_json()
            websocket.send_json({"type": "message.ack", "message_id": sent.json()["id"]})
            acknowledgement = websocket.receive_json()

        assert sent.status_code == 201
        assert event["type"] == "message.new"
        assert event["message"]["id"] == sent.json()["id"]
        assert acknowledgement == {
            "type": "message.acknowledged",
            "message_id": sent.json()["id"],
        }
        message = client.get(
            "/messages?after_id=0",
            headers=onboarding["hod_headers"],
        ).json()["items"][0]
        assert message["delivered_at"] is not None


def test_role_workspace_data_and_contacts_are_scoped() -> None:
    with TestClient(app) as client:
        _student_auth, student_headers, onboarding = provision_student(client)
        admin_headers = onboarding["admin_headers"]
        hod_headers = onboarding["hod_headers"]
        advisor_headers = onboarding["advisor_headers"]

        admin_users = client.get("/admin/users", headers=admin_headers)
        admin_gates = client.get("/admin/gates", headers=admin_headers)
        admin_qrs = client.get("/admin/department-qrs", headers=admin_headers)
        hod_assignments = client.get("/staff/assignments", headers=hod_headers)
        hod_gates = client.get("/hod/gates", headers=hod_headers)
        hod_qrs = client.get("/hod/department-qrs", headers=hod_headers)
        hod_contacts = client.get("/workspace/contacts", headers=hod_headers)
        advisor_contacts = client.get("/workspace/contacts", headers=advisor_headers)
        student_contacts = client.get("/workspace/contacts", headers=student_headers)

        assert admin_users.status_code == 200
        assert {user["role"] for user in admin_users.json()} >= {"hod", "advisor", "student"}
        assert admin_gates.status_code == 200 and len(admin_gates.json()) == 1
        assert admin_qrs.status_code == 200 and len(admin_qrs.json()) == 1
        assert hod_assignments.status_code == 200
        assert hod_assignments.json()["department_code"] == "CCE"
        assert len(hod_assignments.json()["classes"]) == 1
        assert hod_gates.status_code == 200 and len(hod_gates.json()) == 1
        assert hod_qrs.status_code == 200 and len(hod_qrs.json()) == 1
        assert {user["id"] for user in hod_contacts.json()} >= {
            onboarding["advisor"]["id"], onboarding["student"]["id"]
        }
        assert {user["id"] for user in advisor_contacts.json()} == {
            onboarding["hod"]["id"], onboarding["student"]["id"]
        }
        assert {user["id"] for user in student_contacts.json()} == {
            onboarding["hod"]["id"], onboarding["advisor"]["id"]
        }
