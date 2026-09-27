"""Bind security accounts to gates and retain student photo references."""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2d3b77a104fc"
down_revision: Union[str, Sequence[str], None] = "1f6578bed1b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    missing_columns = []
    if "gate_id" not in columns:
        missing_columns.append(sa.Column("gate_id", sa.Integer(), nullable=True))
    if "photo_url" not in columns:
        missing_columns.append(sa.Column("photo_url", sa.String(500), nullable=True))

    if missing_columns:
        with op.batch_alter_table("users", recreate="always") as batch:
            for column in missing_columns:
                batch.add_column(column)
            if "gate_id" not in columns:
                batch.create_foreign_key("fk_users_gate_id", "gates", ["gate_id"], ["id"])
                batch.create_index("ix_users_gate_id", ["gate_id"])

    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "student_profiles" in tables:
        op.get_bind().execute(sa.text("""
            UPDATE users
            SET photo_url = (
                SELECT student_profiles.photo_url
                FROM student_profiles
                WHERE student_profiles.user_id = users.id
            )
            WHERE role = 'student' AND id IN (
                SELECT user_id FROM student_profiles WHERE photo_url IS NOT NULL
            )
        """))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if not {"gate_id", "photo_url"}.issubset(columns):
        return
    with op.batch_alter_table("users", recreate="always") as batch:
        batch.drop_index("ix_users_gate_id")
        batch.drop_constraint("fk_users_gate_id", type_="foreignkey")
        batch.drop_column("photo_url")
        batch.drop_column("gate_id")
