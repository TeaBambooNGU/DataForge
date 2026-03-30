from __future__ import annotations

import argparse
import shutil
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from dataforge.core.env import load_dotenv
from dataforge.core.io import read_json, read_jsonl, read_text, read_yaml, utc_now, write_json, write_jsonl, write_text, write_yaml
from dataforge.core.registry import RUN_ARTIFACT_PATHS, TaskConfig, TaskRun, discover_tasks, latest_run_id, load_task_config, resolve_task_run
from dataforge.core.review import summarize_review_records, utc_now as review_utc_now, validate_review_records
from dataforge.pipelines import build_gold, classify, eval as eval_pipeline, filter_export, generate, review_export, validate_review


COMMAND_HANDLERS = {
    "generate": generate.run,
    "classify": classify.run,
    "filter-export": filter_export.run,
    "review-export": review_export.run,
    "validate-review": validate_review.run,
    "build-gold": build_gold.run,
    "eval": eval_pipeline.run,
}


class CommandRequest(BaseModel):
    run_id: str | None = None


class ReviewRecordsPayload(BaseModel):
    records: list[dict[str, Any]]
    reviewer: str | None = None


class TaskConfigFilesPayload(BaseModel):
    task: dict[str, Any]
    runtime: dict[str, dict[str, Any]]
    rules: dict[str, Any]
    exports: dict[str, Any]
    labels: list[str]
    scenarios: list[dict[str, Any]]
    generator_prompt: str
    teacher_prompt: str


def _http_404(message: str) -> HTTPException:
    return HTTPException(status_code=404, detail=message)


