"""Add signed offline security snapshots and sync audit records."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "8a2e5d7c1f40"
down_revision: Union[str, Sequence[str], None] = "c72f19ab4e60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("gate_entry_events") as batch_op:
        batch_op.add_column(
            sa.Column("verification_mode", sa.String(length=16), nullable=False, server_default="online"),
        )
        batch_op.add_column(
            sa.Column("client_event_id", sa.String(length=36), nullable=True),
        )
        batch_op.create_unique_constraint(
            "uq_gate_entry_events_client_event_id",
            ["client_event_id"],
        )
    op.create_table(
        "offline_entry_sync_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("client_event_id", sa.String(length=36), nullable=False),
        sa.Column("permission_id", sa.String(length=32), nullable=False),
        sa.Column("security_user_id", sa.Integer(), nullable=False),
        sa.Column("gate_id", sa.Integer(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("rejection_reason", sa.String(length=200), nullable=True),
        sa.UniqueConstraint(
            "client_event_id",
            name="uq_offline_entry_sync_attempts_client_event_id",
        ),
    )
    op.create_index(
        "ix_offline_entry_sync_attempts_gate_synced",
        "offline_entry_sync_attempts",
        ["gate_id", "synced_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_offline_entry_sync_attempts_gate_synced",
        table_name="offline_entry_sync_attempts",
    )
    op.drop_table("offline_entry_sync_attempts")
    with op.batch_alter_table("gate_entry_events") as batch_op:
        batch_op.drop_constraint(
            "uq_gate_entry_events_client_event_id",
            type_="unique",
        )
        batch_op.drop_column("client_event_id")
        batch_op.drop_column("verification_mode")
