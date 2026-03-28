from __future__ import annotations


def dedupe_samples(samples: list[dict]) -> list[dict]:
    seen: set[tuple[str, bool | None, str | None]] = set()
    deduped: list[dict] = []
    for sample in samples:
        key = (
            sample.get("input", {}).get("user_text", "").strip().lower(),
            sample.get("context", {}).get("has_visible_report"),
            sample.get("annotation", {}).get("teacher_label"),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(sample)
    return deduped
