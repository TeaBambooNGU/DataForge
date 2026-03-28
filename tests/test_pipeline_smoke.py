from pathlib import Path

from dataforge.core.io import read_jsonl, write_jsonl
from dataforge.core.registry import create_task_run, load_task_config
from dataforge.pipelines import build_gold, classify, eval as eval_pipeline, filter_export, generate, review_export, validate_review


def test_pipeline_smoke(tmp_path: Path) -> None:
    project_root = Path(".")
    task = load_task_config(project_root, "report-intent-distill")
    task.task_root = tmp_path / "report-intent-distill"
    task.config["runtime"]["generator"]["provider"] = "mock"
    task.config["runtime"]["teacher"]["provider"] = "mock"
    task.config["runtime"]["eval"]["provider"] = "mock"
    run = create_task_run(task, "run-smoke-001")

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
    write_jsonl(run.path_for("review_results"), review_results)

    review_validation = validate_review.run(run)
    build_gold.run(run)
    eval_outputs = eval_pipeline.run(run)

    assert Path(outputs["filtered_train"]).exists()
    assert run.path_for("gold_eval").exists()
    assert Path(review_validation["review_validation_report"]).exists()
    assert Path(eval_outputs["eval_summary"]).exists()
    assert read_jsonl(run.path_for("gold_eval"))