def _http_400(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {key: _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_to_jsonable(item) for item in value]
    return value


def _load_task(project_root: Path, task_name: str) -> TaskConfig:
    try:
        return load_task_config(project_root, task_name)
    except FileNotFoundError as exc:
        raise _http_404(str(exc)) from exc


def _load_runs_index(task: TaskConfig) -> list[dict[str, Any]]:
    index_path = task.task_root / "runs" / "index.json"
    if not index_path.exists():
        return []
    index = read_json(index_path)
    runs = index.get("runs", [])
    return sorted(runs, key=lambda item: item.get("created_at", ""), reverse=True)


def _find_run_entry(task: TaskConfig, run_id: str) -> dict[str, Any]:
    for entry in _load_runs_index(task):
        if entry.get("run_id") == run_id:
            return entry
    raise _http_404(f"Run not found: {run_id}")


def _write_runs_index(task: TaskConfig, runs: list[dict[str, Any]]) -> None:
    index_path = task.task_root / "runs" / "index.json"
    sorted_runs = sorted(runs, key=lambda item: item.get("created_at", ""), reverse=True)
    write_json(index_path, {"runs": sorted_runs})


def _sync_latest_run_pointer(task: TaskConfig, runs: list[dict[str, Any]]) -> None:
    latest_path = task.task_root / "runs" / "latest.json"
    if not runs:
        if latest_path.exists():
            latest_path.unlink()
        return

    latest_entry = sorted(runs, key=lambda item: item.get("created_at", ""), reverse=True)[0]
    write_json(
        latest_path,
        {
            "run_id": latest_entry["run_id"],
            "status": latest_entry.get("status"),
            "updated_at": utc_now(),
        },
    )


def _delete_run(task: TaskConfig, run_id: str) -> list[dict[str, Any]]:
    index_path = task.task_root / "runs" / "index.json"
    if not index_path.exists():
        raise _http_404(f"Run not found: {run_id}")

    index = read_json(index_path)
    runs = index.get("runs", [])
    remaining_runs = [entry for entry in runs if entry.get("run_id") != run_id]
    if len(remaining_runs) == len(runs):
        raise _http_404(f"Run not found: {run_id}")

    run_root = task.task_root / "runs" / run_id
    if run_root.exists():
        shutil.rmtree(run_root)

    _write_runs_index(task, remaining_runs)
    _sync_latest_run_pointer(task, remaining_runs)
    return sorted(remaining_runs, key=lambda item: item.get("created_at", ""), reverse=True)


def _artifact_kind(path: Path) -> str:
    if path.suffix == ".jsonl":
        return "jsonl"
    if path.suffix == ".json":
        return "json"
    return "text"


def _serialize_artifact_meta(run: TaskRun, artifact_key: str, relative_path: str) -> dict[str, Any]:
    path = run.path_for(artifact_key)
    exists = path.exists()
    return {
        "key": artifact_key,
        "relative_path": relative_path,
        "absolute_path": str(path),
        "category": relative_path.split("/", 1)[0],
        "kind": _artifact_kind(path),
        "exists": exists,
        "size_bytes": path.stat().st_size if exists else 0,
    }


def _serialize_run(task: TaskConfig, entry: dict[str, Any]) -> dict[str, Any]:
    run = TaskRun(task=task, run_id=entry["run_id"])
    artifacts = [
        _serialize_artifact_meta(run, artifact_key, relative_path)
        for artifact_key, relative_path in RUN_ARTIFACT_PATHS.items()
    ]
    return {
        "run_id": entry["run_id"],
        "status": entry.get("status"),
        "created_at": entry.get("created_at"),
        "updated_at": entry.get("updated_at"),
        "last_stage": entry.get("last_stage"),
        "stages": entry.get("stages", {}),
        "run_root": str(run.run_root),
        "artifacts": artifacts,
    }


def _task_labels(task: TaskConfig) -> list[str]:
    labels = read_yaml(task.path_for("labels"))
    return list(labels.get("labels", []))


def _serialize_task(project_root: Path, task_name: str) -> dict[str, Any]:
    task = _load_task(project_root, task_name)
    runs = _load_runs_index(task)
    latest_id = latest_run_id(task)
    latest_entry = next((entry for entry in runs if entry["run_id"] == latest_id), None)
    return {
        "name": task.name,
        "theme": task.config.get("theme"),
        "language": task.config.get("language"),
        "task_type": task.config.get("task_type"),
        "labels": _task_labels(task),
        "latest_run_id": latest_id,
        "latest_status": latest_entry.get("status") if latest_entry else None,
        "run_count": len(runs),
    }


def _serialize_task_spec(task: TaskConfig) -> dict[str, Any]:
    scenario_matrix = read_yaml(task.path_for("scenario_matrix"))
    return {
        "name": task.name,
        "theme": task.config.get("theme"),
        "language": task.config.get("language"),
        "task_type": task.config.get("task_type"),
        "entry_schema": task.config.get("entry_schema"),
        "runtime": task.runtime,
        "rules": task.rules,
        "exports": task.exports,
        "labels": _task_labels(task),
        "paths": {key: str(value) for key, value in task.resolved_paths.items()},
        "scenarios": scenario_matrix.get("scenarios", []),
        "generator_prompt": read_text(task.path_for("generator_prompt")),
        "teacher_prompt": read_text(task.path_for("teacher_prompt")),
        "raw_config": task.config,
    }


def _estimate_scenario_samples(scenario: dict[str, Any]) -> int:
    generation_count = scenario.get("generation_count")
    if isinstance(generation_count, int) and generation_count > 0:
        return generation_count
    return len(scenario.get("templates", []))


def _serialize_task_config_files(task: TaskConfig) -> dict[str, Any]:
    scenario_matrix = read_yaml(task.path_for("scenario_matrix"))
    scenarios = scenario_matrix.get("scenarios", [])
    scenario_estimates = [
        {
            "index": index,
            "intent": scenario.get("intent"),
            "estimated_samples": _estimate_scenario_samples(scenario),
        }
        for index, scenario in enumerate(scenarios)
    ]
    return {
        "task": {
            "name": task.name,
            "theme": task.config.get("theme"),
            "language": task.config.get("language"),
            "task_type": task.config.get("task_type"),
            "entry_schema": task.config.get("entry_schema"),
        },
        "runtime": task.runtime,
        "rules": task.rules,
        "exports": task.exports,
        "labels": _task_labels(task),
        "paths": {key: str(value) for key, value in task.resolved_paths.items()},
        "scenarios": scenarios,
        "generator_prompt": read_text(task.path_for("generator_prompt")),
        "teacher_prompt": read_text(task.path_for("teacher_prompt")),
        "estimated_sample_count": sum(item["estimated_samples"] for item in scenario_estimates),
        "scenario_estimates": scenario_estimates,
    }


def _normalize_string(value: Any, *, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field} cannot be empty")
    return normalized


def _normalize_string_list(values: Any, *, field: str, allow_empty: bool = False) -> list[str]:
    if not isinstance(values, list):
        raise ValueError(f"{field} must be a list")
    normalized: list[str] = []
    for index, item in enumerate(values):
        if not isinstance(item, str):
            raise ValueError(f"{field}[{index}] must be a string")
        value = item.strip()
        if not value:
            continue
        if value not in normalized:
            normalized.append(value)
    if not allow_empty and not normalized:
        raise ValueError(f"{field} cannot be empty")
    return normalized


def _normalize_prompt(value: Any, *, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field} cannot be empty")
    return normalized + "\n"


def _normalize_runtime(runtime: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(runtime, dict):
        raise ValueError("runtime must be an object")
    normalized: dict[str, dict[str, Any]] = {}
    for stage in ("generator", "teacher", "eval"):
        config = runtime.get(stage, {})
        if not isinstance(config, dict):
            raise ValueError(f"runtime.{stage} must be an object")
        stage_config: dict[str, Any] = {}
        for key, value in config.items():
            if not isinstance(key, str):
                raise ValueError(f"runtime.{stage} contains a non-string key")
            if isinstance(value, (str, int, float, bool)) or value is None:
                stage_config[key] = value
                continue
            raise ValueError(f"runtime.{stage}.{key} must be a primitive value")
        provider = stage_config.get("provider")
        if provider is not None:
            stage_config["provider"] = _normalize_string(provider, field=f"runtime.{stage}.provider")
        normalized[stage] = stage_config
    return normalized


def _normalize_primitive_object(value: Any, *, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ValueError(f"{field} contains a non-string key")
        if isinstance(item, (str, int, float, bool)) or item is None:
            normalized[key] = item
            continue
        raise ValueError(f"{field}.{key} must be a primitive value")
    return normalized


def _normalize_scenarios(scenarios: Any) -> list[dict[str, Any]]:
    if not isinstance(scenarios, list):
        raise ValueError("scenarios must be a list")
    if not scenarios:
        raise ValueError("scenarios cannot be empty")

    normalized: list[dict[str, Any]] = []
    for index, scenario in enumerate(scenarios):
        if not isinstance(scenario, dict):
            raise ValueError(f"scenarios[{index}] must be an object")
        intent = _normalize_string(scenario.get("intent"), field=f"scenarios[{index}].intent")
        difficulty = _normalize_string(scenario.get("difficulty"), field=f"scenarios[{index}].difficulty")
        tags = _normalize_string_list(scenario.get("tags", []), field=f"scenarios[{index}].tags", allow_empty=True)
        templates = _normalize_string_list(
            scenario.get("templates", []),
            field=f"scenarios[{index}].templates",
            allow_empty=False,
        )
        context = scenario.get("context", {})
        if not isinstance(context, dict):
            raise ValueError(f"scenarios[{index}].context must be an object")
        has_visible_report = context.get("has_visible_report")
        if not isinstance(has_visible_report, bool):
            raise ValueError(f"scenarios[{index}].context.has_visible_report must be a boolean")
        previous_report_summary = context.get("previous_report_summary", "")
        if not isinstance(previous_report_summary, str):
            raise ValueError(f"scenarios[{index}].context.previous_report_summary must be a string")
        dialogue_stage = _normalize_string(
            context.get("dialogue_stage"),
            field=f"scenarios[{index}].context.dialogue_stage",
        )
        language = _normalize_string(context.get("language"), field=f"scenarios[{index}].context.language")
        normalized_scenario = {
            "intent": intent,
            "difficulty": difficulty,
            "tags": tags,
            "context": {
                "has_visible_report": has_visible_report,
                "previous_report_summary": previous_report_summary.strip(),
                "dialogue_stage": dialogue_stage,
                "language": language,
            },
            "templates": templates,
        }
        generation_count = scenario.get("generation_count")
        if generation_count not in (None, ""):
            if not isinstance(generation_count, int) or generation_count <= 0:
                raise ValueError(f"scenarios[{index}].generation_count must be a positive integer")
            normalized_scenario["generation_count"] = generation_count
        normalized.append(normalized_scenario)
    return normalized


def _normalize_task_config_files(task_name: str, payload: TaskConfigFilesPayload) -> dict[str, Any]:
    task_section = payload.task
    if not isinstance(task_section, dict):
        raise ValueError("task must be an object")
    normalized_task = {
        "name": _normalize_string(task_section.get("name"), field="task.name"),
        "theme": _normalize_string(task_section.get("theme"), field="task.theme"),
        "language": _normalize_string(task_section.get("language"), field="task.language"),
        "task_type": _normalize_string(task_section.get("task_type"), field="task.task_type"),
        "entry_schema": _normalize_string(task_section.get("entry_schema"), field="task.entry_schema"),
    }
    if normalized_task["name"] != task_name:
        raise ValueError(f"task.name must match route task_name: {task_name}")

    return {
        "task": normalized_task,
        "runtime": _normalize_runtime(payload.runtime),
        "rules": _normalize_primitive_object(payload.rules, field="rules"),
        "exports": _normalize_primitive_object(payload.exports, field="exports"),
        "labels": _normalize_string_list(payload.labels, field="labels"),
        "scenarios": _normalize_scenarios(payload.scenarios),
        "generator_prompt": _normalize_prompt(payload.generator_prompt, field="generator_prompt"),
        "teacher_prompt": _normalize_prompt(payload.teacher_prompt, field="teacher_prompt"),
    }


def _save_task_config_files(task: TaskConfig, normalized: dict[str, Any]) -> None:
    config = read_yaml(task.config_path)
    config["name"] = normalized["task"]["name"]
    config["theme"] = normalized["task"]["theme"]
    config["language"] = normalized["task"]["language"]
    config["task_type"] = normalized["task"]["task_type"]
    config["entry_schema"] = normalized["task"]["entry_schema"]
    config["runtime"] = normalized["runtime"]
    config["rules"] = normalized["rules"]
    config["exports"] = normalized["exports"]

    write_yaml(task.config_path, config)
    write_yaml(task.path_for("labels"), {"labels": normalized["labels"]})
    write_yaml(task.path_for("scenario_matrix"), {"scenarios": normalized["scenarios"]})
    write_text(task.path_for("generator_prompt"), normalized["generator_prompt"])
    write_text(task.path_for("teacher_prompt"), normalized["teacher_prompt"])


def _load_review_records(run: TaskRun) -> tuple[str, Path, list[dict[str, Any]]]:
    review_results_path = run.path_for("review_results")
    review_candidates_path = run.path_for("review_candidates")

    if review_results_path.exists():
        return "review_results", review_results_path, read_jsonl(review_results_path)
    if review_candidates_path.exists():
        return "review_candidates", review_candidates_path, read_jsonl(review_candidates_path)
    return "missing", review_candidates_path, []


def _save_review_records(run: TaskRun, records: list[dict[str, Any]], reviewer: str | None) -> Path:
    normalized: list[dict[str, Any]] = []
    for record in records:
        item = dict(record)
        decision = item.get("review_decision", "pending")
        if decision == "accepted" and not item.get("reviewer_label"):
            item["reviewer_label"] = item.get("teacher_label")
        if decision != "pending":
            if reviewer and not item.get("reviewed_by"):
                item["reviewed_by"] = reviewer
            if not item.get("reviewed_at"):
                item["reviewed_at"] = review_utc_now()
        normalized.append(item)

    validate_review_records(normalized)
    target = run.path_for("review_results")
    write_jsonl(target, normalized)
    return target


def _run_command(command: str, task_run: TaskRun) -> Any:
    if command == "run-all":
        outputs: dict[str, Any] = {}
        outputs["generate"] = generate.run(task_run)
        outputs["classify"] = classify.run(task_run)
        outputs["filter-export"] = filter_export.run(task_run)
        outputs["review-export"] = review_export.run(task_run)
        return outputs
    if command not in COMMAND_HANDLERS:
        raise _http_404(f"Unsupported command: {command}")
    return COMMAND_HANDLERS[command](task_run)


def create_app(project_root: Path | None = None) -> FastAPI:
    resolved_root = (project_root or Path.cwd()).resolve()
    frontend_dir = resolved_root / "frontend"
    if not frontend_dir.exists():
        raise FileNotFoundError(f"Frontend directory not found: {frontend_dir}")

    load_dotenv(resolved_root / ".env")

    app = FastAPI(title="DataForge Workbench", version="0.1.0")
    app.state.project_root = resolved_root
    app.mount("/assets", StaticFiles(directory=str(frontend_dir)), name="assets")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/tasks")
    def list_tasks() -> dict[str, list[dict[str, Any]]]:
        return {"items": [_serialize_task(resolved_root, task_name) for task_name in discover_tasks(resolved_root)]}

    @app.get("/api/tasks/{task_name}")
    def get_task(task_name: str) -> dict[str, Any]:
        return _serialize_task(resolved_root, task_name)

    @app.get("/api/tasks/{task_name}/spec")
    def get_task_spec(task_name: str) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        return _serialize_task_spec(task)

    @app.get("/api/tasks/{task_name}/config-files")
    def get_task_config_files(task_name: str) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        return _serialize_task_config_files(task)

    @app.put("/api/tasks/{task_name}/config-files")
    def save_task_config_files(task_name: str, payload: TaskConfigFilesPayload) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        try:
            normalized = _normalize_task_config_files(task_name, payload)
            _save_task_config_files(task, normalized)
            updated_task = _load_task(resolved_root, task_name)
        except ValueError as exc:
            raise _http_400(str(exc)) from exc

        return {
            "ok": True,
            "config": _serialize_task_config_files(updated_task),
            "spec": _serialize_task_spec(updated_task),
        }

    @app.get("/api/tasks/{task_name}/runs")
    def list_runs(task_name: str) -> dict[str, list[dict[str, Any]]]:
        task = _load_task(resolved_root, task_name)
        return {"items": [_serialize_run(task, entry) for entry in _load_runs_index(task)]}

    @app.get("/api/tasks/{task_name}/runs/{run_id}")
    def get_run(task_name: str, run_id: str) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        entry = _find_run_entry(task, run_id)
        return _serialize_run(task, entry)

    @app.delete("/api/tasks/{task_name}/runs/{run_id}")
    def delete_run(task_name: str, run_id: str) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        remaining_runs = _delete_run(task, run_id)
        return {
            "ok": True,
            "deleted_run_id": run_id,
            "latest_run_id": remaining_runs[0]["run_id"] if remaining_runs else None,
            "items": [_serialize_run(task, entry) for entry in remaining_runs],
        }

    @app.post("/api/tasks/{task_name}/commands/{command}")
    def run_command(task_name: str, command: str, payload: CommandRequest) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        try:
            task_run = resolve_task_run(task, command=command, run_id=payload.run_id)
            result = _run_command(command, task_run)
            entry = _find_run_entry(task, task_run.run_id)
        except FileNotFoundError as exc:
            raise _http_400(str(exc)) from exc
        except ValueError as exc:
            raise _http_400(str(exc)) from exc

        return {
            "ok": True,
            "command": command,
            "run_id": task_run.run_id,
            "result": _to_jsonable(result),
            "run": _serialize_run(task, entry),
        }

    @app.get("/api/tasks/{task_name}/runs/{run_id}/artifacts/{artifact_key}")
    def get_artifact(
        task_name: str,
        run_id: str,
        artifact_key: str,
        limit: int = Query(default=200, ge=1, le=1000),
    ) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        _find_run_entry(task, run_id)
        if artifact_key not in RUN_ARTIFACT_PATHS:
            raise _http_404(f"Unknown artifact key: {artifact_key}")

        run = TaskRun(task=task, run_id=run_id)
        path = run.path_for(artifact_key)
        payload = _serialize_artifact_meta(run, artifact_key, RUN_ARTIFACT_PATHS[artifact_key])
        if not path.exists():
            return {**payload, "content": None, "truncated": False}

        if path.suffix == ".jsonl":
            rows = read_jsonl(path)
            return {
                **payload,
                "content": rows[:limit],
                "total_records": len(rows),
                "truncated": len(rows) > limit,
            }
        if path.suffix == ".json":
            return {**payload, "content": read_json(path), "truncated": False}

        text = read_text(path)
        max_chars = 20000
        return {
            **payload,
            "content": text[:max_chars],
            "total_chars": len(text),
            "truncated": len(text) > max_chars,
        }

    @app.get("/api/tasks/{task_name}/runs/{run_id}/review-records")
    def get_review_records(task_name: str, run_id: str) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        _find_run_entry(task, run_id)
        run = TaskRun(task=task, run_id=run_id)
        source, path, records = _load_review_records(run)
        return {
            "source": source,
            "path": str(path),
            "labels": _task_labels(task),
            "records": records,
            "summary": summarize_review_records(records),
        }

    @app.put("/api/tasks/{task_name}/runs/{run_id}/review-records")
    def save_review_records(task_name: str, run_id: str, payload: ReviewRecordsPayload) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        _find_run_entry(task, run_id)
        run = TaskRun(task=task, run_id=run_id)
        try:
            target = _save_review_records(run, payload.records, payload.reviewer)
        except ValueError as exc:
            raise _http_400(str(exc)) from exc

        records = read_jsonl(target)
        return {
            "ok": True,
            "path": str(target),
            "records": records,
            "summary": summarize_review_records(records),
        }

    @app.get("/", include_in_schema=False)
    def workbench() -> FileResponse:
        return FileResponse(frontend_dir / "index.html")

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="DataForge Web Workbench")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()

    app = create_app(Path(args.project_root))
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
