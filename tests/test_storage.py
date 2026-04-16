from pathlib import Path

from dataforge.core.storage import (
    ensure_run,
    latest_run,
    load_artifact_records,
    load_blob_artifact,
    load_review_records,
    record_stage,
    save_artifact_records,
    save_blob_artifact,
    save_review_records,
)


def test_storage_roundtrip_for_run_and_artifacts(tmp_path: Path) -> None:
    task_root = tmp_path / "tasks" / "demo"
    run = ensure_run(tmp_path, task_name="demo", task_root=task_root, run_id="run-001")
    assert run["status"] == "created"

    save_artifact_records(
        tmp_path,
        task_name="demo",
        task_root=task_root,
        run_id="run-001",
        artifact_key="raw_candidates",
        records=[{"id": "s1", "user_text": "hello"}],
    )
    assert load_artifact_records(
        tmp_path,
        task_name="demo",
        run_id="run-001",
        artifact_key="raw_candidates",
    ) == [{"id": "s1", "user_text": "hello"}]

    save_blob_artifact(
        tmp_path,
        task_name="demo",
        task_root=task_root,
        run_id="run-001",
        artifact_key="eval_result",
        payload={"ok": True},
    )
    assert load_blob_artifact(
        tmp_path,
        task_name="demo",
        run_id="run-001",
        artifact_key="eval_result",
    ) == {"ok": True}


def test_storage_roundtrip_for_review_and_stage(tmp_path: Path) -> None:
    task_root = tmp_path / "tasks" / "demo"
    save_review_records(
        tmp_path,
        task_name="demo",
        task_root=task_root,
        run_id="run-002",
        records=[
            {
                "sample_id": "s1",
                "review_decision": "accepted",
                "reviewer_label": "chat",
                "review_comment": "",
                "reviewed_by": "tester",
                "reviewed_at": "2026-04-16T00:00:00+00:00",
            }
        ],
    )
    assert load_review_records(tmp_path, task_name="demo", run_id="run-002")[0]["sample_id"] == "s1"

    record_stage(
        tmp_path,
        task_name="demo",
        task_root=task_root,
        run_id="run-002",
        stage_name="generate",
        manifest={"completed_at": "2026-04-16T00:00:00+00:00", "stats": {"count": 1}, "summary": {"ok": True}},
        manifest_path=str(task_root / "runs" / "run-002" / "reports" / "manifests" / "generate.json"),
    )
    latest = latest_run(tmp_path, task_name="demo")
    assert latest is not None
    assert latest["run_id"] == "run-002"
    assert latest["status"] == "generated"
