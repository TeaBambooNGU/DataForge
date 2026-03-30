from __future__ import annotations

import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

from dataforge.core.io import read_yaml, write_json, write_jsonl, write_text, write_yaml


class PromptfooExecutionError(RuntimeError):
    pass


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


def export_promptfoo_eval(path: Path, eval_rows: list[dict[str, Any]]) -> None:
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
    write_jsonl(path, rows)


def export_eval_predictions(path: Path, rows: list[dict]) -> None:
    write_jsonl(path, rows)


def build_promptfoo_runtime_config(
    promptfoo_config_path: Path,
    promptfoo_tests_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    config = read_yaml(promptfoo_config_path)
    dataforge_config = config.pop("dataforge", {})

    tests_ref = f"file://{promptfoo_tests_path}"
    current_tests = config.get("tests")
    if isinstance(current_tests, str):
        placeholder = "__DATAFORGE_EVAL_FOR_PROMPTFOO__"
        config["tests"] = current_tests.replace(placeholder, str(promptfoo_tests_path))
    else:
        config["tests"] = tests_ref

    write_yaml(output_path, config)
    return {
        "config": config,
        "command": dataforge_config.get("command") or ["npx", "--yes", "promptfoo@latest"],
    }


def run_promptfoo_eval(
    command: list[str],
    config_path: Path,
    results_path: Path,
    *,
    cwd: Path,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> dict[str, Any]:
    command_runner = runner or subprocess.run
    results_path.parent.mkdir(parents=True, exist_ok=True)
    full_command = [*command, "eval", "-c", str(config_path), "--output", str(results_path), "--no-cache"]
    try:
        completed = command_runner(
            full_command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise PromptfooExecutionError(f"Promptfoo command not found: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        raise PromptfooExecutionError(
            f"Promptfoo eval failed with exit code {exc.returncode}: {exc.stderr.strip() or exc.stdout.strip()}"
        ) from exc

    result_payload: Any = {}
    if results_path.exists():
        with results_path.open("r", encoding="utf-8") as handle:
            try:
                result_payload = json.load(handle)
            except json.JSONDecodeError:
                result_payload = {}

    summary = {
        "status": "ok",
        "command": full_command,
        "results_path": str(results_path),
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }
    if isinstance(result_payload, dict):
        for key in ("results", "summary", "stats"):
            if key in result_payload:
                summary[key] = result_payload[key]
    return summary


def write_eval_reports(
    summary_path: Path,
    confusion_path: Path,
    metrics: dict[str, Any],
    *,
    promptfoo_summary: dict[str, Any] | None = None,
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

    if promptfoo_summary is not None:
        summary_lines.extend(
            [
                "",
                "## Promptfoo",
                "",
                f"- Status: {promptfoo_summary.get('status', 'unknown')}",
                f"- Results path: {promptfoo_summary.get('results_path', '')}",
            ]
        )
        if promptfoo_summary.get("stdout"):
            summary_lines.append(f"- Stdout: {promptfoo_summary['stdout']}")
        if promptfoo_summary.get("stderr"):
            summary_lines.append(f"- Stderr: {promptfoo_summary['stderr']}")
        if "summary" in promptfoo_summary:
            summary_lines.append(f"- Promptfoo summary: {promptfoo_summary['summary']}")
        if "stats" in promptfoo_summary:
            summary_lines.append(f"- Promptfoo stats: {promptfoo_summary['stats']}")

    confusion_lines = ["# Confusion Analysis", "", "## Matrix"]
    for expected, predicted_counts in metrics["confusion_matrix"].items():
        confusion_lines.append(f"- expected={expected}: {predicted_counts}")

    write_text(summary_path, "\n".join(summary_lines) + "\n")
    write_text(confusion_path, "\n".join(confusion_lines) + "\n")
