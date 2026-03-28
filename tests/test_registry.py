from pathlib import Path

import pytest

from dataforge.core.io import read_json
from dataforge.core.registry import create_task_run, discover_tasks, latest_run_id, load_task_config, require_entry_status


def test_discover_tasks() -> None:
    tasks = discover_tasks(Path("."))
    assert "report-intent-distill" in tasks


def test_load_task_config_resolves_paths() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    assert task.name == "report-intent-distill"
    assert task.path_for("labels").name == "labels.yaml"


def test_create_task_run_updates_latest_index(tmp_path: Path) -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.task_root = tmp_path / "report-intent-distill"
    run = create_task_run(task, "run-test-001")
    assert run.path_for("raw_candidates") == (task.task_root / "runs" / "run-test-001" / "raw" / "raw_candidates.jsonl").resolve()
    assert latest_run_id(task) == "run-test-001"
    assert read_json(task.task_root / "runs" / "latest.json")["status"] == "created"


def test_run_status_only_moves_forward(tmp_path: Path) -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.task_root = tmp_path / "report-intent-distill"
    run = create_task_run(task, "run-test-002")
    run.record_stage("eval", {"completed_at": "2026-03-28T00:00:00+00:00", "stats": {}}, run.path_for("eval_manifest"))
    run.record_stage(
        "validate_review",
        {"completed_at": "2026-03-28T00:01:00+00:00", "stats": {}},
        run.path_for("review_validate_manifest"),
    )
    latest = read_json(task.task_root / "runs" / "latest.json")
    index = read_json(task.task_root / "runs" / "index.json")
    assert latest["status"] == "evaluated"
    assert index["runs"][0]["status"] == "evaluated"
    assert index["runs"][0]["last_stage"] == "validate_review"


def test_require_entry_status_rejects_legacy_run_entry() -> None:
    entry = {
        "run_id": "run-test-003",
        "stages": {
            "generate": {},
            "classify": {},
            "eval": {},
        },
    }
    with pytest.raises(ValueError, match="missing a valid status"):
        require_entry_status(entry)
