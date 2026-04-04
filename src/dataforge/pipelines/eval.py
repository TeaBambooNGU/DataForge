from __future__ import annotations

from pathlib import Path

from dataforge.core.eval_runner import (
    build_eval_manifest_summary,
    build_eval_result,
    build_promptfoo_runtime_config,
    evaluate_predictions,
    export_eval_predictions,
    export_promptfoo_eval,
    run_promptfoo_eval,
    write_eval_reports,
)
from dataforge.core.exporters import export_eval_dataset
from dataforge.core.io import read_jsonl, write_json, write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.versioning import build_dataset_version_summary
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
    eval_export_path = task.path_for("eval_export")
    eval_export_metadata_path = task.path_for("eval_export_metadata")
    predictions_path = task.path_for("eval_predictions")
    eval_result_path = task.path_for("eval_result")
    summary_path = task.path_for("eval_summary")
    confusion_path = task.path_for("confusion_analysis")
    promptfoo_runtime_config_path = task.run_root / "reports" / "promptfoo" / "config.yaml"
    promptfoo_results_path = task.run_root / "reports" / "promptfoo" / "results.json"
    export_promptfoo_eval(promptfoo_export_path, eval_rows)
    eval_export_summary = export_eval_dataset(
        eval_export_path,
        eval_rows,
        task.exports.get("eval_format"),
    )
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
    eval_result = build_eval_result(
        eval_rows,
        metrics,
        {sample["id"] for sample in hard_cases},
        promptfoo_summary=promptfoo_summary,
    )
    eval_version_summary = build_dataset_version_summary(
        task_name=task.name,
        run_id=task.run_id,
        dataset_name="eval-export",
        format_name=eval_export_summary["format"],
        sample_count=eval_export_summary["sample_count"],
        source_paths=[str(gold_source), str(predictions_path)],
        extra={"hard_case_sample_count": len(hard_cases)},
    )
    eval_result["version"] = eval_version_summary
    write_json(eval_export_metadata_path, eval_version_summary)
    write_json(eval_result_path, eval_result)
    write_eval_reports(
        summary_path,
        confusion_path,
        metrics,
        eval_result=eval_result,
        promptfoo_summary=promptfoo_summary,
    )

    manifest_path = task.path_for("eval_manifest")
    manifest_summary = build_eval_manifest_summary(eval_result)
    manifest = write_run_manifest(
        manifest_path,
        task_name=task.name,
        stage_name="eval",
        runtime=task.runtime.get("eval", {}),
        input_paths=[str(gold_source), str(task.path_for("hard_cases"))],
        output_paths=[
            str(eval_export_path),
            str(eval_export_metadata_path),
            str(promptfoo_export_path),
            str(predictions_path),
            str(eval_result_path),
            str(promptfoo_runtime_config_path),
            str(promptfoo_results_path),
            str(summary_path),
            str(confusion_path),
        ],
        stats={**manifest_summary, "eval_export_format": eval_export_summary["format"]},
        summary=manifest_summary,
        details={
            "dataset": eval_result["dataset"],
            "quality": eval_result["quality"],
            "promptfoo": eval_result["promptfoo"],
            "eval_export": eval_export_summary,
            "eval_version": eval_version_summary,
            "artifacts": {
                "eval_export": str(eval_export_path),
                "eval_export_metadata": str(eval_export_metadata_path),
                "eval_result": str(eval_result_path),
                "promptfoo_config": str(promptfoo_runtime_config_path),
                "promptfoo_results": str(promptfoo_results_path),
            },
        },
        run_id=task.run_id,
    )
    task.record_stage("eval", manifest, manifest_path)
    return {
        "eval_export": eval_export_path,
        "eval_export_metadata": eval_export_metadata_path,
        "eval_for_promptfoo": promptfoo_export_path,
        "eval_predictions": predictions_path,
        "eval_result": eval_result_path,
        "promptfoo_config": promptfoo_runtime_config_path,
        "promptfoo_results": promptfoo_results_path,
        "eval_summary": summary_path,
        "confusion_analysis": confusion_path,
    }
