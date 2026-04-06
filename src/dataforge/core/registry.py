from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any

from dataforge.core.io import read_json, read_yaml, utc_now, write_json, write_text, write_yaml
from dataforge.core.runtime_catalog import resolve_runtime_map


STATIC_PATH_KEYS = {"labels", "scenario_matrix", "generator_prompt", "teacher_prompt", "promptfoo"}
TASK_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
RUN_STATUS_ORDER = {
    "created": 0,
    "generated": 1,
    "classified": 2,
    "filtered": 3,
    "review_exported": 4,
    "review_validated": 5,
    "gold_built": 6,
    "evaluated": 7,
}
STAGE_TO_STATUS = {
    "generate": "generated",
    "classify": "classified",
    "filter_export": "filtered",
    "review_export": "review_exported",
    "validate_review": "review_validated",
    "build_gold": "gold_built",
    "eval": "evaluated",
}
RUN_ARTIFACT_PATHS = {
    "raw_candidates": "raw/raw_candidates.jsonl",
    "teacher_labeled": "raw/teacher_labeled.jsonl",
    "filtered_train": "processed/filtered_train.jsonl",
    "rejected_samples": "processed/rejected_samples.jsonl",
    "labelstudio_import": "processed/labelstudio_import.json",
    "review_candidates": "processed/review_candidates.jsonl",
    "review_results": "processed/review_results.jsonl",
    "gold_eval": "gold/gold_eval.jsonl",
    "hard_cases": "gold/hard_cases.jsonl",
    "train_export": "exports/train_dataset.jsonl",
    "train_export_metadata": "exports/train_dataset_metadata.json",
    "eval_export": "exports/eval_dataset.jsonl",
    "eval_export_metadata": "exports/eval_dataset_metadata.json",
    "eval_for_promptfoo": "exports/eval_for_promptfoo.jsonl",
    "eval_predictions": "exports/eval_predictions.jsonl",
    "student_train": "training/student_train.jsonl",
    "training_metadata": "training/metadata.json",
    "eval_result": "reports/eval_result.json",
    "hard_cases_metadata": "gold/hard_cases_metadata.json",
    "promptfoo_config": "reports/promptfoo/config.yaml",
    "promptfoo_results": "reports/promptfoo/results.json",
    "eval_summary": "reports/eval_summary.md",
    "confusion_analysis": "reports/confusion_analysis.md",
    "review_validation_report": "reports/review_validation.md",
    "generate_manifest": "reports/manifests/generate.json",
    "classify_manifest": "reports/manifests/classify.json",
    "filter_manifest": "reports/manifests/filter_export.json",
    "review_export_manifest": "reports/manifests/review_export.json",
    "review_validate_manifest": "reports/manifests/review_validate.json",
    "build_gold_manifest": "reports/manifests/build_gold.json",
    "eval_manifest": "reports/manifests/eval.json",
    "student_export_manifest": "reports/manifests/student_export.json",
}
DEFAULT_TASK_RUNTIME = {
    "generator": {
        "provider": "mock",
        "model": "mock-generator-v1",
        "temperature": 0,
        "max_tokens": 1024,
        "max_retries": 1,
        "retry_backoff_seconds": 1,
    },
    "teacher": {
        "provider": "mock",
        "model": "mock-teacher-v1",
        "temperature": 0,
        "max_tokens": 1024,
        "max_retries": 1,
        "retry_backoff_seconds": 1,
    },
    "eval": {
        "provider": "mock",
        "model": "mock-eval-v1",
        "temperature": 0,
        "max_tokens": 1024,
        "max_retries": 1,
        "retry_backoff_seconds": 1,
    },
}
DEFAULT_TASK_RULES = {"disallow_rewrite_without_visible_report": False}
DEFAULT_TASK_EXPORTS = {
    "train_format": "chatml_jsonl",
    "eval_format": "promptfoo_jsonl",
    "student_format": "chatml_jsonl",
}
DEFAULT_TASK_LABELS = ["primary_intent", "followup_request", "needs_clarification"]
DEFAULT_TASK_SCENARIOS = [
    {
        "intent": "primary_intent",
        "difficulty": "medium",
        "tags": ["custom", "bootstrap"],
        "context": {
            "has_visible_report": True,
            "previous_report_summary": "The user is asking about a newly defined task.",
            "dialogue_stage": "standalone",
            "language": "zh",
        },
        "templates": [
            "请围绕当前主题生成一条高质量中文样本。",
            "构造一条包含明确目标与约束的任务请求。",
        ],
        "generation_count": 2,
    }
]
DEFAULT_GENERATOR_PROMPT = """你是一个蒸馏数据生成器。

任务名: {task_name}
主题: {theme}
标签候选: {labels}

请根据给定 scenario 生成高质量用户输入样本，输出 JSON：
{{"items":[{{"user_text":"...", "label_hint":"...", "meta":{{}}}}]}}
"""
DEFAULT_TEACHER_PROMPT = """你是一个严格的标注教师。

任务名: {task_name}
主题: {theme}
可用标签: {labels}

请阅读输入并输出 JSON：
{{"label":"...", "reason":"...", "confidence":0.0}}
"""
DEFAULT_PROMPTFOO_CONFIG = {
    "description": "custom task promptfoo eval",
    "dataforge": {"command": ["promptfoo"]},
    "providers": ["echo"],
    "prompts": ["{{predicted_json}}"],
    "tests": "file://__DATAFORGE_EVAL_FOR_PROMPTFOO__",
}


