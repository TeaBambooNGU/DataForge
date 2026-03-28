from __future__ import annotations

from pathlib import Path

from dataforge.core.dedupe import dedupe_samples
from dataforge.core.filters import filter_classified_samples
from dataforge.core.io import read_jsonl, read_yaml, write_json, write_jsonl, write_run_manifest
from dataforge.core.registry import TaskRun


def run(task: TaskRun, *, input_path: Path | None = None) -> dict[str, Path]:
    source = input_path or task.path_for("teacher_labeled")
    classified = read_jsonl(source)
    labels = set(read_yaml(task.path_for("labels"))["labels"])

    filtered = filter_classified_samples(
        dedupe_samples(classified),
        allowed_labels=labels,
        task_rules=task.rules,
    )
    review_ids = {sample["id"] for sample in filtered.review_pool}
    train_samples = [sample for sample in filtered.kept if sample["id"] not in review_ids]

    filtered_train_path = task.path_for("filtered_train")
    review_json_path = task.path_for("labelstudio_import")
    rejected_path = task.path_for("rejected_samples")
    promptfoo_eval_path = task.path_for("eval_for_promptfoo")

    write_jsonl(filtered_train_path, train_samples)
    write_json(review_json_path, filtered.review_pool)
    write_jsonl(rejected_path, filtered.rejected)
    write_jsonl(promptfoo_eval_path, [])

    manifest_path = task.path_for("filter_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="filter_export",
        runtime={},
        input_paths=[str(source)],
        output_paths=[
            str(filtered_train_path),
            str(review_json_path),
            str(rejected_path),
            str(promptfoo_eval_path),
        ],
        stats={
            "kept": len(filtered.kept),
            "rejected": len(filtered.rejected),
            "review_pool": len(filtered.review_pool),
            "train_samples": len(train_samples),
        },
        run_id=task.run_id,
    )
    task.record_stage("filter_export", manifest, manifest_path)
    return {
        "filtered_train": filtered_train_path,
        "review_import": review_json_path,
        "rejected": rejected_path,
        "eval_for_promptfoo": promptfoo_eval_path,
    }
