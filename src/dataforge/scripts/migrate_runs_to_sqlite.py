from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from dataforge.core.io import read_json, read_jsonl
from dataforge.core.registry import RUN_ARTIFACT_PATHS, TaskRun, discover_tasks, load_task_config
from dataforge.core.storage import (
    save_artifact_records,
    save_blob_artifact,
    save_review_records,
    upsert_run_snapshot,
    upsert_run_stage_snapshot,
)


RECORD_ARTIFACT_KEYS = {
    "raw_candidates",
    "teacher_labeled",
    "filtered_train",
    "rejected_samples",
    "review_candidates",
    "gold_eval",
    "hard_cases",
    "eval_predictions",
}
BLOB_ARTIFACT_KEYS = {
    "labelstudio_import",
    "train_export_metadata",
    "eval_export_metadata",
    "training_metadata",
    "eval_result",
    "hard_cases_metadata",
}


def _load_json_if_exists(path: Path) -> Any | None:
    if not path.exists():
        return None
    return read_json(path)


def _reverse_artifact_paths() -> dict[str, str]:
    return {relative_path: artifact_key for artifact_key, relative_path in RUN_ARTIFACT_PATHS.items()}


def _migrate_run_artifacts(project_root: Path, task_name: str, run: TaskRun, *, dry_run: bool) -> dict[str, int]:
    counts = {"records": 0, "blobs": 0, "reviews": 0, "files_seen": 0}
    for artifact_key in RECORD_ARTIFACT_KEYS:
        path = run.path_for(artifact_key)
        if not path.exists():
            continue
        rows = read_jsonl(path)
        counts["files_seen"] += 1
        counts["records"] += 1
        if not dry_run:
            save_artifact_records(
                project_root,
                task_name=task_name,
                task_root=run.task_root,
                run_id=run.run_id,
                artifact_key=artifact_key,
                records=rows,
            )

    for artifact_key in BLOB_ARTIFACT_KEYS:
        path = run.path_for(artifact_key)
        if not path.exists():
            continue
        payload = read_json(path)
        counts["files_seen"] += 1
        counts["blobs"] += 1
        if not dry_run:
            save_blob_artifact(
                project_root,
                task_name=task_name,
                task_root=run.task_root,
                run_id=run.run_id,
                artifact_key=artifact_key,
                payload=payload,
            )

    review_results_path = run.path_for("review_results")
    if review_results_path.exists():
        review_rows = read_jsonl(review_results_path)
        counts["files_seen"] += 1
        counts["reviews"] += 1
        if not dry_run:
            save_review_records(
                project_root,
                task_name=task_name,
                task_root=run.task_root,
                run_id=run.run_id,
                records=review_rows,
            )
    return counts


def _migrate_run_entry(project_root: Path, task_name: str, task_root: Path, entry: dict[str, Any], *, dry_run: bool) -> dict[str, Any]:
    run_id = entry["run_id"]
    run = TaskRun(task=load_task_config(project_root, task_name), run_id=run_id)
    result = {
        "run_id": run_id,
        "stages": 0,
        "records": 0,
        "blobs": 0,
        "reviews": 0,
        "files_seen": 0,
    }
    if not dry_run:
        upsert_run_snapshot(
            project_root,
            task_name=task_name,
            task_root=task_root,
            run_id=run_id,
            created_at=entry.get("created_at") or "",
            updated_at=entry.get("updated_at") or entry.get("created_at") or "",
            status=entry.get("status") or "created",
            last_stage=entry.get("last_stage"),
        )

    stages = entry.get("stages", {})
    for stage_name, stage_entry in stages.items():
        manifest_path_value = stage_entry.get("manifest_path")
        manifest_payload = (
            _load_json_if_exists(Path(manifest_path_value))
            if manifest_path_value
            else None
        ) or {
            "task_name": task_name,
            "run_id": run_id,
            "stage_name": stage_name,
            "completed_at": stage_entry.get("completed_at"),
            "stats": stage_entry.get("stats", {}),
            "summary": stage_entry.get("summary", {}),
            "manifest_path": manifest_path_value,
        }
        result["stages"] += 1
        if not dry_run:
            upsert_run_stage_snapshot(
                project_root,
                task_name=task_name,
                task_root=task_root,
                run_id=run_id,
                stage_name=stage_name,
                completed_at=manifest_payload.get("completed_at"),
                stats=manifest_payload.get("stats", {}),
                summary=manifest_payload.get("summary", {}),
                manifest=manifest_payload,
            )

    artifact_counts = _migrate_run_artifacts(project_root, task_name, run, dry_run=dry_run)
    result.update(artifact_counts)
    return result


def migrate_project_runs(project_root: Path, *, dry_run: bool = False) -> dict[str, Any]:
    tasks_report: list[dict[str, Any]] = []
    totals = {"tasks": 0, "runs": 0, "stages": 0, "records": 0, "blobs": 0, "reviews": 0, "files_seen": 0}
    for task_name in discover_tasks(project_root):
        task = load_task_config(project_root, task_name)
        index_path = task.task_root / "runs" / "index.json"
        if not index_path.exists():
            continue
        index_payload = read_json(index_path)
        run_entries = index_payload.get("runs", [])
        migrated_runs: list[dict[str, Any]] = []
        for entry in run_entries:
            migrated = _migrate_run_entry(project_root, task_name, task.task_root, entry, dry_run=dry_run)
            migrated_runs.append(migrated)
            totals["runs"] += 1
            totals["stages"] += migrated["stages"]
            totals["records"] += migrated["records"]
            totals["blobs"] += migrated["blobs"]
            totals["reviews"] += migrated["reviews"]
            totals["files_seen"] += migrated["files_seen"]
        tasks_report.append({"task_name": task_name, "runs": migrated_runs})
        totals["tasks"] += 1
    return {"dry_run": dry_run, "totals": totals, "tasks": tasks_report}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Migrate historical run artifacts into SQLite.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    project_root = Path(args.project_root).resolve()
    report = migrate_project_runs(project_root, dry_run=args.dry_run)
    import json

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
