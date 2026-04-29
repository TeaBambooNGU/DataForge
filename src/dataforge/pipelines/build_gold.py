from __future__ import annotations

import logging
from pathlib import Path

from dataforge.core.io import write_run_manifest
from dataforge.core.logging_config import task_run_context
from dataforge.core.registry import TaskRun
from dataforge.core.review import group_review_records, merge_review_records, validate_review_records
from dataforge.core.schemas import validate_samples
from dataforge.core.storage import load_artifact_records, load_review_records, save_artifact_records, save_blob_artifact
from dataforge.core.versioning import build_dataset_version_summary


logger = logging.getLogger(__name__)


def run(task: TaskRun, *, review_results_path: Path | None = None) -> dict[str, Path]:
    logger.info("Build gold stage started", extra=task_run_context(task, "pipeline.build_gold", "start"))
    source = review_results_path or task.path_for("review_results")
    review_records = load_review_records(task.project_root, task_name=task.name, run_id=task.run_id)
    if not review_records:
        logger.warning(
            "Build gold stage has no review records",
            extra=task_run_context(
                task,
                "pipeline.build_gold",
                "degrade",
                error_code="BUILD_GOLD_NO_REVIEWS",
                input_path=source,
            ),
        )
    validate_review_records(review_records)
    classified_samples = load_artifact_records(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="teacher_labeled",
    )
    sample_map = {sample["id"]: sample for sample in classified_samples}
    gold_samples = []
    hard_cases = []
    grouped_reviews = group_review_records(review_records)

    for sample_id, records in grouped_reviews.items():
        sample = sample_map.get(sample_id)
        if sample is None:
            logger.error(
                "Build gold found a review for an unknown sample",
                extra=task_run_context(
                    task,
                    "pipeline.build_gold",
                    "error",
                    error_code="BUILD_GOLD_UNKNOWN_SAMPLE",
                    sample_id=sample_id,
                ),
            )
            raise ValueError(f"Review sample_id not found in teacher_labeled set: {sample_id}")

        reviewed_sample = merge_review_records(sample, records)
        review_status = reviewed_sample["annotation"]["review_status"]
        if review_status not in {"accepted", "corrected"}:
            continue
        final_label = reviewed_sample["annotation"]["human_label"]
        gold_sample = {
            **reviewed_sample,
            "stage": "gold",
            "annotation": {
                **reviewed_sample["annotation"],
                "review_status": "gold_frozen",
                "final_label": final_label,
            },
        }
        gold_samples.append(gold_sample)
        tags = set(reviewed_sample.get("metadata", {}).get("tags", []))
        hard_case_reasons = []
        if reviewed_sample.get("metadata", {}).get("difficulty") == "hard":
            hard_case_reasons.append("difficulty_hard")
        if "ambiguous" in tags:
            hard_case_reasons.append("tag_ambiguous")
        if "multi_intent" in tags:
            hard_case_reasons.append("tag_multi_intent")
        if reviewed_sample["annotation"]["review_status"] == "corrected":
            hard_case_reasons.append("human_corrected")
        if hard_case_reasons:
            hard_cases.append(
                {
                    **gold_sample,
                    "metadata": {
                        **gold_sample.get("metadata", {}),
                        "hard_case_reason": hard_case_reasons,
                        "hard_case_recorded_at": gold_sample["annotation"].get("review_history", [{}])[-1].get("reviewed_at"),
                    },
                }
            )

    if not gold_samples:
        logger.warning(
            "Build gold produced no gold samples",
            extra=task_run_context(
                task,
                "pipeline.build_gold",
                "degrade",
                error_code="BUILD_GOLD_NO_SAMPLES",
                review_records=len(review_records),
            ),
        )

    validate_samples(gold_samples)
    gold_path = task.path_for("gold_eval")
    hard_cases_path = task.path_for("hard_cases")
    hard_cases_metadata_path = task.path_for("hard_cases_metadata")
    save_artifact_records(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="gold_eval",
        records=gold_samples,
    )
    save_artifact_records(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="hard_cases",
        records=hard_cases,
    )
    hard_cases_version = build_dataset_version_summary(
        task_name=task.name,
        run_id=task.run_id,
        dataset_name="hard-cases",
        format_name="gold_jsonl",
        sample_count=len(hard_cases),
        source_paths=[str(source), str(gold_path)],
        extra={
            "reflow_date": task.run_id,
            "source_reason_breakdown": {
                "human_corrected": sum(
                    1 for sample in hard_cases if "human_corrected" in sample.get("metadata", {}).get("hard_case_reason", [])
                ),
                "tag_ambiguous": sum(
                    1 for sample in hard_cases if "tag_ambiguous" in sample.get("metadata", {}).get("hard_case_reason", [])
                ),
                "tag_multi_intent": sum(
                    1 for sample in hard_cases if "tag_multi_intent" in sample.get("metadata", {}).get("hard_case_reason", [])
                ),
                "difficulty_hard": sum(
                    1 for sample in hard_cases if "difficulty_hard" in sample.get("metadata", {}).get("hard_case_reason", [])
                ),
            },
        },
    )
    save_blob_artifact(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="hard_cases_metadata",
        payload=hard_cases_version,
    )
    manifest_path = task.path_for("build_gold_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="build_gold",
        runtime={},
        input_paths=[str(source)],
        output_paths=[str(gold_path), str(hard_cases_path), str(hard_cases_metadata_path)],
        stats={"gold_samples": len(gold_samples), "hard_cases": len(hard_cases)},
        details={"hard_cases_version": hard_cases_version},
        run_id=task.run_id,
    )
    task.record_stage("build_gold", manifest, manifest_path)
    logger.info(
        "Build gold stage completed",
        extra=task_run_context(
            task,
            "pipeline.build_gold",
            "end",
            review_records=len(review_records),
            gold_samples=len(gold_samples),
            hard_cases=len(hard_cases),
        ),
    )
    return {"gold_eval": gold_path, "hard_cases": hard_cases_path, "hard_cases_metadata": hard_cases_metadata_path}
