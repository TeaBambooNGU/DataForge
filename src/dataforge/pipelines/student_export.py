from __future__ import annotations

import logging
from pathlib import Path

from dataforge.core.exporters import export_train_dataset
from dataforge.core.io import write_run_manifest
from dataforge.core.logging_config import task_run_context
from dataforge.core.registry import TaskRun
from dataforge.core.storage import load_artifact_records, save_blob_artifact
from dataforge.core.versioning import build_dataset_version_summary


logger = logging.getLogger(__name__)


def run(task: TaskRun, *, input_path: Path | None = None) -> dict[str, Path]:
    logger.info("Student export stage started", extra=task_run_context(task, "pipeline.student_export", "start"))
    source = input_path or task.path_for("filtered_train")
    samples = load_artifact_records(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="filtered_train",
    )
    if not samples:
        logger.warning(
            "Student export stage has no train samples",
            extra=task_run_context(
                task,
                "pipeline.student_export",
                "degrade",
                error_code="STUDENT_EXPORT_NO_SAMPLES",
                input_path=source,
            ),
        )
    student_train_path = task.path_for("student_train")
    training_metadata_path = task.path_for("training_metadata")
    student_format = task.exports.get("student_format") or task.exports.get("train_format") or "chatml_jsonl"
    system_prompt = task.exports.get("sft_system_prompt")
    student_export_summary = export_train_dataset(
        student_train_path,
        samples,
        student_format,
        system_prompt=system_prompt,
    )
    training_metadata = build_dataset_version_summary(
        task_name=task.name,
        run_id=task.run_id,
        dataset_name="student-train",
        format_name=student_export_summary["format"],
        sample_count=student_export_summary["sample_count"],
        source_paths=[str(source)],
        extra={
            "artifact_role": "final_sft_dataset",
            "is_final_sft_dataset": True,
            "canonical_dataset_path": str(source),
            "source_artifact": "filtered_train",
            "student_train_path": str(student_train_path),
            "has_system_prompt": bool((system_prompt or "").strip()),
            "includes_hard_cases": False,
            "note": "hard_cases 默认不回流训练；如需回流，必须产出新的训练版本并单独记录原因。",
        },
    )
    save_blob_artifact(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="training_metadata",
        payload=training_metadata,
    )

    manifest_path = task.path_for("student_export_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="student_export",
        runtime={"student_format": student_export_summary["format"], "sft_system_prompt": bool((system_prompt or "").strip())},
        input_paths=[str(source)],
        output_paths=[str(student_train_path), str(training_metadata_path)],
        stats={
            "student_sample_count": student_export_summary["sample_count"],
            "student_format": student_export_summary["format"],
            "artifact_role": "final_sft_dataset",
            "has_sft_system_prompt": bool((system_prompt or "").strip()),
        },
        summary={
            "version_id": training_metadata["version_id"],
            "student_sample_count": training_metadata["sample_count"],
            "student_format": training_metadata["format"],
            "artifact_role": "final_sft_dataset",
            "has_sft_system_prompt": bool((system_prompt or "").strip()),
        },
        details=training_metadata,
        run_id=task.run_id,
    )
    task.record_stage("student_export", manifest, manifest_path)
    logger.info(
        "Student export stage completed",
        extra=task_run_context(
            task,
            "pipeline.student_export",
            "end",
            samples=len(samples),
            student_format=student_export_summary["format"],
            has_sft_system_prompt=bool((system_prompt or "").strip()),
            output_path=student_train_path,
        ),
    )
    return {
        "student_train": student_train_path,
        "training_metadata": training_metadata_path,
    }
