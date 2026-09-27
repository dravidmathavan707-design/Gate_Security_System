"""Create the permission ledger for single-approver late-entry requests."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d41c9a2af6ec"
down_revision: Union[str, Sequence[str], None] = "c7f28a3a2b91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "late_entry_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("permission_id", sa.String(length=32), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("approved_by_user_id", sa.Integer(), nullable=False),
        sa.Column("approver_role", sa.String(length=24), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="approved"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_unique_constraint("uq_late_entry_permissions_permission_id", "late_entry_permissions", ["permission_id"])
    op.create_unique_constraint("uq_late_entry_permissions_request_id", "late_entry_permissions", ["request_id"])
    op.create_index("ix_late_entry_permissions_permission_id", "late_entry_permissions", ["permission_id"])
    op.create_index("ix_late_entry_permissions_request_id", "late_entry_permissions", ["request_id"])
    op.create_index("ix_late_entry_permissions_student_id", "late_entry_permissions", ["student_id"])
    op.create_index("ix_late_entry_permissions_approved_by_user_id", "late_entry_permissions", ["approved_by_user_id"])
    op.create_foreign_key(
        "fk_late_entry_permissions_request_id_late_requests",
        "late_entry_permissions",
        "late_requests",
        ["request_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_late_entry_permissions_student_id_users",
        "late_entry_permissions",
        "users",
        ["student_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_late_entry_permissions_approved_by_user_id_users",
        "late_entry_permissions",
        "users",
        ["approved_by_user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_late_entry_permissions_approved_by_user_id_users", "late_entry_permissions", type_="foreignkey")
    op.drop_constraint("fk_late_entry_permissions_student_id_users", "late_entry_permissions", type_="foreignkey")
    op.drop_constraint("fk_late_entry_permissions_request_id_late_requests", "late_entry_permissions", type_="foreignkey")
    op.drop_index("ix_late_entry_permissions_approved_by_user_id", table_name="late_entry_permissions")
    op.drop_index("ix_late_entry_permissions_student_id", table_name="late_entry_permissions")
    op.drop_index("ix_late_entry_permissions_request_id", table_name="late_entry_permissions")
    op.drop_index("ix_late_entry_permissions_permission_id", table_name="late_entry_permissions")
    op.drop_constraint("uq_late_entry_permissions_request_id", "late_entry_permissions", type_="unique")
    op.drop_constraint("uq_late_entry_permissions_permission_id", "late_entry_permissions", type_="unique")
    op.drop_table("late_entry_permissions")
