from __future__ import annotations

from pathlib import Path

from dataforge.core.io import read_json, write_jsonl, write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.review import build_review_record


def run(task: TaskRun, *, review_source: Path | None = None) -> Path:
    source = review_source or task.path_for("labelstudio_import")
    review_rows = read_json(source)
    review_template = [build_review_record(row) for row in review_rows]
    target = task.path_for("review_candidates")
    write_jsonl(target, review_template)
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
