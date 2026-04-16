from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from dataforge.core.db import transaction
from dataforge.core.io import utc_now
from dataforge.core.migrations import initialize_database
from dataforge.core.run_state import RUN_STATUS_ORDER, STAGE_TO_STATUS


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _json_loads(payload: str) -> Any:
    return json.loads(payload)


def initialize_storage(project_root: Path) -> None:
    initialize_database(project_root)


def ensure_task(project_root: Path, *, task_name: str, task_root: Path) -> int:
    initialize_storage(project_root)
    now = utc_now()
    with transaction(project_root) as connection:
        connection.execute(
            """
            INSERT INTO tasks(name, task_root, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                task_root=excluded.task_root,
                updated_at=excluded.updated_at
            """,
            (task_name, str(task_root), now, now),
        )
        row = connection.execute(
            "SELECT id FROM tasks WHERE name = ?",
            (task_name,),
        ).fetchone()
        return int(row["id"])


def ensure_run(project_root: Path, *, task_name: str, task_root: Path, run_id: str) -> dict[str, Any]:
    task_id = ensure_task(project_root, task_name=task_name, task_root=task_root)
    now = utc_now()
    with transaction(project_root) as connection:
        connection.execute(
            """
            INSERT INTO runs(task_id, run_id, status, last_stage, created_at, updated_at)
            VALUES (?, ?, 'created', NULL, ?, ?)
            ON CONFLICT(task_id, run_id) DO NOTHING
            """,
            (task_id, run_id, now, now),
        )
    return get_run(project_root, task_name=task_name, run_id=run_id)


