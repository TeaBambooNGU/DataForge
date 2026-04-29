from __future__ import annotations

from pathlib import Path

from dataforge.core.db import transaction


SCHEMA_VERSION = 1


def initialize_database(project_root: Path) -> None:
    with transaction(project_root) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                task_root TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL,
                status TEXT NOT NULL,
                last_stage TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(task_id, run_id)
            );

            CREATE INDEX IF NOT EXISTS idx_runs_task_updated_at
            ON runs(task_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS run_stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                stage_name TEXT NOT NULL,
                completed_at TEXT,
                stats_json TEXT NOT NULL,
                summary_json TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                UNIQUE(run_id, stage_name)
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                artifact_key TEXT NOT NULL,
                content_type TEXT NOT NULL,
                record_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                UNIQUE(run_id, artifact_key)
            );

            CREATE TABLE IF NOT EXISTS artifact_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
                record_index INTEGER NOT NULL,
                sample_id TEXT,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_artifact_records_artifact_index
            ON artifact_records(artifact_id, record_index);

            CREATE INDEX IF NOT EXISTS idx_artifact_records_artifact_sample
            ON artifact_records(artifact_id, sample_id);

            CREATE TABLE IF NOT EXISTS artifact_blobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                sample_id TEXT NOT NULL,
                review_decision TEXT,
                reviewer_label TEXT,
                review_comment TEXT,
                reviewed_by TEXT,
                reviewed_at TEXT,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_review_records_run_sample
            ON review_records(run_id, sample_id);
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
            VALUES (?, datetime('now'))
            """,
            (SCHEMA_VERSION,),
        )
