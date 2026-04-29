from __future__ import annotations

import logging
from pathlib import Path

from dataforge.core.io import write_run_manifest
from dataforge.core.logging_config import task_run_context
from dataforge.core.registry import TaskRun
from dataforge.core.review import summarize_review_records, validate_review_records, write_review_validation_report
from dataforge.core.storage import load_review_records


logger = logging.getLogger(__name__)


def run(task: TaskRun, *, review_results_path: Path | None = None) -> dict[str, Path]:
    logger.info("Validate review stage started", extra=task_run_context(task, "pipeline.validate_review", "start"))
    source = review_results_path or task.path_for("review_results")
    review_records = load_review_records(task.project_root, task_name=task.name, run_id=task.run_id)
    if not review_records:
        logger.warning(
            "Validate review stage has no review records",
            extra=task_run_context(
                task,
                "pipeline.validate_review",
                "degrade",
                error_code="VALIDATE_REVIEW_NO_RECORDS",
                input_path=source,
            ),
        )
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
    logger.info(
        "Validate review stage completed",
        extra=task_run_context(
            task,
            "pipeline.validate_review",
            "end",
            review_records=len(review_records),
            accepted=summary.get("accepted", 0),
            corrected=summary.get("corrected", 0),
            rejected=summary.get("rejected", 0),
            output_path=report_path,
        ),
    )
    return {
        "review_validation_report": report_path,
        "review_validate_manifest": manifest_path,
    }
