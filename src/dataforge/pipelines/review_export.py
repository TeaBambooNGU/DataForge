from __future__ import annotations

import logging
from pathlib import Path

from dataforge.core.io import write_run_manifest
from dataforge.core.logging_config import task_run_context
from dataforge.core.registry import TaskRun
from dataforge.core.review import build_review_record
from dataforge.core.storage import load_blob_artifact, save_artifact_records


logger = logging.getLogger(__name__)


def run(task: TaskRun, *, review_source: Path | None = None) -> Path:
    logger.info("Review export stage started", extra=task_run_context(task, "pipeline.review_export", "start"))
    source = review_source or task.path_for("labelstudio_import")
    review_rows = load_blob_artifact(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="labelstudio_import",
    ) or []
    if not review_rows:
        logger.warning(
            "Review export stage has no review pool rows",
            extra=task_run_context(
                task,
                "pipeline.review_export",
                "degrade",
                error_code="REVIEW_EXPORT_NO_ROWS",
                input_path=source,
            ),
        )
    review_template = [build_review_record(row) for row in review_rows]
    target = task.path_for("review_candidates")
    save_artifact_records(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="review_candidates",
        records=review_template,
    )
    manifest_path = task.path_for("review_export_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="review_export",
        runtime={},
        input_paths=[str(source)],
        output_paths=[str(target)],
        stats={"review_candidates": len(review_template)},
        run_id=task.run_id,
    )
    task.record_stage("review_export", manifest, manifest_path)
    logger.info(
        "Review export stage completed",
        extra=task_run_context(
            task,
            "pipeline.review_export",
            "end",
            review_rows=len(review_rows),
            review_candidates=len(review_template),
            output_path=target,
        ),
    )
    return target
