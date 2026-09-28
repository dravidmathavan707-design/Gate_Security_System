"""Add per-user message deletion timestamps."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c72f19ab4e60"
down_revision: Union[str, Sequence[str], None] = "f3a91d6b2c40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("direct_messages", sa.Column("sender_deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("direct_messages", sa.Column("recipient_deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("direct_messages", "recipient_deleted_at")
    op.drop_column("direct_messages", "sender_deleted_at")