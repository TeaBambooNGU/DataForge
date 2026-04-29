from __future__ import annotations

import logging
from pathlib import Path

from dataforge.core.io import read_yaml, write_run_manifest
from dataforge.core.logging_config import task_run_context
from dataforge.core.registry import TaskRun
from dataforge.core.schemas import validate_samples
from dataforge.core.storage import save_artifact_records
from dataforge.providers import get_generator_provider


logger = logging.getLogger(__name__)


def run(task: TaskRun, *, output_path: Path | None = None) -> Path:
    logger.info("Generate stage started", extra=task_run_context(task, "pipeline.generate", "start"))
    try:
        scenarios = read_yaml(task.path_for("scenario_matrix")).get("scenarios", [])
        if not scenarios:
            logger.warning(
                "Generate stage has no scenarios",
                extra=task_run_context(task, "pipeline.generate", "degrade", error_code="GENERATE_NO_SCENARIOS"),
            )
        provider_name = task.runtime.get("generator", {}).get("provider", "mock")
        provider = get_generator_provider(provider_name)
        samples = provider.generate_samples(task, scenarios)
        if not samples:
            logger.warning(
                "Generate stage produced no samples",
                extra=task_run_context(
                    task,
                    "pipeline.generate",
                    "degrade",
                    error_code="GENERATE_NO_SAMPLES",
                    scenarios_count=len(scenarios),
                    provider=provider_name,
                ),
            )

        validate_samples(samples)
        target = output_path or task.path_for("raw_candidates")
        save_artifact_records(
            task.project_root,
            task_name=task.name,
            task_root=task.task_root,
            run_id=task.run_id,
            artifact_key="raw_candidates",
            records=samples,
        )
        manifest_path = task.path_for("generate_manifest")
        manifest = write_run_manifest(
            manifest_path,
            task_name=task.name,
            stage_name="generate",
            runtime=task.runtime.get("generator", {}),
            input_paths=[str(task.path_for("scenario_matrix"))],
            output_paths=[str(target)],
            stats={"generated_samples": len(samples)},
            run_id=task.run_id,
        )
        task.record_stage("generate", manifest, manifest_path)
        logger.info(
            "Generate stage completed",
            extra=task_run_context(
                task,
                "pipeline.generate",
                "end",
                provider=provider_name,
                scenarios_count=len(scenarios),
                generated_samples=len(samples),
                output_path=target,
            ),
        )
        return target
    except Exception:
        logger.exception(
            "Generate stage failed",
            extra=task_run_context(task, "pipeline.generate", "error", error_code="PIPELINE_GENERATE_FAILED"),
        )
        raise
