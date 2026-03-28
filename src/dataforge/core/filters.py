from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FilterResult:
    kept: list[dict]
    rejected: list[dict]
    review_pool: list[dict]


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
            rejected.append(sample)
            continue
        if not parse_ok:
            rejected.append(sample)
            continue
        if label not in allowed_labels:
            rejected.append(sample)
            continue
        if len(user_text) < 2 or len(user_text) > 500:
            rejected.append(sample)
            continue
        if task_rules.get("disallow_rewrite_without_visible_report") and (
            not context.get("has_visible_report") and label == "rewrite_report"
        ):
            rejected.append(sample)
            continue

        kept.append(sample)
        if should_send_to_review(sample):
            review_pool.append(sample)

    return FilterResult(kept=kept, rejected=rejected, review_pool=review_pool)