@dataclass
class TaskConfig:
    name: str
    config: dict[str, Any]
    project_root: Path
    task_root: Path
    config_path: Path

    @property
    def raw_runtime(self) -> dict[str, Any]:
        return self.config.get("runtime", {})

    @property
    def runtime(self) -> dict[str, Any]:
        return resolve_runtime_map(self.project_root, self.raw_runtime)

    @property
    def rules(self) -> dict[str, Any]:
        return self.config.get("rules", {})

    @property
    def exports(self) -> dict[str, Any]:
        return self.config.get("exports", {})

    @property
    def resolved_paths(self) -> dict[str, Path]:
        paths = self.config.get("paths", {})
        return {key: (self.project_root / value).resolve() for key, value in paths.items()}

    def path_for(self, key: str) -> Path:
        try:
            return self.resolved_paths[key]
        except KeyError as exc:
            raise KeyError(f"Unknown path key: {key}") from exc


def validate_task_name(task_name: str) -> str:
    normalized = task_name.strip()
    if not normalized:
        raise ValueError("task.name cannot be empty")
    if not TASK_NAME_PATTERN.fullmatch(normalized):
        raise ValueError(
            "task.name must match ^[a-z0-9][a-z0-9_-]*$ so it can be used as a task directory name"
        )
    return normalized


def build_task_paths(task_name: str) -> dict[str, str]:
    task_name = validate_task_name(task_name)
    base = f"tasks/{task_name}/configs"
    return {
        "labels": f"{base}/labels.yaml",
        "scenario_matrix": f"{base}/scenario_matrix.yaml",
        "generator_prompt": f"{base}/generator_prompt.txt",
        "teacher_prompt": f"{base}/teacher_prompt.txt",
        "promptfoo": f"{base}/promptfoo.yaml",
    }


