import logging
from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

_connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)
engine = create_engine(settings.database_url, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def add_missing_columns(bind: Engine) -> None:
    """Tiny stand-in for migrations: ALTER TABLE ... ADD COLUMN for nullable columns
    that a model declares but an older database file lacks. create_all() only creates
    missing tables, never missing columns. Only nullable columns are added (always
    safe); a missing non-nullable column is skipped with a warning. A "duplicate
    column" error (another process upgraded concurrently) is harmless and ignored."""
    inspector = inspect(bind)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing:
                continue
            if not column.nullable:
                logger.warning("Cannot auto-add NOT NULL column %s.%s; migrate manually", table.name, column.name)
                continue
            ddl_type = column.type.compile(dialect=bind.dialect)
            try:
                with bind.begin() as conn:
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl_type}'))
            except OperationalError as exc:
                if "duplicate column" in str(exc).lower():
                    logger.warning("Column %s.%s already added concurrently", table.name, column.name)
                else:
                    raise
