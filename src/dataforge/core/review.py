from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dataforge.core.io import write_text


REVIEW_DECISIONS = {"pending", "accepted", "corrected", "rejected"}


class ReviewValidationError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ReviewValidationError(message)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_review_record(sample: dict[str, Any]) -> dict[str, Any]:
    annotation = sample["annotation"]
    return {
        "sample_id": sample["id"],
        "task_name": sample["task_name"],
        "user_text": sample["input"]["user_text"],
        "teacher_label": annotation["teacher_label"],
        "review_decision": "pending",
        "reviewer_label": None,
        "review_comment": "",
        "reviewed_by": None,
        "reviewed_at": None,
        "context": sample["context"],
        "tags": sample.get("metadata", {}).get("tags", []),
    }


def validate_review_record(record: dict[str, Any]) -> None:
    for field in ("sample_id", "task_name", "user_text", "teacher_label", "review_decision"):
        _require(field in record, f"Missing required review field: {field}")

    decision = record["review_decision"]
    _require(decision in REVIEW_DECISIONS, f"Unsupported review_decision: {decision}")

    if decision == "accepted":
        _require(
            record.get("reviewer_label") == record.get("teacher_label"),
            "reviewer_label must equal teacher_label when review_decision=accepted",
        )
    if decision == "corrected":
        _require(bool(record.get("reviewer_label")), "reviewer_label is required when review_decision=corrected")
    if decision == "rejected":
        _require(
            bool(record.get("review_comment")),
            "review_comment is required when review_decision=rejected",
        )


def validate_review_records(records: list[dict[str, Any]]) -> None:
    for record in records:
        validate_review_record(record)


def summarize_review_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    decisions = {decision: 0 for decision in REVIEW_DECISIONS}
    reviewed_by: dict[str, int] = {}
    for record in records:
        decision = record["review_decision"]
        decisions[decision] = decisions.get(decision, 0) + 1
        reviewer = record.get("reviewed_by")
        if reviewer:
            reviewed_by[reviewer] = reviewed_by.get(reviewer, 0) + 1

    total = len(records)
    completed = decisions.get("accepted", 0) + decisions.get("corrected", 0) + decisions.get("rejected", 0)
    pending = decisions.get("pending", 0)
    acceptance_rate = 0.0 if total == 0 else round(decisions.get("accepted", 0) / total, 4)
    completion_rate = 0.0 if total == 0 else round(completed / total, 4)
    return {
        "total": total,
        "pending": pending,
        "accepted": decisions.get("accepted", 0),
        "corrected": decisions.get("corrected", 0),
        "rejected": decisions.get("rejected", 0),
        "completion_rate": completion_rate,
        "acceptance_rate": acceptance_rate,
        "reviewed_by": reviewed_by,
    }


def write_review_validation_report(path: Path, summary: dict[str, Any]) -> None:
    lines = [
        "# Review Validation",
        "",
        f"- Total records: {summary['total']}",
        f"- Pending: {summary['pending']}",
        f"- Accepted: {summary['accepted']}",
        f"- Corrected: {summary['corrected']}",
        f"- Rejected: {summary['rejected']}",
        f"- Completion rate: {summary['completion_rate']:.4f}",
        f"- Acceptance rate: {summary['acceptance_rate']:.4f}",
    ]
    if summary["reviewed_by"]:
        lines.append("")
        lines.append("## Reviewed By")
        for reviewer, count in sorted(summary["reviewed_by"].items()):
            lines.append(f"- {reviewer}: {count}")
    write_text(path, "\n".join(lines) + "\n")


def apply_review_record(sample: dict[str, Any], review_record: dict[str, Any]) -> dict[str, Any]:
    decision = review_record["review_decision"]
    review_status = sample.get("annotation", {}).get("review_status", "unreviewed")
    human_label = sample.get("annotation", {}).get("human_label")
    if decision == "accepted":
        review_status = "accepted"
        human_label = sample["annotation"]["teacher_label"]
    elif decision == "corrected":
        review_status = "corrected"
        human_label = review_record["reviewer_label"]
    elif decision == "rejected":
        review_status = "rejected"
        human_label = None

    review_history = list(sample.get("annotation", {}).get("review_history", []))
    review_history.append(
        {
            "decision": decision,
            "reviewer_label": review_record.get("reviewer_label"),
            "review_comment": review_record.get("review_comment", ""),
            "reviewed_by": review_record.get("reviewed_by"),
            "reviewed_at": review_record.get("reviewed_at") or utc_now(),
        }
    )

    return {
        **sample,
        "stage": "reviewed" if review_status != "unreviewed" else sample.get("stage", "classified"),
        "annotation": {
            **sample["annotation"],
            "review_status": review_status,
            "human_label": human_label,
            "review_history": review_history,
        },
    }


def merge_review_records(sample: dict[str, Any], review_records: list[dict[str, Any]]) -> dict[str, Any]:
    merged = sample
    for review_record in review_records:
        merged = apply_review_record(merged, review_record)
    return merged


def group_review_records(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        grouped.setdefault(record["sample_id"], []).append(record)
    return grouped
