from pathlib import Path

from dataforge.core.io import read_json, read_jsonl, write_json, write_jsonl
from dataforge.core.registry import create_task_run, load_task_config
from dataforge.pipelines import build_gold, classify, eval as eval_pipeline, filter_export, generate, review_export, student_export, validate_review


def test_pipeline_smoke(tmp_path: Path, monkeypatch) -> None:
    project_root = Path(".")
    task = load_task_config(project_root, "report-intent-distill")
    task.task_root = tmp_path / "report-intent-distill"
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
    review_rows = read_jsonl(review_export_path)

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
    write_jsonl(run.path_for("review_results"), review_results)

    review_validation = validate_review.run(run)
    build_gold_outputs = build_gold.run(run)
    eval_outputs = eval_pipeline.run(run)
    gold_samples = read_jsonl(run.path_for("gold_eval"))
    hard_cases = read_jsonl(run.path_for("hard_cases"))

    assert Path(outputs["filtered_train"]).exists()
    assert Path(outputs["train_export"]).exists()
    assert Path(outputs["train_export_metadata"]).exists()
    assert Path(student_outputs["student_train"]).exists()
    assert Path(student_outputs["training_metadata"]).exists()
    assert run.path_for("gold_eval").exists()
    assert Path(build_gold_outputs["hard_cases_metadata"]).exists()
    assert Path(eval_outputs["eval_export_metadata"]).exists()
    assert Path(review_validation["review_validation_report"]).exists()
    assert Path(eval_outputs["eval_export"]).exists()
    assert Path(eval_outputs["eval_summary"]).exists()
    assert Path(eval_outputs["eval_result"]).exists()
    assert Path(eval_outputs["promptfoo_config"]).exists()
    assert Path(eval_outputs["promptfoo_results"]).exists()
    assert gold_samples
    assert len({sample["id"] for sample in gold_samples}) == len(gold_samples)
    eval_result = read_json(run.path_for("eval_result"))
    train_export_metadata = read_json(run.path_for("train_export_metadata"))
    hard_cases_metadata = read_json(run.path_for("hard_cases_metadata"))
    index_payload = read_json(run.index_path)
    run_entry = next(entry for entry in index_payload["runs"] if entry["run_id"] == run.run_id)
    assert eval_result["dataset"]["sample_count"] == len(gold_samples)
    assert eval_result["version"]["dataset_name"] == "eval-export"
    assert train_export_metadata["dataset_name"] == "train-export"
    assert hard_cases_metadata["dataset_name"] == "hard-cases"
    assert run_entry["stages"]["eval"]["summary"]["sample_count"] == len(gold_samples)
    assert run_entry["stages"]["eval"]["summary"]["promptfoo_status"] == "ok"
    for sample in hard_cases:
        assert sample["metadata"]["hard_case_reason"]
        assert sample["metadata"]["hard_case_recorded_at"]
    if review_rows:
        target_sample = next(sample for sample in gold_samples if sample["id"] == review_rows[0]["sample_id"])
        assert target_sample["annotation"]["final_label"] == final_label
        assert len(target_sample["annotation"]["review_history"]) == 2
