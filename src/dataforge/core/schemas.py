from __future__ import annotations

from typing import Any


STAGES = {"candidate", "classified", "reviewed", "gold"}
REVIEW_STATUSES = {"unreviewed", "accepted", "corrected", "rejected", "gold_frozen"}


class SchemaValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SchemaValidationError(message)


def validate_sample(sample: dict[str, Any]) -> None:
    for field in ("id", "task_name", "theme", "stage", "context", "input", "metadata"):
        _require(field in sample, f"Missing required field: {field}")

    _require(sample["stage"] in STAGES, f"Unsupported stage: {sample['stage']}")

    input_block = sample["input"]
    metadata = sample["metadata"]
    _require(bool(input_block.get("user_text")), "input.user_text is required")
    for field in ("source", "difficulty", "tags"):
        _require(field in metadata, f"metadata.{field} is required")

    stage = sample["stage"]
    annotation = sample.get("annotation", {})

    if stage == "candidate":
        return

    _require("parse_ok" in annotation, "annotation.parse_ok is required")
    _require("teacher_raw_output" in annotation, "annotation.teacher_raw_output is required")

    if annotation["parse_ok"]:
        _require(bool(annotation.get("teacher_label")), "annotation.teacher_label is required when parse_ok=true")
    else:
        _require(annotation.get("teacher_label") in (None, ""), "annotation.teacher_label must be null when parse_ok=false")
        _require(bool(annotation.get("error_code")), "annotation.error_code is required when parse_ok=false")

    if stage == "classified":
        return

    review_status = annotation.get("review_status")
    human_label = annotation.get("human_label")
    _require(review_status in REVIEW_STATUSES, "annotation.review_status is invalid")
    _require(human_label is not None, "annotation.human_label is required for reviewed/gold stages")

    if review_status == "accepted":
        _require(
            human_label == annotation.get("teacher_label"),
            "annotation.human_label must equal teacher_label when review_status=accepted",
        )

    if stage == "reviewed":
        return

    _require(bool(annotation.get("final_label")), "annotation.final_label is required for gold stage")


def validate_samples(samples: list[dict[str, Any]]) -> None:
    for sample in samples:
        validate_sample(sample)
