from __future__ import annotations
from pathlib import Path

from dataforge.core.io import write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.schemas import validate_samples
from dataforge.core.storage import load_artifact_records, save_artifact_records
from dataforge.providers import get_teacher_provider


def run(task: TaskRun, *, input_path: Path | None = None, output_path: Path | None = None) -> Path:
    source = input_path or task.path_for("raw_candidates")
    samples = load_artifact_records(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="raw_candidates",
    )
    classified = []
    parse_failures = 0
    provider = get_teacher_provider(task.runtime.get("teacher", {}).get("provider", "mock"))

    for sample in samples:
        parse_ok, label, raw_output, error_code = provider.classify_sample(task, sample)
        classified.append(
            {
                **sample,
                "stage": "classified",
                "annotation": {
                    "teacher_label": label,
                    "teacher_raw_output": raw_output,
                    "parse_ok": parse_ok,
                    "error_code": error_code,
                    "human_label": None,
                    "review_status": "unreviewed",
                    "final_label": None,
                },
            }
        )
        if not parse_ok:
            parse_failures += 1

    validate_samples(classified)
    target = output_path or task.path_for("teacher_labeled")
    save_artifact_records(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="teacher_labeled",
        records=classified,
    )
    manifest_path = task.path_for("classify_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="classify",
        runtime=task.runtime.get("teacher", {}),
        input_paths=[str(source)],
        output_paths=[str(target)],
        stats={"classified_samples": len(classified), "parse_failures": parse_failures},
        run_id=task.run_id,
    )
    task.record_stage("classify", manifest, manifest_path)
    return target
