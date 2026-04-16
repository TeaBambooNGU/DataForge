from pathlib import Path
import shutil

from dataforge.core.io import read_jsonl, write_json
from dataforge.core.registry import create_task_run, load_task_config
from dataforge.core.storage import (
    get_run,
    list_run_stages,
    load_artifact_records,
    load_blob_artifact,
    load_review_records,
    save_review_records,
)
from dataforge.pipelines import build_gold, classify, eval as eval_pipeline, filter_export, generate, review_export, student_export, validate_review


def test_pipeline_smoke(tmp_path: Path, monkeypatch) -> None:
    project_root = Path(".")
    shutil.copytree(project_root / "tasks" / "report-intent-distill", tmp_path / "tasks" / "report-intent-distill")
    task = load_task_config(tmp_path, "report-intent-distill")
    task.config["runtime"]["generator"]["provider"] = "mock"
    task.config["runtime"]["teacher"]["provider"] = "mock"
    task.config["runtime"]["eval"]["provider"] = "mock"
    run = create_task_run(task, "run-smoke-001")

    def fake_promptfoo_eval(command, config_path, results_path, *, cwd, runner=None):
        write_json(results_path, {"summary": {"passRate": 1.0}, "results": []})
        return {
            "status": "ok",
            "command": [*command, "eval", "-c", str(config_path), "--output", str(results_path), "--no-cache"],
            "results_path": str(results_path),
            "stdout": "promptfoo ok",
            "stderr": "",
            "summary": {"passRate": 1.0},
        }

    monkeypatch.setattr(eval_pipeline, "run_promptfoo_eval", fake_promptfoo_eval)

    raw_path = generate.run(run)
    labeled_path = classify.run(run, input_path=raw_path)

    outputs = filter_export.run(run, input_path=labeled_path)
    student_outputs = student_export.run(run)
    review_export_path = review_export.run(run, review_source=Path(outputs["review_import"]))
    raw_candidates_records = load_artifact_records(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="raw_candidates")
    teacher_labeled_records = load_artifact_records(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="teacher_labeled")
    filtered_train_records = load_artifact_records(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="filtered_train")
    review_candidates_records = load_artifact_records(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="review_candidates")
    review_pool_blob = load_blob_artifact(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="labelstudio_import")
    train_export_metadata_blob = load_blob_artifact(
        tmp_path,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key="train_export_metadata",
    )
    review_rows = review_candidates_records

    review_results = []
    for row in review_rows:
        review_results.append(
            {
                **row,
                "review_decision": "accepted",
                "reviewer_label": row["teacher_label"],
                "review_comment": "",
                "reviewed_by": "smoke-test",
                "reviewed_at": "2026-03-27T00:00:00+00:00",
            }
        )
    if review_rows:
        first_row = review_rows[0]
        final_label = next(
            label for label in ("chat", "rewrite_report", "regenerate_report") if label != first_row["teacher_label"]
        )
        review_results.append(
            {
                **first_row,
                "review_decision": "corrected",
                "reviewer_label": final_label,
                "review_comment": "apply final correction",
                "reviewed_by": "smoke-test-2",
                "reviewed_at": "2026-03-27T00:05:00+00:00",
            }
        )
    save_review_records(
        tmp_path,
        task_name=run.name,
        task_root=run.task_root,
        run_id=run.run_id,
        records=review_results,
    )

    review_validation = validate_review.run(run)
    build_gold_outputs = build_gold.run(run)
    eval_outputs = eval_pipeline.run(run)
    stored_review_records = load_review_records(tmp_path, task_name=run.name, run_id=run.run_id)
    gold_eval_records = load_artifact_records(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="gold_eval")
    hard_cases_records = load_artifact_records(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="hard_cases")
    hard_cases_metadata_blob = load_blob_artifact(
        tmp_path,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key="hard_cases_metadata",
    )
    eval_predictions_records = load_artifact_records(
        tmp_path,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key="eval_predictions",
    )
    eval_result_blob = load_blob_artifact(
        tmp_path,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key="eval_result",
    )
    eval_export_metadata_blob = load_blob_artifact(
        tmp_path,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key="eval_export_metadata",
    )
    training_metadata_blob = load_blob_artifact(
        tmp_path,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key="training_metadata",
    )

    assert Path(outputs["train_export"]).exists()
    assert raw_candidates_records
    assert teacher_labeled_records
    assert filtered_train_records
    assert review_candidates_records
    assert review_pool_blob is not None
    assert train_export_metadata_blob is not None
    assert Path(student_outputs["student_train"]).exists()
    assert Path(review_validation["review_validation_report"]).exists()
    assert Path(eval_outputs["eval_export"]).exists()
    assert Path(eval_outputs["eval_summary"]).exists()
    assert Path(eval_outputs["promptfoo_config"]).exists()
    assert Path(eval_outputs["promptfoo_results"]).exists()
    assert stored_review_records
    assert gold_eval_records
    assert hard_cases_records == load_artifact_records(tmp_path, task_name=run.name, run_id=run.run_id, artifact_key="hard_cases")
    assert hard_cases_metadata_blob is not None
    assert eval_predictions_records
    assert eval_result_blob is not None
    assert eval_export_metadata_blob is not None
    assert training_metadata_blob is not None
    assert gold_eval_records
    assert len({sample["id"] for sample in gold_eval_records}) == len(gold_eval_records)
    assert eval_result_blob["dataset"]["sample_count"] == len(gold_eval_records)
    assert eval_result_blob["version"]["dataset_name"] == "eval-export"
    assert train_export_metadata_blob["dataset_name"] == "train-export-audit"
    assert train_export_metadata_blob["artifact_role"] == "audit_export"
    assert train_export_metadata_blob["is_final_sft_dataset"] is False
    assert train_export_metadata_blob["recommended_training_artifact"].endswith("training/student_train.jsonl")
    assert training_metadata_blob["dataset_name"] == "student-train"
    assert training_metadata_blob["artifact_role"] == "final_sft_dataset"
    assert training_metadata_blob["is_final_sft_dataset"] is True
    assert training_metadata_blob["canonical_dataset_path"].endswith("processed/filtered_train.jsonl")
    assert hard_cases_metadata_blob["dataset_name"] == "hard-cases"
    run_row = get_run(tmp_path, task_name=run.name, run_id=run.run_id)
    stages = list_run_stages(tmp_path, task_name=run.name, run_id=run.run_id)
    assert run_row["status"] == "evaluated"
    assert stages["eval"]["summary"]["sample_count"] == len(gold_eval_records)
    assert stages["eval"]["summary"]["promptfoo_status"] == "ok"
    for sample in hard_cases_records:
        assert sample["metadata"]["hard_case_reason"]
        assert sample["metadata"]["hard_case_recorded_at"]
    if review_rows:
        target_sample = next(sample for sample in gold_eval_records if sample["id"] == review_rows[0]["sample_id"])
        assert target_sample["annotation"]["final_label"] == final_label
        assert len(target_sample["annotation"]["review_history"]) == 2
