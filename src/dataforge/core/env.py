from __future__ import annotations

import os
from pathlib import Path


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        # Do not overwrite an already exported environment variable.
        if key not in os.environ:
            os.environ[key] = value


def read_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def write_dotenv_updates(path: Path, updates: dict[str, str | None]) -> None:
    normalized_updates = {
        key: value
        for key, value in updates.items()
        if isinstance(key, str) and key.strip()
    }
    existing_lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    rendered: list[str] = []
    handled_keys: set[str] = set()

    for raw_line in existing_lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw_line:
            rendered.append(raw_line)
            continue

        key, _ = raw_line.split("=", 1)
        normalized_key = key.strip()
        if not normalized_key:
            rendered.append(raw_line)
            continue
        if normalized_key in handled_keys:
            continue
        if normalized_key not in normalized_updates:
            rendered.append(raw_line)
            handled_keys.add(normalized_key)
            continue

        handled_keys.add(normalized_key)
        next_value = normalized_updates[normalized_key]
        if next_value is None:
            continue
        rendered.append(f"{normalized_key}={_quote_dotenv_value(next_value)}")

    for key, value in normalized_updates.items():
        if key in handled_keys or value is None:
            continue
        rendered.append(f"{key}={_quote_dotenv_value(value)}")

    output = "\n".join(rendered).rstrip()
    if output:
        output += "\n"
    path.write_text(output, encoding="utf-8")


def apply_env_updates(updates: dict[str, str | None]) -> None:
    for key, value in updates.items():
        if value is None:
            os.environ.pop(key, None)
            continue
        os.environ[key] = value


def _quote_dotenv_value(value: str) -> str:
    if not value:
        return '""'
    if any(char.isspace() for char in value) or "#" in value or value[0] in {'"', "'"} or value[-1] in {'"', "'"}:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value
