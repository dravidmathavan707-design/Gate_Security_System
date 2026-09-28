"""Add persistent security gate-entry history."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f3a91d6b2c40"
down_revision: Union[str, Sequence[str], None] = "a61f2b9c4d82"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gate_entry_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("permission_id", sa.String(length=32), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("student_name", sa.String(length=160), nullable=False),
        sa.Column("register_number", sa.String(length=48), nullable=True),
        sa.Column("department_code", sa.String(length=32), nullable=True),
        sa.Column("gate_id", sa.Integer(), nullable=False),
        sa.Column("gate_code", sa.String(length=32), nullable=False),
        sa.Column("gate_name", sa.String(length=100), nullable=False),
        sa.Column("security_user_id", sa.Integer(), nullable=False),
        sa.Column("security_name", sa.String(length=160), nullable=False),
        sa.Column("entered_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("permission_id", name="uq_gate_entry_events_permission_id"),
    )
    op.create_index(
        "ix_gate_entry_events_gate_entered",
        "gate_entry_events",
        ["gate_id", "entered_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_gate_entry_events_gate_entered", table_name="gate_entry_events")
    op.drop_table("gate_entry_events")