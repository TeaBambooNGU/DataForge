from pathlib import Path

from dataforge.core.io import read_jsonl
from dataforge.core.registry import create_task_run, load_task_config
from dataforge.core.storage import load_blob_artifact
from dataforge.pipelines import classify, filter_export, generate, student_export


def test_student_export_writes_training_artifacts(tmp_path: Path) -> None:
    from shutil import copytree

    copytree(Path(".") / "tasks" / "report-intent-distill", tmp_path / "tasks" / "report-intent-distill")
    task = load_task_config(tmp_path, "report-intent-distill")
    task.config["runtime"]["generator"]["provider"] = "mock"
    task.config["runtime"]["teacher"]["provider"] = "mock"
    run = create_task_run(task, "run-student-001")

    raw_path = generate.run(run)
    labeled_path = classify.run(run, input_path=raw_path)
    filter_export.run(run, input_path=labeled_path)
    outputs = student_export.run(run)

    student_rows = read_jsonl(outputs["student_train"])
    stored_metadata = load_blob_artifact(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="training_metadata")

    assert student_rows
    assert list(student_rows[0].keys()) == ["messages"]
    assert student_rows[0]["messages"][0]["role"] == "system"
    assert student_rows[0]["messages"][1]["role"] == "user"
    assert stored_metadata["version_id"] == "run-student-001-student-train-chatml_jsonl"
    assert stored_metadata["artifact_role"] == "final_sft_dataset"
    assert stored_metadata["is_final_sft_dataset"] is True
    assert stored_metadata["canonical_dataset_path"].endswith("processed/filtered_train.jsonl")
    assert stored_metadata["has_system_prompt"] is True
    assert stored_metadata["includes_hard_cases"] is False
