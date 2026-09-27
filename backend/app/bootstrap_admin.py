from getpass import getpass

from pydantic import EmailStr, TypeAdapter
from pwdlib import PasswordHash
from sqlalchemy import select

from .database import SessionLocal
from .models import User


def main() -> None:
    db = SessionLocal()
    try:
        existing_admin = db.scalar(
            select(User.id).where(User.role.in_(("admin", "super_admin"))).limit(1)
        )
        if existing_admin is not None:
            raise SystemExit("A privileged account already exists; bootstrap is disabled.")

        email = str(TypeAdapter(EmailStr).validate_python(input("Super admin email: "))).lower()
        full_name = input("Super admin full name: ").strip()
        if len(full_name) < 2:
            raise SystemExit("Full name must contain at least two characters.")

        password = getpass("Password (12+ characters): ")
        confirmation = getpass("Confirm password: ")
        if len(password) < 12:
            raise SystemExit("Password must contain at least 12 characters.")
        if password != confirmation:
            raise SystemExit("Passwords did not match.")
        if db.scalar(select(User.id).where(User.email == email)) is not None:
            raise SystemExit("An account with this email already exists.")

        db.add(
            User(
                email=email,
                full_name=full_name,
                password_hash=PasswordHash.recommended().hash(password),
                role="super_admin",
            )
        )
        db.commit()
        print("Super admin account created. Sign in through the SMARTGATE API.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
