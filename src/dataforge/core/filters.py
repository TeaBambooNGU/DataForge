from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FilterResult:
    kept: list[dict]
    rejected: list[dict]
    review_pool: list[dict]


def reject_sample(sample: dict, reason: str) -> dict:
    rejected = dict(sample)
    rejected["rejection_reason"] = reason
    return rejected


def should_send_to_review(sample: dict) -> bool:
    tags = set(sample.get("metadata", {}).get("tags", []))
    difficulty = sample.get("metadata", {}).get("difficulty")
    return difficulty == "hard" or bool(tags & {"ambiguous", "multi_intent"})


def filter_classified_samples(
    samples: list[dict],
    *,
    allowed_labels: set[str],
    task_rules: dict,
) -> FilterResult:
    kept: list[dict] = []
    rejected: list[dict] = []
    review_pool: list[dict] = []

    for sample in samples:
        user_text = sample.get("input", {}).get("user_text", "").strip()
        annotation = sample.get("annotation", {})
        label = annotation.get("teacher_label")
        parse_ok = annotation.get("parse_ok", False)
        context = sample.get("context", {})

        if not user_text:
            rejected.append(reject_sample(sample, "empty_user_text"))
            continue
        if not parse_ok:
            rejected.append(reject_sample(sample, "parse_failed"))
            continue
        if label not in allowed_labels:
            rejected.append(reject_sample(sample, "label_not_allowed"))
            continue
        if len(user_text) < 2:
            rejected.append(reject_sample(sample, "text_too_short"))
            continue
        if len(user_text) > 500:
            rejected.append(reject_sample(sample, "text_too_long"))
            continue
        if task_rules.get("disallow_rewrite_without_visible_report") and (
            not context.get("has_visible_report") and label == "rewrite_report"
        ):
            rejected.append(reject_sample(sample, "rewrite_without_visible_report"))
            continue

        kept.append(sample)
        if should_send_to_review(sample):
            review_pool.append(sample)

    return FilterResult(kept=kept, rejected=rejected, review_pool=review_pool)
