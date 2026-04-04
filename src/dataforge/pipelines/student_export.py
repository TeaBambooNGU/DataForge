from __future__ import annotations

from pathlib import Path

from dataforge.core.exporters import export_train_dataset
from dataforge.core.io import read_jsonl, write_json, write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.versioning import build_dataset_version_summary


def run(task: TaskRun, *, input_path: Path | None = None) -> dict[str, Path]:
    source = input_path or task.path_for("filtered_train")
    samples = read_jsonl(source)
    student_train_path = task.path_for("student_train")
    training_metadata_path = task.path_for("training_metadata")
    student_format = task.exports.get("student_format") or task.exports.get("train_format") or "chatml_jsonl"
    student_export_summary = export_train_dataset(student_train_path, samples, student_format)
    training_metadata = build_dataset_version_summary(
        task_name=task.name,
        run_id=task.run_id,
        dataset_name="student-train",
        format_name=student_export_summary["format"],
        sample_count=student_export_summary["sample_count"],
        source_paths=[str(source)],
        extra={
            "source_artifact": str(source),
            "student_train_path": str(student_train_path),
            "includes_hard_cases": False,
            "note": "hard_cases 默认不回流训练；如需回流，必须产出新的训练版本并单独记录原因。",
        },
    )
    write_json(training_metadata_path, training_metadata)

    manifest_path = task.path_for("student_export_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="student_export",
        runtime={"student_format": student_export_summary["format"]},
        input_paths=[str(source)],
        output_paths=[str(student_train_path), str(training_metadata_path)],
        stats={
            "student_sample_count": student_export_summary["sample_count"],
            "student_format": student_export_summary["format"],
        },
        summary={
            "version_id": training_metadata["version_id"],
            "student_sample_count": training_metadata["sample_count"],
            "student_format": training_metadata["format"],
        },
        details=training_metadata,
        run_id=task.run_id,
    )
    task.record_stage("student_export", manifest, manifest_path)
    return {
        "student_train": student_train_path,
        "training_metadata": training_metadata_path,
    }
