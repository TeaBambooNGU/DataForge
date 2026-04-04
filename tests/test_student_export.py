from pathlib import Path

from dataforge.core.io import read_json, read_jsonl
from dataforge.core.registry import create_task_run, load_task_config
from dataforge.pipelines import classify, filter_export, generate, student_export


def test_student_export_writes_training_artifacts(tmp_path: Path) -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.task_root = tmp_path / "report-intent-distill"
    task.config["runtime"]["generator"]["provider"] = "mock"
    task.config["runtime"]["teacher"]["provider"] = "mock"
    run = create_task_run(task, "run-student-001")

    raw_path = generate.run(run)
    labeled_path = classify.run(run, input_path=raw_path)
    filter_export.run(run, input_path=labeled_path)
    outputs = student_export.run(run)

    student_rows = read_jsonl(outputs["student_train"])
    metadata = read_json(outputs["training_metadata"])

    assert student_rows
    assert student_rows[0]["messages"][0]["role"] == "user"
    assert metadata["version_id"] == "run-student-001-student-train-chatml_jsonl"
    assert metadata["includes_hard_cases"] is False
