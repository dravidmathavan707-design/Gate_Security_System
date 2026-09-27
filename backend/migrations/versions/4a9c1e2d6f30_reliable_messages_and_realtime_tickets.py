"""Add durable direct messages and one-use realtime tickets."""
from typing import Sequence, Union

from alembic import op

from app.database import Base
from app import models


revision: str = "4a9c1e2d6f30"
down_revision: Union[str, Sequence[str], None] = "2d3b77a104fc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    op.drop_table("realtime_tickets")
    op.drop_table("direct_messages")
