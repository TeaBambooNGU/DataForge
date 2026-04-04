from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from dataforge.core.io import read_json, read_jsonl


def _content_key(*, text: str, has_visible_report: bool | None, label: str | None) -> tuple[str, bool | None, str | None]:
    return (text.strip().lower(), has_visible_report, label)


def sample_identity(sample: dict[str, Any]) -> tuple[str | None, tuple[str, bool | None, str | None]]:
    annotation = sample.get("annotation", {})
    label = annotation.get("teacher_label") or annotation.get("final_label") or annotation.get("human_label")
    return (
        sample.get("id"),
        _content_key(
            text=sample.get("input", {}).get("user_text", ""),
            has_visible_report=sample.get("context", {}).get("has_visible_report"),
            label=label,
        ),
    )


def eval_identity(row: dict[str, Any]) -> tuple[str | None, tuple[str, bool | None, str | None]]:
    return (
        row.get("id"),
        _content_key(
            text=row.get("user_text", ""),
            has_visible_report=row.get("has_visible_report"),
            label=row.get("expected_label"),
        ),
    )


@dataclass
class HistoricalLeakageResult:
    kept: list[dict[str, Any]]
    blocked: list[dict[str, Any]]
    summary: dict[str, Any]


def dedupe_samples(samples: list[dict]) -> list[dict]:
    seen: set[tuple[str, bool | None, str | None]] = set()
    deduped: list[dict] = []
    for sample in samples:
        _, key = sample_identity(sample)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(sample)
    return deduped


def exclude_historical_leakage(task, samples: list[dict[str, Any]]) -> HistoricalLeakageResult:
    if not task.index_path.exists():
        return HistoricalLeakageResult(
            kept=samples,
            blocked=[],
            summary={"blocked_count": 0, "source_counts": {}, "match_type_counts": {}},
        )

    index = read_json(task.index_path)
    historical_ids: dict[str, set[str]] = {}
    historical_keys: dict[tuple[str, bool | None, str | None], set[str]] = {}
    source_counts: dict[str, int] = {}

    def register(sample_id: str | None, key: tuple[str, bool | None, str | None], source_name: str) -> None:
        source_counts[source_name] = source_counts.get(source_name, 0) + 1
        if sample_id:
            historical_ids.setdefault(sample_id, set()).add(source_name)
        historical_keys.setdefault(key, set()).add(source_name)

    for entry in index.get("runs", []):
        run_id = entry.get("run_id")
        if run_id == task.run_id:
            continue
        run_root = task.runs_root / run_id
        for source_name, relative_path in (
            ("gold_eval", "gold/gold_eval.jsonl"),
            ("hard_cases", "gold/hard_cases.jsonl"),
            ("eval_predictions", "exports/eval_predictions.jsonl"),
        ):
            path = run_root / relative_path
            if not path.exists():
                continue
            rows = read_jsonl(path)
            for row in rows:
                if source_name == "eval_predictions":
                    sample_id, key = eval_identity(row)
                else:
                    sample_id, key = sample_identity(row)
                register(sample_id, key, source_name)

    kept: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    blocked_source_counts: dict[str, int] = {}
    match_type_counts = {"sample_id": 0, "content_key": 0}

    for sample in samples:
        sample_id, key = sample_identity(sample)
        leakage_sources = set()
        match_type = None
        if sample_id and sample_id in historical_ids:
            leakage_sources.update(historical_ids[sample_id])
            match_type = "sample_id"
        if key in historical_keys:
            leakage_sources.update(historical_keys[key])
            if match_type is None:
                match_type = "content_key"
        if not leakage_sources:
            kept.append(sample)
            continue

        if match_type:
            match_type_counts[match_type] += 1
        for source_name in leakage_sources:
            blocked_source_counts[source_name] = blocked_source_counts.get(source_name, 0) + 1
        blocked.append(
            {
                **sample,
                "rejection_reason": "historical_leakage",
                "leakage_sources": sorted(leakage_sources),
                "leakage_match_type": match_type,
            }
        )

    return HistoricalLeakageResult(
        kept=kept,
        blocked=blocked,
        summary={
            "blocked_count": len(blocked),
            "historical_source_counts": blocked_source_counts,
            "match_type_counts": match_type_counts,
            "indexed_source_counts": source_counts,
        },
    )
