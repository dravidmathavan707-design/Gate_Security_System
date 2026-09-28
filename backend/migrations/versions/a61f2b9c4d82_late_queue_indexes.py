"""Add indexes for late-request and permission queues."""
from typing import Sequence, Union

from alembic import op


revision: str = "a61f2b9c4d82"
down_revision: Union[str, Sequence[str], None] = "d41c9a2af6ec"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_late_requests_advisor_status_requested",
        "late_requests",
        ["advisor_user_id", "status", "requested_at"],
    )
    op.create_index(
        "ix_late_requests_hod_status_requested",
        "late_requests",
        ["hod_user_id", "status", "requested_at"],
    )
    op.create_index(
        "ix_late_entry_permissions_student_status_valid_until",
        "late_entry_permissions",
        ["student_id", "status", "valid_until"],
    )
    op.create_index(
        "ix_late_entry_permissions_status_valid_until",
        "late_entry_permissions",
        ["status", "valid_until"],
    )


def downgrade() -> None:
    op.drop_index("ix_late_entry_permissions_status_valid_until", table_name="late_entry_permissions")
    op.drop_index("ix_late_entry_permissions_student_status_valid_until", table_name="late_entry_permissions")
    op.drop_index("ix_late_requests_hod_status_requested", table_name="late_requests")
    op.drop_index("ix_late_requests_advisor_status_requested", table_name="late_requests")