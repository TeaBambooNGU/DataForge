from __future__ import annotations

import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

from dataforge.core.exporters import build_promptfoo_eval_rows
from dataforge.core.io import read_yaml, write_json, write_jsonl, write_text, write_yaml


class PromptfooExecutionError(RuntimeError):
    pass


def _nested_promptfoo_results(result_payload: Any) -> dict[str, Any] | None:
    if not isinstance(result_payload, dict):
        return None
    nested_results = result_payload.get("results")
    if isinstance(nested_results, dict):
        return nested_results
    return None


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
    write_jsonl(path, build_promptfoo_eval_rows(eval_rows))


def export_eval_predictions(path: Path, rows: list[dict]) -> None:
    write_jsonl(path, rows)


def _extract_promptfoo_pass(result: Any) -> bool | None:
    if not isinstance(result, dict):
        return None
    for key in ("pass", "success"):
        value = result.get(key)
        if isinstance(value, bool):
            return value
    grading_result = result.get("gradingResult")
    if isinstance(grading_result, dict):
        value = grading_result.get("pass")
        if isinstance(value, bool):
            return value
    return None


def summarize_promptfoo_results(result_payload: Any) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "pass_rate": None,
        "total_tests": 0,
        "passed_tests": 0,
        "failed_tests": 0,
    }
    if not isinstance(result_payload, dict):
        return summary

    raw_summary = result_payload.get("summary")
    if not isinstance(raw_summary, dict):
        nested_results = _nested_promptfoo_results(result_payload)
        if isinstance(nested_results, dict):
            stats = nested_results.get("stats")
            if isinstance(stats, dict):
                successes = stats.get("successes")
                failures = stats.get("failures")
                if isinstance(successes, int):
                    summary["passed_tests"] = successes
                if isinstance(failures, int):
                    summary["failed_tests"] = failures
                total = summary["passed_tests"] + summary["failed_tests"]
                if total:
                    summary["total_tests"] = total
                    summary["pass_rate"] = round(summary["passed_tests"] / total, 4)

    if isinstance(raw_summary, dict):
        for source_key, target_key in (
            ("passRate", "pass_rate"),
            ("totalTests", "total_tests"),
            ("passedTests", "passed_tests"),
            ("failedTests", "failed_tests"),
        ):
            value = raw_summary.get(source_key)
            if isinstance(value, (int, float)):
                summary[target_key] = value

    results = result_payload.get("results")
    if isinstance(results, dict):
        nested_list = results.get("results")
        if isinstance(nested_list, list):
            results = nested_list
    if isinstance(results, list):
        passed = 0
        failed = 0
        for result in results:
            passed_flag = _extract_promptfoo_pass(result)
            if passed_flag is True:
                passed += 1
            elif passed_flag is False:
                failed += 1
        total = len(results)
        if not summary["total_tests"]:
            summary["total_tests"] = total
        if not summary["passed_tests"]:
            summary["passed_tests"] = passed
        if not summary["failed_tests"]:
            summary["failed_tests"] = failed
        if summary["pass_rate"] is None and total:
            summary["pass_rate"] = round(passed / total, 4)

    return summary


def _top_confusions(confusion_matrix: dict[str, dict[str, int]], *, limit: int = 5) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    for expected, predicted_counts in confusion_matrix.items():
        for predicted, count in predicted_counts.items():
            if expected == predicted or count <= 0:
                continue
            pairs.append({"expected": expected, "predicted": predicted, "count": count})
    return sorted(
        pairs,
        key=lambda item: (-item["count"], item["expected"], item["predicted"]),
    )[:limit]