def build_default_task_definition(task_name: str) -> dict[str, Any]:
    task_name = validate_task_name(task_name)
    labels = list(DEFAULT_TASK_LABELS)
    return {
        "task": {
            "name": task_name,
            "theme": f"{task_name}_theme",
            "language": "zh",
            "task_type": "classification",
            "entry_schema": "conversation_action",
        },
        "runtime": {
            stage: dict(config)
            for stage, config in DEFAULT_TASK_RUNTIME.items()
        },
        "rules": dict(DEFAULT_TASK_RULES),
        "exports": dict(DEFAULT_TASK_EXPORTS),
        "labels": labels,
        "scenarios": [
            {
                **scenario,
                "tags": list(scenario.get("tags", [])),
                "context": dict(scenario.get("context", {})),
                "templates": list(scenario.get("templates", [])),
            }
            for scenario in DEFAULT_TASK_SCENARIOS
        ],
        "generator_prompt": DEFAULT_GENERATOR_PROMPT.format(
            task_name=task_name,
            theme=f"{task_name}_theme",
            labels=", ".join(labels),
        ),
        "teacher_prompt": DEFAULT_TEACHER_PROMPT.format(
            task_name=task_name,
            theme=f"{task_name}_theme",
            labels=", ".join(labels),
        ),
    }


def create_task_scaffold(project_root: Path, definition: dict[str, Any]) -> TaskConfig:
    task_name = validate_task_name(str(definition["task"]["name"]))
    task_root = (project_root / "tasks" / task_name).resolve()
    config_dir = task_root / "configs"
    config_path = config_dir / "task.yaml"
    if task_root.exists():
        raise FileExistsError(f"Task already exists or target directory is occupied: {task_root}")

    config_dir.mkdir(parents=True, exist_ok=False)
    (task_root / "runs").mkdir(parents=True, exist_ok=True)

    task_config = {
        "name": task_name,
        "theme": definition["task"]["theme"],
        "language": definition["task"]["language"],
        "task_type": definition["task"]["task_type"],
        "entry_schema": definition["task"]["entry_schema"],
        "runtime": definition["runtime"],
        "paths": build_task_paths(task_name),
        "rules": definition["rules"],
        "exports": definition["exports"],
    }

    write_yaml(config_path, task_config)
    write_yaml(config_dir / "labels.yaml", {"labels": definition["labels"]})
    write_yaml(config_dir / "scenario_matrix.yaml", {"scenarios": definition["scenarios"]})
    write_text(config_dir / "generator_prompt.txt", definition["generator_prompt"])
    write_text(config_dir / "teacher_prompt.txt", definition["teacher_prompt"])
    write_yaml(config_dir / "promptfoo.yaml", DEFAULT_PROMPTFOO_CONFIG)

    return load_task_config(project_root, task_name)


def discover_tasks(project_root: Path) -> list[str]:
    tasks_root = project_root / "tasks"
    if not tasks_root.exists():
        return []
    return sorted(
        path.parent.parent.name
        for path in tasks_root.glob("*/configs/task.yaml")
        if path.is_file()
    )


def load_task_config(project_root: Path, task_name: str) -> TaskConfig:
    config_path = project_root / "tasks" / task_name / "configs" / "task.yaml"
    if not config_path.exists():
        raise FileNotFoundError(f"Task config not found: {config_path}")

    config = read_yaml(config_path)
    if config.get("name") != task_name:
        raise ValueError(f"Task name mismatch: expected {task_name}, got {config.get('name')}")

    return TaskConfig(
        name=task_name,
        config=config,
        project_root=project_root.resolve(),
        task_root=(project_root / "tasks" / task_name).resolve(),
        config_path=config_path.resolve(),
    )


