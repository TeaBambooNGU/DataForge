from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from dataforge.core.io import write_jsonl, write_text


def _safe_div(numerator: float, denominator: float) -> float:
    if denominator == 0:
        return 0.0
    return numerator / denominator


def _f1(precision: float, recall: float) -> float:
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def evaluate_predictions(eval_rows: list[dict], hard_case_ids: set[str]) -> dict[str, Any]:
    labels = sorted({row["expected_label"] for row in eval_rows} | {row["predicted_label"] for row in eval_rows if row["predicted_label"]})
    matrix: dict[str, Counter[str]] = defaultdict(Counter)
    total = len(eval_rows)
    correct = 0
    parse_ok_count = 0
    hard_total = 0
    hard_correct = 0
    no_visible_total = 0
    no_visible_correct = 0

    for row in eval_rows:
        predicted = row.get("predicted_label")
        expected = row["expected_label"]
        matrix[expected][predicted] += 1
        if predicted == expected:
            correct += 1
        if row.get("parse_ok"):
            parse_ok_count += 1
        if row["id"] in hard_case_ids:
            hard_total += 1
            if predicted == expected:
                hard_correct += 1
        if row.get("has_visible_report") is False:
            no_visible_total += 1
            if predicted == expected:
                no_visible_correct += 1

    per_class: dict[str, dict[str, float]] = {}
    f1_values: list[float] = []
    for label in labels:
        tp = matrix[label][label]
        fp = sum(matrix[other][label] for other in labels if other != label)
        fn = sum(matrix[label][other] for other in labels if other != label)
        precision = _safe_div(tp, tp + fp)
        recall = _safe_div(tp, tp + fn)
        f1_score = _f1(precision, recall)
        per_class[label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1_score, 4),
        }
        f1_values.append(f1_score)

    return {
        "overall_accuracy": round(_safe_div(correct, total), 4),
        "macro_f1": round(_safe_div(sum(f1_values), len(f1_values)), 4),
        "json_valid_rate": round(_safe_div(parse_ok_count, total), 4),
        "hard_cases_accuracy": round(_safe_div(hard_correct, hard_total), 4),
        "has_visible_report_false_accuracy": round(_safe_div(no_visible_correct, no_visible_total), 4),
        "per_class": per_class,
        "confusion_matrix": {label: dict(counter) for label, counter in matrix.items()},
    }


def export_promptfoo_eval(path: Path, gold_samples: list[dict]) -> None:
    rows = []
    for sample in gold_samples:
        rows.append(
            {
                "id": sample["id"],
                "input": sample["input"]["user_text"],
                "expected": sample["annotation"]["final_label"],
            }
        )
    write_jsonl(path, rows)


def export_eval_predictions(path: Path, rows: list[dict]) -> None:
    write_jsonl(path, rows)


def write_eval_reports(
    summary_path: Path,
    confusion_path: Path,
    metrics: dict[str, Any],
) -> None:
    summary_lines = [
        "# Eval Summary",
        "",
        f"- Overall accuracy: {metrics['overall_accuracy']:.4f}",
        f"- Macro F1: {metrics['macro_f1']:.4f}",
        f"- JSON valid rate: {metrics['json_valid_rate']:.4f}",
        f"- Hard cases accuracy: {metrics['hard_cases_accuracy']:.4f}",
        f"- has_visible_report=false accuracy: {metrics['has_visible_report_false_accuracy']:.4f}",
        "",
        "## Per-class",
    ]
    for label, values in metrics["per_class"].items():
        summary_lines.append(
            f"- {label}: precision={values['precision']:.4f}, recall={values['recall']:.4f}, f1={values['f1']:.4f}"
        )

    confusion_lines = ["# Confusion Analysis", "", "## Matrix"]
    for expected, predicted_counts in metrics["confusion_matrix"].items():
        confusion_lines.append(f"- expected={expected}: {predicted_counts}")

    write_text(summary_path, "\n".join(summary_lines) + "\n")
    write_text(confusion_path, "\n".join(confusion_lines) + "\n")
