from __future__ import annotations

from pathlib import Path

from dataforge.core.dedupe import dedupe_samples, exclude_historical_leakage
from dataforge.core.exporters import export_train_dataset
from dataforge.core.filters import filter_classified_samples
from dataforge.core.io import read_yaml, write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.storage import load_artifact_records, save_artifact_records, save_blob_artifact
from dataforge.core.versioning import build_dataset_version_summary


def run(task: TaskRun, *, input_path: Path | None = None) -> dict[str, Path]:
    source = input_path or task.path_for("teacher_labeled")
    classified = load_artifact_records(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="teacher_labeled",
    )
    labels = set(read_yaml(task.path_for("labels"))["labels"])

    filtered = filter_classified_samples(
        dedupe_samples(classified),
        allowed_labels=labels,
        task_rules=task.rules,
    )
    review_ids = {sample["id"] for sample in filtered.review_pool}
    train_samples = [sample for sample in filtered.kept if sample["id"] not in review_ids]
    historical_leakage = exclude_historical_leakage(task, train_samples)
    train_samples = historical_leakage.kept

    filtered_train_path = task.path_for("filtered_train")
    train_export_path = task.path_for("train_export")
    train_export_metadata_path = task.path_for("train_export_metadata")
    review_json_path = task.path_for("labelstudio_import")
    rejected_path = task.path_for("rejected_samples")
    promptfoo_eval_path = task.path_for("eval_for_promptfoo")

    rejected_rows = [*filtered.rejected, *historical_leakage.blocked]
    save_artifact_records(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="filtered_train",
        records=train_samples,
    )
    save_artifact_records(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="rejected_samples",
        records=rejected_rows,
    )
    save_blob_artifact(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="labelstudio_import",
        payload=filtered.review_pool,
    )
    train_export_summary = export_train_dataset(
        train_export_path,
        train_samples,
        task.exports.get("train_format"),
        system_prompt=task.exports.get("sft_system_prompt"),
    )
    train_version_summary = build_dataset_version_summary(
        task_name=task.name,
        run_id=task.run_id,
        dataset_name="train-export-audit",
        format_name=train_export_summary["format"],
        sample_count=train_export_summary["sample_count"],
        source_paths=[str(source)],
        extra={
            "artifact_role": "audit_export",
            "is_final_sft_dataset": False,
            "canonical_dataset_path": str(filtered_train_path),
            "recommended_training_artifact": str(task.path_for("student_train")),
            "historical_leakage": historical_leakage.summary,
            "note": "此文件用于审计和通用导出检查；最终可直接微调的交付物由 student-export 生成。",
        },
    )
    save_blob_artifact(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="train_export_metadata",
        payload=train_version_summary,
    )

    manifest_path = task.path_for("filter_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="filter_export",
        runtime={},
        input_paths=[str(source)],
        output_paths=[
            str(filtered_train_path),
            str(train_export_path),
            str(train_export_metadata_path),
            str(review_json_path),
            str(rejected_path),
            str(promptfoo_eval_path),
        ],
        stats={
            "kept": len(filtered.kept),
            "rejected": len(filtered.rejected),
            "review_pool": len(filtered.review_pool),
            "train_samples": len(train_samples),
            "train_export_format": train_export_summary["format"],
            "train_export_role": "audit_export",
            "historical_leakage_blocked": historical_leakage.summary["blocked_count"],
        },
        summary={
            **train_export_summary,
            "train_export_role": "audit_export",
            "historical_leakage_blocked": historical_leakage.summary["blocked_count"],
        },
        details={"train_export": train_export_summary, "train_version": train_version_summary},
        run_id=task.run_id,
    )
    task.record_stage("filter_export", manifest, manifest_path)
    return {
        "filtered_train": filtered_train_path,
        "train_export": train_export_path,
        "train_export_metadata": train_export_metadata_path,
        "review_import": review_json_path,
        "rejected": rejected_path,
        "eval_for_promptfoo": promptfoo_eval_path,
    }
