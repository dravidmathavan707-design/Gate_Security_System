"""Add the late-request workflow for students and staff approvals."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c7f28a3a2b91"
down_revision: Union[str, Sequence[str], None] = "5b21af09c247"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "late_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("advisor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("hod_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending_approval"),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_late_requests_student_id", "late_requests", ["student_id"])
    op.create_index("ix_late_requests_department_id", "late_requests", ["department_id"])
    op.create_index("ix_late_requests_status", "late_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_late_requests_status", table_name="late_requests")
    op.drop_index("ix_late_requests_department_id", table_name="late_requests")
    op.drop_index("ix_late_requests_student_id", table_name="late_requests")
    op.drop_table("late_requests")
