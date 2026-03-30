from __future__ import annotations

from pathlib import Path

from dataforge.core.eval_runner import (
    build_promptfoo_runtime_config,
    evaluate_predictions,
    export_eval_predictions,
    export_promptfoo_eval,
    run_promptfoo_eval,
    write_eval_reports,
)
from dataforge.core.io import read_jsonl, write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.providers import get_eval_provider


def run(task: TaskRun, *, gold_path: Path | None = None) -> dict[str, Path]:
    gold_source = gold_path or task.path_for("gold_eval")
    gold_samples = read_jsonl(gold_source)
    hard_cases = read_jsonl(task.path_for("hard_cases"))
    eval_provider = get_eval_provider(task.runtime.get("eval", {}).get("provider", "mock"))
    eval_rows = []
    for sample in gold_samples:
        parse_ok, predicted_label, raw_output, error_code = eval_provider.predict_sample(task, sample)
        eval_rows.append(
            {
                "id": sample["id"],
                "user_text": sample["input"]["user_text"],
                "expected_label": sample["annotation"]["final_label"],
                "predicted_label": predicted_label,
                "parse_ok": parse_ok,
                "raw_output": raw_output,
                "error_code": error_code,
                "has_visible_report": sample.get("context", {}).get("has_visible_report"),
                "difficulty": sample.get("metadata", {}).get("difficulty"),
                "tags": sample.get("metadata", {}).get("tags", []),
            }
        )
    metrics = evaluate_predictions(eval_rows, {sample["id"] for sample in hard_cases})

    promptfoo_export_path = task.path_for("eval_for_promptfoo")
    predictions_path = task.path_for("eval_predictions")
    summary_path = task.path_for("eval_summary")
    confusion_path = task.path_for("confusion_analysis")
    promptfoo_runtime_config_path = task.run_root / "reports" / "promptfoo" / "config.yaml"
    promptfoo_results_path = task.run_root / "reports" / "promptfoo" / "results.json"
    export_promptfoo_eval(promptfoo_export_path, eval_rows)
    export_eval_predictions(predictions_path, eval_rows)
    promptfoo_runtime = build_promptfoo_runtime_config(
        task.path_for("promptfoo"),
        promptfoo_export_path,
        promptfoo_runtime_config_path,
    )
    promptfoo_summary = run_promptfoo_eval(
        promptfoo_runtime["command"],
        promptfoo_runtime_config_path,
        promptfoo_results_path,
        cwd=task.project_root,
    )
    write_eval_reports(summary_path, confusion_path, metrics, promptfoo_summary=promptfoo_summary)

    manifest_path = task.path_for("eval_manifest")
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="eval",
        runtime=task.runtime.get("eval", {}),
        input_paths=[str(gold_source)],
        output_paths=[
            str(promptfoo_export_path),
            str(predictions_path),
            str(promptfoo_runtime_config_path),
            str(promptfoo_results_path),
            str(summary_path),
            str(confusion_path),
        ],
        stats=metrics,
        run_id=task.run_id,
    )
    task.record_stage("eval", manifest, manifest_path)
    return {
        "eval_for_promptfoo": promptfoo_export_path,
        "eval_predictions": predictions_path,
        "promptfoo_config": promptfoo_runtime_config_path,
        "promptfoo_results": promptfoo_results_path,
        "eval_summary": summary_path,
        "confusion_analysis": confusion_path,
    }
