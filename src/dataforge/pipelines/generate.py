from __future__ import annotations

from pathlib import Path

from dataforge.core.io import read_yaml, write_jsonl, write_run_manifest
from dataforge.core.registry import TaskRun
from dataforge.core.schemas import validate_samples
from dataforge.providers import get_generator_provider


def run(task: TaskRun, *, output_path: Path | None = None) -> Path:
    scenarios = read_yaml(task.path_for("scenario_matrix")).get("scenarios", [])
    provider = get_generator_provider(task.runtime.get("generator", {}).get("provider", "mock"))
    samples = provider.generate_samples(task, scenarios)

    validate_samples(samples)
    target = output_path or task.path_for("raw_candidates")
    write_jsonl(target, samples)
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
    return target
