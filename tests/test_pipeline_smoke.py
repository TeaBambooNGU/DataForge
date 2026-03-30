from pathlib import Path

from dataforge.core.io import write_json
from dataforge.core.io import read_jsonl, write_jsonl
from dataforge.core.registry import create_task_run, load_task_config
from dataforge.pipelines import build_gold, classify, eval as eval_pipeline, filter_export, generate, review_export, validate_review


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
    build_gold.run(run)
    eval_outputs = eval_pipeline.run(run)
    gold_samples = read_jsonl(run.path_for("gold_eval"))

    assert Path(outputs["filtered_train"]).exists()
    assert run.path_for("gold_eval").exists()
    assert Path(review_validation["review_validation_report"]).exists()
    assert Path(eval_outputs["eval_summary"]).exists()
    assert Path(eval_outputs["promptfoo_config"]).exists()
    assert Path(eval_outputs["promptfoo_results"]).exists()
    assert gold_samples
    assert len({sample["id"] for sample in gold_samples}) == len(gold_samples)
    if review_rows:
        target_sample = next(sample for sample in gold_samples if sample["id"] == review_rows[0]["sample_id"])
        assert target_sample["annotation"]["final_label"] == final_label
        assert len(target_sample["annotation"]["review_history"]) == 2
