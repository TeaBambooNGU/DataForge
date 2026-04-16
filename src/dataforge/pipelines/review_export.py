from __future__ import annotations

from pathlib import Path

from dataforge.core.io import write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.review import build_review_record
from dataforge.core.storage import load_blob_artifact, save_artifact_records


def run(task: TaskRun, *, review_source: Path | None = None) -> Path:
    source = review_source or task.path_for("labelstudio_import")
    review_rows = load_blob_artifact(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="labelstudio_import",
    ) or []
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
    return target