@dataclass
class TaskRun:
    task: TaskConfig
    run_id: str

    @property
    def name(self) -> str:
        return self.task.name

    @property
    def config(self) -> dict[str, Any]:
        return self.task.config

    @property
    def project_root(self) -> Path:
        return self.task.project_root

    @property
    def task_root(self) -> Path:
        return self.task.task_root

    @property
    def runtime(self) -> dict[str, Any]:
        return self.task.runtime

    @property
    def raw_runtime(self) -> dict[str, Any]:
        return self.task.raw_runtime

    @property
    def rules(self) -> dict[str, Any]:
        return self.task.rules

    @property
    def exports(self) -> dict[str, Any]:
        return self.task.exports

    @property
    def runs_root(self) -> Path:
        return self.task_root / "runs"

    @property
    def run_root(self) -> Path:
        return self.runs_root / self.run_id

    @property
    def latest_path(self) -> Path:
        return self.runs_root / "latest.json"

    @property
    def index_path(self) -> Path:
        return self.runs_root / "index.json"

    def path_for(self, key: str) -> Path:
        if key in STATIC_PATH_KEYS:
            return self.task.path_for(key)
        try:
            return (self.run_root / RUN_ARTIFACT_PATHS[key]).resolve()
        except KeyError as exc:
            raise KeyError(f"Unknown run artifact key: {key}") from exc

    def ensure_registered(self) -> None:
        self.runs_root.mkdir(parents=True, exist_ok=True)
        if not self.index_path.exists():
            write_json(self.index_path, {"runs": []})
        index = read_json(self.index_path)
        runs = index.setdefault("runs", [])
        if not any(entry["run_id"] == self.run_id for entry in runs):
            now = utc_now()
            runs.append(
                {
                    "run_id": self.run_id,
                    "task_name": self.name,
                    "run_root": str(self.run_root),
                    "created_at": now,
                    "updated_at": now,
                    "status": "created",
                    "last_stage": None,
                    "stages": {},
                }
            )
            write_json(self.index_path, index)
        else:
            for entry in runs:
                if entry["run_id"] != self.run_id:
                    continue
                require_entry_status(entry)
                break
        current = self.current_status()
        write_json(self.latest_path, {"run_id": self.run_id, "status": current or "created", "updated_at": utc_now()})

    def current_status(self) -> str | None:
        if not self.index_path.exists():
            return None
        index = read_json(self.index_path)
        for entry in index.get("runs", []):
            if entry["run_id"] == self.run_id:
                return require_entry_status(entry)
        return None

    def record_stage(self, stage_name: str, manifest: dict[str, Any], manifest_path: Path) -> None:
        self.ensure_registered()
        index = read_json(self.index_path)
        for entry in index.get("runs", []):
            if entry["run_id"] != self.run_id:
                continue
            entry["updated_at"] = utc_now()
            entry["last_stage"] = stage_name
            next_status = STAGE_TO_STATUS.get(stage_name, require_entry_status(entry))
            current_status = require_entry_status(entry)
            if RUN_STATUS_ORDER[next_status] >= RUN_STATUS_ORDER[current_status]:
                entry["status"] = next_status
            entry.setdefault("stages", {})[stage_name] = {
                "manifest_path": str(manifest_path),
                "completed_at": manifest.get("completed_at"),
                "stats": manifest.get("stats", {}),
                "summary": manifest.get("summary", {}),
            }
            break
        write_json(self.index_path, index)
        write_json(
            self.latest_path,
            {"run_id": self.run_id, "status": self.current_status() or "created", "updated_at": utc_now()},
        )


def generate_run_id(prefix: str = "run") -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"


def require_entry_status(entry: dict[str, Any]) -> str:
    status = entry.get("status")
    if status not in RUN_STATUS_ORDER:
        raise ValueError(f"Run entry {entry.get('run_id')} is missing a valid status")
    return status


def latest_run_id(task: TaskConfig) -> str | None:
    latest_path = task.task_root / "runs" / "latest.json"
    if not latest_path.exists():
        return None
    latest = read_json(latest_path)
    return latest.get("run_id")


def create_task_run(task: TaskConfig, run_id: str | None = None) -> TaskRun:
    run = TaskRun(task=task, run_id=run_id or generate_run_id())
    run.ensure_registered()
    return run


def resolve_task_run(task: TaskConfig, *, command: str, run_id: str | None = None) -> TaskRun:
    if run_id:
        return create_task_run(task, run_id)
    if command in {"generate", "run-all"}:
        return create_task_run(task)
    current = latest_run_id(task)
    if current is None:
        raise FileNotFoundError(
            f"No previous run found for task {task.name}. Run generate first or pass --run-id explicitly."
        )
    return create_task_run(task, current)