def upsert_run_snapshot(
    project_root: Path,
    *,
    task_name: str,
    task_root: Path,
    run_id: str,
    created_at: str,
    updated_at: str,
    status: str,
    last_stage: str | None,
) -> dict[str, Any]:
    task_id = ensure_task(project_root, task_name=task_name, task_root=task_root)
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        connection.execute(
            """
            INSERT INTO runs(task_id, run_id, status, last_stage, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(task_id, run_id) DO UPDATE SET
                status=excluded.status,
                last_stage=excluded.last_stage,
                created_at=excluded.created_at,
                updated_at=excluded.updated_at
            """,
            (task_id, run_id, status, last_stage, created_at, updated_at),
        )
    return get_run(project_root, task_name=task_name, run_id=run_id) or {
        "run_id": run_id,
        "status": status,
        "last_stage": last_stage,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def get_run(project_root: Path, *, task_name: str, run_id: str) -> dict[str, Any] | None:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        row = connection.execute(
            """
            SELECT
                runs.id AS db_run_id,
                runs.run_id AS run_id,
                runs.status AS status,
                runs.last_stage AS last_stage,
                runs.created_at AS created_at,
                runs.updated_at AS updated_at,
                tasks.name AS task_name,
                tasks.task_root AS task_root
            FROM runs
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ? AND runs.run_id = ?
            """,
            (task_name, run_id),
        ).fetchone()
        if row is None:
            return None
        return dict(row)


def latest_run(project_root: Path, *, task_name: str) -> dict[str, Any] | None:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        row = connection.execute(
            """
            SELECT
                runs.id AS db_run_id,
                runs.run_id AS run_id,
                runs.status AS status,
                runs.last_stage AS last_stage,
                runs.created_at AS created_at,
                runs.updated_at AS updated_at,
                tasks.name AS task_name,
                tasks.task_root AS task_root
            FROM runs
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ?
            ORDER BY runs.updated_at DESC, runs.id DESC
            LIMIT 1
            """,
            (task_name,),
        ).fetchone()
        return dict(row) if row is not None else None


def list_runs(project_root: Path, *, task_name: str) -> list[dict[str, Any]]:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        rows = connection.execute(
            """
            SELECT
                runs.id AS db_run_id,
                runs.run_id AS run_id,
                runs.status AS status,
                runs.last_stage AS last_stage,
                runs.created_at AS created_at,
                runs.updated_at AS updated_at
            FROM runs
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ?
            ORDER BY runs.created_at DESC, runs.id DESC
            """,
            (task_name,),
        ).fetchall()
        return [dict(row) for row in rows]


def list_run_stages(project_root: Path, *, task_name: str, run_id: str) -> dict[str, Any]:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        rows = connection.execute(
            """
            SELECT
                run_stages.stage_name,
                run_stages.completed_at,
                run_stages.stats_json,
                run_stages.summary_json,
                run_stages.manifest_json
            FROM run_stages
            JOIN runs ON runs.id = run_stages.run_id
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ? AND runs.run_id = ?
            ORDER BY run_stages.id ASC
            """,
            (task_name, run_id),
        ).fetchall()
    stages: dict[str, Any] = {}
    for row in rows:
        stages[row["stage_name"]] = {
            "completed_at": row["completed_at"],
            "stats": _json_loads(row["stats_json"]),
            "summary": _json_loads(row["summary_json"]),
            "manifest": _json_loads(row["manifest_json"]),
        }
    return stages


def get_artifact_info(
    project_root: Path,
    *,
    task_name: str,
    run_id: str,
    artifact_key: str,
) -> dict[str, Any] | None:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        row = connection.execute(
            """
            SELECT
                artifacts.content_type,
                artifacts.record_count,
                artifacts.updated_at,
                artifacts.metadata_json
            FROM artifacts
            JOIN runs ON runs.id = artifacts.run_id
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ? AND runs.run_id = ? AND artifacts.artifact_key = ?
            """,
            (task_name, run_id, artifact_key),
        ).fetchone()
        if row is None:
            return None
        return {
            "content_type": row["content_type"],
            "record_count": row["record_count"],
            "updated_at": row["updated_at"],
            "metadata": _json_loads(row["metadata_json"]),
        }


def delete_run(project_root: Path, *, task_name: str, run_id: str) -> None:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        row = connection.execute(
            """
            SELECT runs.id
            FROM runs
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ? AND runs.run_id = ?
            """,
            (task_name, run_id),
        ).fetchone()
        if row is None:
            raise FileNotFoundError(f"Run not found: {run_id}")
        connection.execute("DELETE FROM runs WHERE id = ?", (row["id"],))


def record_stage(
    project_root: Path,
    *,
    task_name: str,
    task_root: Path,
    run_id: str,
    stage_name: str,
    manifest: dict[str, Any],
    manifest_path: str,
) -> dict[str, Any]:
    run = ensure_run(project_root, task_name=task_name, task_root=task_root, run_id=run_id)
    now = utc_now()
    next_status = STAGE_TO_STATUS.get(stage_name, run["status"])
    current_status = run["status"]
    if RUN_STATUS_ORDER[next_status] < RUN_STATUS_ORDER[current_status]:
        next_status = current_status
    with transaction(project_root) as connection:
        connection.execute(
            """
            UPDATE runs
            SET status = ?, last_stage = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_status, stage_name, now, run["db_run_id"]),
        )
        connection.execute(
            """
            INSERT INTO run_stages(run_id, stage_name, completed_at, stats_json, summary_json, manifest_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id, stage_name) DO UPDATE SET
                completed_at=excluded.completed_at,
                stats_json=excluded.stats_json,
                summary_json=excluded.summary_json,
                manifest_json=excluded.manifest_json
            """,
            (
                run["db_run_id"],
                stage_name,
                manifest.get("completed_at"),
                _json_dumps(manifest.get("stats", {})),
                _json_dumps(manifest.get("summary", {})),
                _json_dumps({**manifest, "manifest_path": manifest_path}),
            ),
        )
    return get_run(project_root, task_name=task_name, run_id=run_id) or run


def upsert_run_stage_snapshot(
    project_root: Path,
    *,
    task_name: str,
    task_root: Path,
    run_id: str,
    stage_name: str,
    completed_at: str | None,
    stats: dict[str, Any],
    summary: dict[str, Any],
    manifest: dict[str, Any],
) -> None:
    run = ensure_run(project_root, task_name=task_name, task_root=task_root, run_id=run_id)
    with transaction(project_root) as connection:
        connection.execute(
            """
            INSERT INTO run_stages(run_id, stage_name, completed_at, stats_json, summary_json, manifest_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id, stage_name) DO UPDATE SET
                completed_at=excluded.completed_at,
                stats_json=excluded.stats_json,
                summary_json=excluded.summary_json,
                manifest_json=excluded.manifest_json
            """,
            (
                run["db_run_id"],
                stage_name,
                completed_at,
                _json_dumps(stats),
                _json_dumps(summary),
                _json_dumps(manifest),
            ),
        )


def save_artifact_records(
    project_root: Path,
    *,
    task_name: str,
    task_root: Path,
    run_id: str,
    artifact_key: str,
    records: list[dict[str, Any]],
    metadata: dict[str, Any] | None = None,
) -> None:
    run = ensure_run(project_root, task_name=task_name, task_root=task_root, run_id=run_id)
    now = utc_now()
    with transaction(project_root) as connection:
        connection.execute(
            """
            INSERT INTO artifacts(run_id, artifact_key, content_type, record_count, updated_at, metadata_json)
            VALUES (?, ?, 'records', ?, ?, ?)
            ON CONFLICT(run_id, artifact_key) DO UPDATE SET
                content_type='records',
                record_count=excluded.record_count,
                updated_at=excluded.updated_at,
                metadata_json=excluded.metadata_json
            """,
            (run["db_run_id"], artifact_key, len(records), now, _json_dumps(metadata or {})),
        )
        artifact_row = connection.execute(
            "SELECT id FROM artifacts WHERE run_id = ? AND artifact_key = ?",
            (run["db_run_id"], artifact_key),
        ).fetchone()
        artifact_id = int(artifact_row["id"])
        connection.execute("DELETE FROM artifact_records WHERE artifact_id = ?", (artifact_id,))
        connection.executemany(
            """
            INSERT INTO artifact_records(artifact_id, record_index, sample_id, payload_json)
            VALUES (?, ?, ?, ?)
            """,
            [
                (
                    artifact_id,
                    index,
                    record.get("id") or record.get("sample_id"),
                    _json_dumps(record),
                )
                for index, record in enumerate(records)
            ],
        )


def load_artifact_records(
    project_root: Path,
    *,
    task_name: str,
    run_id: str,
    artifact_key: str,
) -> list[dict[str, Any]]:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        rows = connection.execute(
            """
            SELECT artifact_records.payload_json
            FROM artifact_records
            JOIN artifacts ON artifacts.id = artifact_records.artifact_id
            JOIN runs ON runs.id = artifacts.run_id
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ? AND runs.run_id = ? AND artifacts.artifact_key = ?
            ORDER BY artifact_records.record_index ASC
            """,
            (task_name, run_id, artifact_key),
        ).fetchall()
        return [_json_loads(row["payload_json"]) for row in rows]


def save_blob_artifact(
    project_root: Path,
    *,
    task_name: str,
    task_root: Path,
    run_id: str,
    artifact_key: str,
    payload: Any,
    metadata: dict[str, Any] | None = None,
) -> None:
    run = ensure_run(project_root, task_name=task_name, task_root=task_root, run_id=run_id)
    now = utc_now()
    with transaction(project_root) as connection:
        connection.execute(
            """
            INSERT INTO artifacts(run_id, artifact_key, content_type, record_count, updated_at, metadata_json)
            VALUES (?, ?, 'blob', 1, ?, ?)
            ON CONFLICT(run_id, artifact_key) DO UPDATE SET
                content_type='blob',
                record_count=1,
                updated_at=excluded.updated_at,
                metadata_json=excluded.metadata_json
            """,
            (run["db_run_id"], artifact_key, now, _json_dumps(metadata or {})),
        )
        artifact_row = connection.execute(
            "SELECT id FROM artifacts WHERE run_id = ? AND artifact_key = ?",
            (run["db_run_id"], artifact_key),
        ).fetchone()
        artifact_id = int(artifact_row["id"])
        connection.execute("DELETE FROM artifact_blobs WHERE artifact_id = ?", (artifact_id,))
        connection.execute(
            "INSERT INTO artifact_blobs(artifact_id, payload_json) VALUES (?, ?)",
            (artifact_id, _json_dumps(payload)),
        )


def load_blob_artifact(
    project_root: Path,
    *,
    task_name: str,
    run_id: str,
    artifact_key: str,
) -> Any:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        row = connection.execute(
            """
            SELECT artifact_blobs.payload_json
            FROM artifact_blobs
            JOIN artifacts ON artifacts.id = artifact_blobs.artifact_id
            JOIN runs ON runs.id = artifacts.run_id
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ? AND runs.run_id = ? AND artifacts.artifact_key = ?
            """,
            (task_name, run_id, artifact_key),
        ).fetchone()
        return _json_loads(row["payload_json"]) if row is not None else None


def save_review_records(
    project_root: Path,
    *,
    task_name: str,
    task_root: Path,
    run_id: str,
    records: list[dict[str, Any]],
) -> None:
    run = ensure_run(project_root, task_name=task_name, task_root=task_root, run_id=run_id)
    with transaction(project_root) as connection:
        connection.execute("DELETE FROM review_records WHERE run_id = ?", (run["db_run_id"],))
        connection.executemany(
            """
            INSERT INTO review_records(
                run_id, sample_id, review_decision, reviewer_label, review_comment, reviewed_by, reviewed_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    run["db_run_id"],
                    record["sample_id"],
                    record.get("review_decision"),
                    record.get("reviewer_label"),
                    record.get("review_comment"),
                    record.get("reviewed_by"),
                    record.get("reviewed_at"),
                    _json_dumps(record),
                )
                for record in records
            ],
        )


def load_review_records(project_root: Path, *, task_name: str, run_id: str) -> list[dict[str, Any]]:
    initialize_storage(project_root)
    with transaction(project_root) as connection:
        rows = connection.execute(
            """
            SELECT payload_json
            FROM review_records
            JOIN runs ON runs.id = review_records.run_id
            JOIN tasks ON tasks.id = runs.task_id
            WHERE tasks.name = ? AND runs.run_id = ?
            ORDER BY review_records.id ASC
            """,
            (task_name, run_id),
        ).fetchall()
        return [_json_loads(row["payload_json"]) for row in rows]
