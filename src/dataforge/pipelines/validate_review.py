from __future__ import annotations

from pathlib import Path

from dataforge.core.io import write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.review import summarize_review_records, validate_review_records, write_review_validation_report
from dataforge.core.storage import load_review_records


def run(task: TaskRun, *, review_results_path: Path | None = None) -> dict[str, Path]:
    source = review_results_path or task.path_for("review_results")
    review_records = load_review_records(task.project_root, task_name=task.name, run_id=task.run_id)
    validate_review_records(review_records)
    summary = summarize_review_records(review_records)

    report_path = task.path_for("review_validation_report")
    write_review_validation_report(report_path, summary)

    manifest_path = task.path_for("review_validate_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="validate_review",
        runtime={},
        input_paths=[str(source)],
        output_paths=[str(report_path)],
        stats=summary,
        run_id=task.run_id,
    )
    task.record_stage("validate_review", manifest, manifest_path)
    return {
        "review_validation_report": report_path,
        "review_validate_manifest": manifest_path,
    }
