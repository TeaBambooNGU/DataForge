from pathlib import Path

from dataforge.core.db import database_path
from dataforge.core.migrations import initialize_database


def test_initialize_database_creates_sqlite_file(tmp_path: Path) -> None:
    initialize_database(tmp_path)
    assert database_path(tmp_path).exists()
