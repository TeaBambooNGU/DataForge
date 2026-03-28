from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import yaml


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def read_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def write_yaml(path: Path, payload: Any) -> None:
    ensure_parent(path)
    with path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle, allow_unicode=True, sort_keys=False)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    ensure_parent(path)
    path.write_text(content, encoding="utf-8")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    ensure_parent(path)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    ensure_parent(path)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_run_manifest(
    manifest_path: Path,
    *,
    task_name: str,
    stage_name: str,
    runtime: dict[str, Any],
    input_paths: list[str],
    output_paths: list[str],
    stats: dict[str, Any] | None = None,
    errors: list[str] | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    payload = {
        "task_name": task_name,
        "run_id": run_id or f"{stage_name}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}",
        "stage_name": stage_name,
        "runtime": runtime,
        "input_paths": input_paths,
        "output_paths": output_paths,
        "stats": stats or {},
        "errors": errors or [],
        "completed_at": utc_now(),
    }
    write_json(manifest_path, payload)
    return payload
