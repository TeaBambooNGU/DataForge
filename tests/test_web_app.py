from __future__ import annotations

from pathlib import Path

from dataforge.core.io import read_json
from dataforge.core.registry import create_task_run, load_task_config, resolve_task_run
from dataforge.web.app import _ensure_command_is_runnable, _serialize_run


def _create_test_project(tmp_path: Path) -> Path:
    (tmp_path / "frontend").mkdir()
    config_dir = tmp_path / "tasks" / "report-intent-distill" / "configs"
    config_dir.mkdir(parents=True)
    (config_dir / "task.yaml").write_text(
        "\n".join(
            [
                "name: report-intent-distill",
                "theme: report_intent_classification",
                "language: zh",
                "task_type: classification",
                "entry_schema: conversation_action",
                "runtime: {}",
                "rules: {}",
                "exports: {}",
                "paths: {}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return tmp_path


def test_serialize_run_exposes_eval_summary(tmp_path: Path) -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.task_root = tmp_path / "report-intent-distill"
    run = create_task_run(task, "run-web-001")
    manifest = {
        "completed_at": "2026-04-04T00:00:00+00:00",
        "stats": {"sample_count": 12},
        "summary": {
            "sample_count": 12,
            "overall_accuracy": 0.9,
            "macro_f1": 0.88,
            "promptfoo_status": "ok",
        },
    }
    run.record_stage("eval", manifest, run.path_for("eval_manifest"))
    index_payload = read_json(run.index_path)
    entry = index_payload["runs"][0]

    serialized = _serialize_run(task, entry)

    assert serialized["evaluation"] == manifest["summary"]
    assert any(artifact["key"] == "eval_result" for artifact in serialized["artifacts"])


def test_run_command_rejects_repeated_stage_for_existing_run(tmp_path: Path) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    run = create_task_run(task, "run-web-002")
    run.record_stage(
        "classify",
        {"completed_at": "2026-04-04T00:00:00+00:00", "stats": {"sample_count": 3}},
        run.path_for("classify_manifest"),
    )

    try:
        _ensure_command_is_runnable(task, "classify", run)
    except ValueError as exc:
        assert "already been completed" in str(exc)
    else:
        raise AssertionError("expected repeated classify command to be rejected")


def test_run_command_allows_new_run_commands_after_previous_runs(tmp_path: Path, monkeypatch) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    existing_run = create_task_run(task, "run-existing-001")
    generated_ids = iter(["run-new-001", "run-new-002"])
    monkeypatch.setattr("dataforge.core.registry.generate_run_id", lambda prefix="run": next(generated_ids))

    for command in ("generate", "run-all"):
        next_run = resolve_task_run(task, command=command)
        _ensure_command_is_runnable(task, command, next_run)
        assert next_run.run_id.startswith("run-")
        assert next_run.run_id != existing_run.run_id

    index = read_json(project_root / "tasks" / "report-intent-distill" / "runs" / "index.json")
    assert len(index["runs"]) == 3
