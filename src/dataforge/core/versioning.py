from __future__ import annotations

from typing import Any

from dataforge.core.io import utc_now


def build_dataset_version_summary(
    *,
    task_name: str,
    run_id: str,
    dataset_name: str,
    format_name: str,
    sample_count: int,
    source_paths: list[str],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "version_id": f"{run_id}-{dataset_name}-{format_name}",
        "task_name": task_name,
        "run_id": run_id,
        "dataset_name": dataset_name,
        "format": format_name,
        "sample_count": sample_count,
        "source_paths": source_paths,
        "generated_at": utc_now(),
    }
    if extra:
        payload.update(extra)
    return payload
