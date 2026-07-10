"""SQLAlchemy engine / SessionLocal / FastAPI dependency。"""

from __future__ import annotations

from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.settings import PROJECT_ROOT, settings


def _resolve_db_path() -> Path:
    """settings.DB_PATH 可以是相对/绝对路径；统一解析为绝对路径。"""
    p = Path(settings.DB_PATH)
    if not p.is_absolute():
        p = PROJECT_ROOT / p
    return p


DB_PATH = _resolve_db_path()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
DB_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False},
    future=True,
)


@event.listens_for(Engine, "connect")
def _enable_sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
    """开启 SQLite 外键约束 + WAL，避免静默写入孤儿数据 / 并发锁。"""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖：每请求一个 session。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
