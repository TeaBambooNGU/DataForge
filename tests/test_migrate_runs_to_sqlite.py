from __future__ import annotations

from pathlib import Path
from shutil import copytree

from dataforge.core.io import write_json, write_jsonl
from dataforge.core.storage import (
    get_artifact_info,
    get_run,
    load_artifact_records,
    load_blob_artifact,
    load_review_records,
    list_run_stages,
)
from dataforge.scripts.migrate_runs_to_sqlite import migrate_project_runs


def _create_legacy_project(tmp_path: Path) -> Path:
    copytree(Path(".") / "tasks" / "report-intent-distill", tmp_path / "tasks" / "report-intent-distill")
    task_root = tmp_path / "tasks" / "report-intent-distill"
    runs_root = task_root / "runs"
    run_root = runs_root / "run-legacy-001"
    (run_root / "raw").mkdir(parents=True, exist_ok=True)
    (run_root / "processed").mkdir(parents=True, exist_ok=True)
    (run_root / "gold").mkdir(parents=True, exist_ok=True)
    (run_root / "exports").mkdir(parents=True, exist_ok=True)
    (run_root / "training").mkdir(parents=True, exist_ok=True)
    (run_root / "reports" / "manifests").mkdir(parents=True, exist_ok=True)

    write_json(
        runs_root / "index.json",
        {
            "runs": [
                {
                    "run_id": "run-legacy-001",
                    "task_name": "report-intent-distill",
                    "run_root": str(run_root),
                    "created_at": "2026-04-01T00:00:00+00:00",
                    "updated_at": "2026-04-01T00:10:00+00:00",
                    "status": "evaluated",
                    "last_stage": "eval",
                    "stages": {
                        "generate": {
                            "manifest_path": str(run_root / "reports" / "manifests" / "generate.json"),
                            "completed_at": "2026-04-01T00:01:00+00:00",
                            "stats": {"generated_samples": 1},
                            "summary": {},
                        },
                        "eval": {
                            "manifest_path": str(run_root / "reports" / "manifests" / "eval.json"),
                            "completed_at": "2026-04-01T00:10:00+00:00",
                            "stats": {"sample_count": 1},
                            "summary": {"sample_count": 1, "promptfoo_status": "ok"},
                        },
                    },
                }
            ]
        },
    )
    write_json(
        runs_root / "latest.json",
        {"run_id": "run-legacy-001", "status": "evaluated", "updated_at": "2026-04-01T00:10:00+00:00"},
    )
    write_json(
        run_root / "reports" / "manifests" / "generate.json",
        {
            "task_name": "report-intent-distill",
            "run_id": "run-legacy-001",
            "stage_name": "generate",
            "completed_at": "2026-04-01T00:01:00+00:00",
            "stats": {"generated_samples": 1},
            "summary": {},
        },
    )
    write_json(
        run_root / "reports" / "manifests" / "eval.json",
        {
            "task_name": "report-intent-distill",
            "run_id": "run-legacy-001",
            "stage_name": "eval",
            "completed_at": "2026-04-01T00:10:00+00:00",
            "stats": {"sample_count": 1},
            "summary": {"sample_count": 1, "promptfoo_status": "ok"},
        },
    )
    write_jsonl(run_root / "raw" / "raw_candidates.jsonl", [{"id": "sample-1", "input": {"user_text": "hi"}}])
    write_jsonl(
        run_root / "raw" / "teacher_labeled.jsonl",
        [
            {
                "id": "sample-1",
                "input": {"user_text": "hi"},
                "annotation": {"teacher_label": "chat", "parse_ok": True, "review_status": "unreviewed", "human_label": None, "final_label": None},
            }
        ],
    )
    write_json(run_root / "processed" / "labelstudio_import.json", [{"id": "sample-1"}])
    write_jsonl(
        run_root / "processed" / "review_results.jsonl",
        [
            {
                "sample_id": "sample-1",
                "task_name": "report-intent-distill",
                "user_text": "hi",
                "teacher_label": "chat",
                "review_decision": "accepted",
                "reviewer_label": "chat",
                "review_comment": "",
                "reviewed_by": "alice",
                "reviewed_at": "2026-04-01T00:05:00+00:00",
            }
        ],
    )
    write_jsonl(
        run_root / "gold" / "gold_eval.jsonl",
        [
            {
                "id": "sample-1",
                "input": {"user_text": "hi"},
                "annotation": {"final_label": "chat"},
                "metadata": {"difficulty": "easy", "tags": []},
            }
        ],
    )
    write_jsonl(run_root / "gold" / "hard_cases.jsonl", [])
    write_json(run_root / "gold" / "hard_cases_metadata.json", {"dataset_name": "hard-cases"})
    write_jsonl(
        run_root / "exports" / "eval_predictions.jsonl",
        [{"id": "sample-1", "expected_label": "chat", "predicted_label": "chat", "parse_ok": True}],
    )
    write_json(run_root / "exports" / "eval_dataset_metadata.json", {"dataset_name": "eval-export"})
    write_json(run_root / "reports" / "eval_result.json", {"metrics": {"overall_accuracy": 1.0}})
    write_json(run_root / "training" / "metadata.json", {"dataset_name": "student-train"})
    return tmp_path


def test_migrate_runs_to_sqlite_dry_run_reports_without_writing(tmp_path: Path) -> None:
    project_root = _create_legacy_project(tmp_path)
    report = migrate_project_runs(project_root, dry_run=True)

    assert report["dry_run"] is True
    assert report["totals"]["tasks"] == 1
    assert report["totals"]["runs"] == 1
    assert get_run(project_root, task_name="report-intent-distill", run_id="run-legacy-001") is None


def test_migrate_runs_to_sqlite_imports_legacy_run(tmp_path: Path) -> None:
    project_root = _create_legacy_project(tmp_path)

    report = migrate_project_runs(project_root, dry_run=False)

    assert report["dry_run"] is False
    run = get_run(project_root, task_name="report-intent-distill", run_id="run-legacy-001")
    assert run is not None
    assert run["status"] == "evaluated"
    assert get_artifact_info(project_root, task_name="report-intent-distill", run_id="run-legacy-001", artifact_key="raw_candidates") is not None
    assert load_artifact_records(
        project_root,
        task_name="report-intent-distill",
        run_id="run-legacy-001",
        artifact_key="raw_candidates",
    )[0]["id"] == "sample-1"
    assert load_blob_artifact(
        project_root,
        task_name="report-intent-distill",
        run_id="run-legacy-001",
        artifact_key="eval_result",
    )["metrics"]["overall_accuracy"] == 1.0
    assert load_review_records(
        project_root,
        task_name="report-intent-distill",
        run_id="run-legacy-001",
    )[0]["reviewed_by"] == "alice"
    stages = list_run_stages(project_root, task_name="report-intent-distill", run_id="run-legacy-001")
    assert set(stages) == {"generate", "eval"}
