from __future__ import annotations

import logging
from pathlib import Path

from dataforge.core.io import write_run_manifest
from dataforge.core.logging_config import task_run_context
from dataforge.core.registry import TaskRun
from dataforge.core.schemas import validate_samples
from dataforge.core.storage import load_artifact_records, save_artifact_records
from dataforge.providers import get_teacher_provider


logger = logging.getLogger(__name__)


def run(task: TaskRun, *, input_path: Path | None = None, output_path: Path | None = None) -> Path:
    logger.info("Classify stage started", extra=task_run_context(task, "pipeline.classify", "start"))
    try:
        source = input_path or task.path_for("raw_candidates")
        samples = load_artifact_records(
            task.project_root,
            task_name=task.name,
            run_id=task.run_id,
            artifact_key="raw_candidates",
        )
        if not samples:
            logger.warning(
                "Classify stage has no input samples",
                extra=task_run_context(
                    task,
                    "pipeline.classify",
                    "degrade",
                    error_code="CLASSIFY_NO_INPUT",
                    input_path=source,
                ),
            )
        classified = []
        parse_failures = 0
        provider_name = task.runtime.get("teacher", {}).get("provider", "mock")
        provider = get_teacher_provider(provider_name)

        for sample in samples:
            parse_ok, label, raw_output, error_code = provider.classify_sample(task, sample)
            classified.append(
                {
                    **sample,
                    "stage": "classified",
                    "annotation": {
                        "teacher_label": label,
                        "teacher_raw_output": raw_output,
                        "parse_ok": parse_ok,
                        "error_code": error_code,
                        "human_label": None,
                        "review_status": "unreviewed",
                        "final_label": None,
                    },
                }
            )
            if not parse_ok:
                parse_failures += 1

        if parse_failures:
            logger.warning(
                "Classify stage completed with parse failures",
                extra=task_run_context(
                    task,
                    "pipeline.classify",
                    "degrade",
                    error_code="CLASSIFY_PARSE_FAILURES",
                    parse_failures=parse_failures,
                    input_samples=len(samples),
                    provider=provider_name,
                ),
            )

        validate_samples(classified)
        target = output_path or task.path_for("teacher_labeled")
        save_artifact_records(
            task.project_root,
            task_name=task.name,
            task_root=task.task_root,
            run_id=task.run_id,
            artifact_key="teacher_labeled",
            records=classified,
        )
        manifest_path = task.path_for("classify_manifest")
        manifest = write_run_manifest(
            manifest_path,
            task_name=task.name,
            stage_name="classify",
            runtime=task.runtime.get("teacher", {}),
            input_paths=[str(source)],
            output_paths=[str(target)],
            stats={"classified_samples": len(classified), "parse_failures": parse_failures},
            run_id=task.run_id,
        )
        task.record_stage("classify", manifest, manifest_path)
        logger.info(
            "Classify stage completed",
            extra=task_run_context(
                task,
                "pipeline.classify",
                "end",
                provider=provider_name,
                input_samples=len(samples),
                classified_samples=len(classified),
                parse_failures=parse_failures,
                output_path=target,
            ),
        )
        return target
    except Exception:
        logger.exception(
            "Classify stage failed",
            extra=task_run_context(task, "pipeline.classify", "error", error_code="PIPELINE_CLASSIFY_FAILED"),
        )
        raise
