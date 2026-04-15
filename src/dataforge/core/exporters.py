from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from dataforge.core.io import write_jsonl


SUPPORTED_TRAIN_EXPORT_FORMATS = {"raw_sample_jsonl", "chatml_jsonl"}
SUPPORTED_EVAL_EXPORT_FORMATS = {"prediction_jsonl", "promptfoo_jsonl"}


def _normalize_export_format(
    format_name: str | None,
    *,
    export_type: str,
    supported: set[str],
    default: str,
) -> str:
    resolved = (format_name or default).strip()
    if resolved not in supported:
        raise ValueError(
            f"Unsupported {export_type} export format: {resolved}. Supported formats: {', '.join(sorted(supported))}"
        )
    return resolved


def build_promptfoo_eval_rows(eval_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for row in eval_rows:
        rows.append(
            {
                "vars": {
                    "id": row["id"],
                    "input": row["user_text"],
                    "expected": row["expected_label"],
                    "predicted_label": row["predicted_label"],
                    "predicted_json": json.dumps(
                        {"action": row["predicted_label"]},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                },
                "assert": [
                    {"type": "is-json"},
                    {
                        "type": "javascript",
                        "value": "JSON.parse(output).action === context.vars.expected",
                    },
                ],
                "metadata": {
                    "difficulty": row.get("difficulty"),
                    "tags": row.get("tags", []),
                    "has_visible_report": row.get("has_visible_report"),
                    "parse_ok": row.get("parse_ok"),
                },
            }
        )
    return rows


def _build_chatml_train_record(sample: dict[str, Any], *, system_prompt: str | None = None) -> dict[str, Any]:
    annotation = sample.get("annotation", {})
    label = annotation.get("teacher_label") or annotation.get("final_label")
    if not label:
        raise ValueError(f"Sample {sample.get('id')} is missing a label for chatml export")

    messages: list[dict[str, str]] = []
    normalized_system_prompt = (system_prompt or "").strip()
    if normalized_system_prompt:
        messages.append({"role": "system", "content": normalized_system_prompt})
    messages.extend(
        [
            {"role": "user", "content": sample["input"]["user_text"]},
            {
                "role": "assistant",
                "content": json.dumps({"action": label}, ensure_ascii=False, separators=(",", ":")),
            },
        ]
    )
    return {"messages": messages}


def export_train_dataset(
    path: Path,
    samples: list[dict[str, Any]],
    format_name: str | None,
    *,
    system_prompt: str | None = None,
) -> dict[str, Any]:
    resolved = _normalize_export_format(
        format_name,
        export_type="train",
        supported=SUPPORTED_TRAIN_EXPORT_FORMATS,
        default="raw_sample_jsonl",
    )
    if resolved == "raw_sample_jsonl":
        records = samples
    else:
        records = [_build_chatml_train_record(sample, system_prompt=system_prompt) for sample in samples]
    write_jsonl(path, records)
    return {
        "format": resolved,
        "sample_count": len(records),
        "path": str(path),
    }


def export_eval_dataset(path: Path, eval_rows: list[dict[str, Any]], format_name: str | None) -> dict[str, Any]:
    resolved = _normalize_export_format(
        format_name,
        export_type="eval",
        supported=SUPPORTED_EVAL_EXPORT_FORMATS,
        default="prediction_jsonl",
    )
    if resolved == "prediction_jsonl":
        records = eval_rows
    else:
        records = build_promptfoo_eval_rows(eval_rows)
    write_jsonl(path, records)
    return {
        "format": resolved,
        "sample_count": len(records),
        "path": str(path),
    }
