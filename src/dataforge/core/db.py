from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


def database_path(project_root: Path) -> Path:
    return (project_root / ".dataforge" / "dataforge.db").resolve()


def ensure_database_parent(project_root: Path) -> Path:
    path = database_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def connect(project_root: Path) -> sqlite3.Connection:
    path = ensure_database_parent(project_root)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA synchronous=NORMAL")
    return connection


@contextmanager
def transaction(project_root: Path) -> Iterator[sqlite3.Connection]:
    connection = connect(project_root)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