def build_eval_result(
    eval_rows: list[dict[str, Any]],
    metrics: dict[str, Any],
    hard_case_ids: set[str],
    *,
    promptfoo_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    mismatch_count = sum(1 for row in eval_rows if row.get("expected_label") != row.get("predicted_label"))
    parse_failure_count = sum(1 for row in eval_rows if row.get("parse_ok") is False)
    label_distribution = Counter(row["expected_label"] for row in eval_rows)
    hard_case_total = sum(1 for row in eval_rows if row["id"] in hard_case_ids)
    no_visible_total = sum(1 for row in eval_rows if row.get("has_visible_report") is False)
    promptfoo_result = None
    if promptfoo_summary is not None:
        promptfoo_result = {
            "status": promptfoo_summary.get("status", "unknown"),
            "results_path": promptfoo_summary.get("results_path"),
            "command": promptfoo_summary.get("command", []),
            "stdout": promptfoo_summary.get("stdout", ""),
            "stderr": promptfoo_summary.get("stderr", ""),
            "summary": summarize_promptfoo_results(
                {
                    "summary": promptfoo_summary.get("summary"),
                    "results": promptfoo_summary.get("results"),
                }
            ),
        }

    return {
        "dataset": {
            "sample_count": len(eval_rows),
            "hard_case_sample_count": hard_case_total,
            "no_visible_report_sample_count": no_visible_total,
            "label_distribution": dict(sorted(label_distribution.items())),
        },
        "metrics": metrics,
        "quality": {
            "mismatch_count": mismatch_count,
            "parse_failure_count": parse_failure_count,
            "top_confusions": _top_confusions(metrics["confusion_matrix"]),
        },
        "promptfoo": promptfoo_result,
    }


def build_eval_manifest_summary(eval_result: dict[str, Any]) -> dict[str, Any]:
    metrics = eval_result.get("metrics", {})
    quality = eval_result.get("quality", {})
    promptfoo = eval_result.get("promptfoo") or {}
    promptfoo_metrics = promptfoo.get("summary") or {}
    return {
        "sample_count": eval_result.get("dataset", {}).get("sample_count", 0),
        "overall_accuracy": metrics.get("overall_accuracy", 0.0),
        "macro_f1": metrics.get("macro_f1", 0.0),
        "json_valid_rate": metrics.get("json_valid_rate", 0.0),
        "hard_cases_accuracy": metrics.get("hard_cases_accuracy", 0.0),
        "has_visible_report_false_accuracy": metrics.get("has_visible_report_false_accuracy", 0.0),
        "mismatch_count": quality.get("mismatch_count", 0),
        "parse_failure_count": quality.get("parse_failure_count", 0),
        "promptfoo_status": promptfoo.get("status"),
        "promptfoo_pass_rate": promptfoo_metrics.get("pass_rate"),
    }


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
    status = "ok"
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
        if exc.returncode == 100 and results_path.exists():
            completed = subprocess.CompletedProcess(
                exc.cmd,
                exc.returncode,
                stdout=exc.stdout,
                stderr=exc.stderr,
            )
            status = "completed_with_failures"
        else:
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
        "status": status,
        "command": full_command,
        "exit_code": completed.returncode,
        "results_path": str(results_path),
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }
    if isinstance(result_payload, dict):
        nested_results = _nested_promptfoo_results(result_payload)
        for key in ("results", "summary", "stats"):
            if key in result_payload:
                summary[key] = result_payload[key]
        if "summary" not in summary and isinstance(nested_results, dict):
            stats = nested_results.get("stats")
            if isinstance(stats, dict):
                total_tests = stats.get("successes", 0) + stats.get("failures", 0)
                summary["summary"] = {
                    "passRate": round(stats["successes"] / total_tests, 4) if total_tests else None,
                    "totalTests": total_tests,
                    "passedTests": stats.get("successes", 0),
                    "failedTests": stats.get("failures", 0),
                }
        summary["results_overview"] = summarize_promptfoo_results(result_payload)
    return summary


def write_eval_reports(
    summary_path: Path,
    confusion_path: Path,
    metrics: dict[str, Any],
    *,
    eval_result: dict[str, Any] | None = None,
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
        promptfoo_overview = (eval_result or {}).get("promptfoo", {}).get("summary", {})
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
        if promptfoo_overview.get("pass_rate") is not None:
            summary_lines.append(f"- Promptfoo pass rate: {promptfoo_overview['pass_rate']:.4f}")
        if promptfoo_overview.get("total_tests"):
            summary_lines.append(f"- Promptfoo total tests: {promptfoo_overview['total_tests']}")

    confusion_lines = ["# Confusion Analysis", "", "## Matrix"]
    for expected, predicted_counts in metrics["confusion_matrix"].items():
        confusion_lines.append(f"- expected={expected}: {predicted_counts}")
    if eval_result is not None:
        top_confusions = eval_result.get("quality", {}).get("top_confusions", [])
        if top_confusions:
            confusion_lines.extend(["", "## Top Confusions"])
            for item in top_confusions:
                confusion_lines.append(
                    f"- expected={item['expected']} predicted={item['predicted']} count={item['count']}"
                )

    write_text(summary_path, "\n".join(summary_lines) + "\n")
    write_text(confusion_path, "\n".join(confusion_lines) + "\n")
