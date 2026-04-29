from __future__ import annotations

import logging
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
from dataforge.core.io import write_run_manifest
from dataforge.core.logging_config import task_run_context
from dataforge.core.registry import TaskRun
from dataforge.core.storage import load_artifact_records, save_artifact_records, save_blob_artifact
from dataforge.core.versioning import build_dataset_version_summary
from dataforge.providers import get_eval_provider


logger = logging.getLogger(__name__)


def run(task: TaskRun, *, gold_path: Path | None = None) -> dict[str, Path]:
    logger.info("Eval stage started", extra=task_run_context(task, "pipeline.eval", "start"))
    gold_source = gold_path or task.path_for("gold_eval")
    gold_samples = load_artifact_records(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="gold_eval",
    )
    if not gold_samples:
        logger.warning(
            "Eval stage has no gold samples",
            extra=task_run_context(
                task,
                "pipeline.eval",
                "degrade",
                error_code="EVAL_NO_GOLD_SAMPLES",
                input_path=gold_source,
            ),
        )
    hard_cases = load_artifact_records(
        task.project_root,
        task_name=task.name,
        run_id=task.run_id,
        artifact_key="hard_cases",
    )
    provider_name = task.runtime.get("eval", {}).get("provider", "mock")
    eval_provider = get_eval_provider(provider_name)
    eval_rows = []
    parse_failures = 0
    for sample in gold_samples:
        parse_ok, predicted_label, raw_output, error_code = eval_provider.predict_sample(task, sample)
        if not parse_ok:
            parse_failures += 1
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
    if parse_failures:
        logger.warning(
            "Eval stage completed predictions with parse failures",
            extra=task_run_context(
                task,
                "pipeline.eval",
                "degrade",
                error_code="EVAL_PARSE_FAILURES",
                parse_failures=parse_failures,
                gold_samples=len(gold_samples),
                provider=provider_name,
            ),
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
    if promptfoo_summary.get("status") != "ok":
        logger.warning(
            "Promptfoo eval did not complete successfully",
            extra=task_run_context(
                task,
                "pipeline.eval",
                "degrade",
                error_code="EVAL_PROMPTFOO_NOT_OK",
                status=promptfoo_summary.get("status"),
                results_path=promptfoo_results_path,
            ),
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
    save_artifact_records(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="eval_predictions",
        records=eval_rows,
    )
    save_blob_artifact(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="eval_export_metadata",
        payload=eval_version_summary,
    )
    save_blob_artifact(
        task.project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=task.run_id,
        artifact_key="eval_result",
        payload=eval_result,
    )
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
    logger.info(
        "Eval stage completed",
        extra=task_run_context(
            task,
            "pipeline.eval",
            "end",
            provider=provider_name,
            gold_samples=len(gold_samples),
            hard_cases=len(hard_cases),
            predictions=len(eval_rows),
            parse_failures=parse_failures,
            promptfoo_status=promptfoo_summary.get("status"),
            overall_accuracy=metrics.get("overall_accuracy"),
        ),
    )
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
