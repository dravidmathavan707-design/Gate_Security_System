"""Add college profile images and audit history."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "5b21af09c247"
down_revision: Union[str, Sequence[str], None] = "4a9c1e2d6f30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("colleges", sa.Column("photo_url", sa.String(length=500), nullable=True))
    op.add_column("colleges", sa.Column("logo_updated_by", sa.String(length=160), nullable=True))
    op.add_column("colleges", sa.Column("logo_updated_by_role", sa.String(length=24), nullable=True))
    op.add_column("colleges", sa.Column("logo_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("colleges", sa.Column("previous_logo", sa.String(length=500), nullable=True))
    op.add_column("colleges", sa.Column("new_logo", sa.String(length=500), nullable=True))
    op.create_table(
        "college_logo_audits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("college_id", sa.Integer(), sa.ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False),
        sa.Column("logo_updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("logo_updated_by", sa.String(length=160), nullable=False),
        sa.Column("logo_updated_by_role", sa.String(length=24), nullable=False),
        sa.Column("logo_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("previous_logo", sa.String(length=500), nullable=True),
        sa.Column("new_logo", sa.String(length=500), nullable=True),
    )
    op.create_index("ix_college_logo_audits_college_id", "college_logo_audits", ["college_id"])


def downgrade() -> None:
    op.drop_index("ix_college_logo_audits_college_id", table_name="college_logo_audits")
    op.drop_table("college_logo_audits")
    op.drop_column("colleges", "new_logo")
    op.drop_column("colleges", "previous_logo")
    op.drop_column("colleges", "logo_updated_at")
    op.drop_column("colleges", "logo_updated_by_role")
    op.drop_column("colleges", "logo_updated_by")
    op.drop_column("colleges", "photo_url")