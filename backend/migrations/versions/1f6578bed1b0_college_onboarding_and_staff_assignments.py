"""Add college onboarding fields without removing the legacy profile tables."""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app import models
from app.database import Base


revision: str = "1f6578bed1b0"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())

    if "users" not in tables:
        Base.metadata.create_all(bind=connection)
        return

    college_columns = {column["name"] for column in inspector.get_columns("colleges")}
    if "holidays" not in college_columns:
        op.add_column(
            "colleges",
            sa.Column("holidays", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        )

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    new_columns = [
        sa.Column("register_number", sa.String(48), nullable=True),
        sa.Column("employee_id", sa.String(48), nullable=True),
        sa.Column("college_id", sa.Integer(), nullable=True),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("year", sa.String(16), nullable=True),
        sa.Column("section", sa.String(16), nullable=True),
        sa.Column("advisor_user_id", sa.Integer(), nullable=True),
        sa.Column("gate_assignment", sa.String(100), nullable=True),
        sa.Column("parent_name", sa.String(160), nullable=True),
        sa.Column("parent_phone", sa.String(32), nullable=True),
        sa.Column("parent_email", sa.String(320), nullable=True),
        sa.Column("parent_relationship", sa.String(24), nullable=True),
    ]
    missing_columns = [column for column in new_columns if column.name not in user_columns]

    if missing_columns:
        with op.batch_alter_table("users", recreate="always") as batch:
            for column in missing_columns:
                batch.add_column(column)
            batch.create_foreign_key(
                "fk_users_college_id", "colleges", ["college_id"], ["id"]
            )
            batch.create_foreign_key(
                "fk_users_department_id", "departments", ["department_id"], ["id"]
            )
            batch.create_foreign_key(
                "fk_users_advisor_user_id", "users", ["advisor_user_id"], ["id"]
            )
            batch.create_index("ix_users_class_assignment", ["college_id", "department_id", "year", "section"])
            batch.create_index("ix_users_college_id", ["college_id"])
            batch.create_index("ix_users_department_id", ["department_id"])
            batch.create_index("uq_users_employee_id", ["employee_id"], unique=True)
            batch.create_index("uq_users_register_number", ["register_number"], unique=True)

    if "student_profiles" in tables:
        connection.execute(sa.text("""
            UPDATE users
            SET college_id = (SELECT college_id FROM student_profiles WHERE user_id = users.id),
                department_id = (SELECT department_id FROM student_profiles WHERE user_id = users.id),
                register_number = (SELECT register_number FROM student_profiles WHERE user_id = users.id),
                year = (SELECT year FROM student_profiles WHERE user_id = users.id),
                section = (SELECT section FROM student_profiles WHERE user_id = users.id),
                parent_name = (SELECT parent_name FROM student_profiles WHERE user_id = users.id),
                parent_phone = (SELECT parent_phone FROM student_profiles WHERE user_id = users.id),
                parent_email = (SELECT parent_email FROM student_profiles WHERE user_id = users.id),
                parent_relationship = (SELECT parent_relationship FROM student_profiles WHERE user_id = users.id)
            WHERE id IN (SELECT user_id FROM student_profiles)
        """))

    if "staff_profiles" in tables:
        connection.execute(sa.text("""
            UPDATE users
            SET college_id = (SELECT college_id FROM staff_profiles WHERE user_id = users.id),
                department_id = (SELECT department_id FROM staff_profiles WHERE user_id = users.id),
                employee_id = (SELECT employee_id FROM staff_profiles WHERE user_id = users.id),
                gate_assignment = (SELECT gate_assignment FROM staff_profiles WHERE user_id = users.id)
            WHERE id IN (SELECT user_id FROM staff_profiles)
        """))

    if "class_advisor_assignments" in tables:
        connection.execute(sa.text("""
            UPDATE users
            SET advisor_user_id = (
                SELECT assignment.advisor_user_id
                FROM class_advisor_assignments AS assignment
                JOIN colleges ON colleges.id = users.college_id
                WHERE assignment.department_id = users.department_id
                  AND assignment.academic_year = colleges.academic_year
                  AND assignment.year = users.year
                  AND assignment.section = users.section
                LIMIT 1
            )
            WHERE role = 'student' AND department_id IS NOT NULL
        """))

    Base.metadata.create_all(bind=connection)


def downgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if "users" not in inspector.get_table_names():
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "register_number" not in user_columns:
        return

    with op.batch_alter_table("users", recreate="always") as batch:
        batch.drop_constraint("fk_users_advisor_user_id", type_="foreignkey")
        batch.drop_constraint("fk_users_department_id", type_="foreignkey")
        batch.drop_constraint("fk_users_college_id", type_="foreignkey")
        batch.drop_index("uq_users_register_number")
        batch.drop_index("uq_users_employee_id")
        batch.drop_index("ix_users_department_id")
        batch.drop_index("ix_users_college_id")
        batch.drop_index("ix_users_class_assignment")
        for column_name in (
            "parent_relationship", "parent_email", "parent_phone", "parent_name",
            "gate_assignment", "advisor_user_id", "section", "year", "department_id",
            "college_id", "employee_id", "register_number",
        ):
            if column_name in user_columns:
                batch.drop_column(column_name)

    if "holidays" in {column["name"] for column in inspector.get_columns("colleges")}:
        op.drop_column("colleges", "holidays")
