from __future__ import annotations

import argparse
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from dataforge.core.env import apply_env_updates, load_dotenv, read_dotenv, write_dotenv_updates
from dataforge.core.io import read_json, read_jsonl, read_text, read_yaml, utc_now, write_json, write_jsonl, write_text, write_yaml
from dataforge.core.registry import (
    RUN_ARTIFACT_PATHS,
    TaskConfig,
    TaskRun,
    build_default_task_definition,
    create_task_scaffold,
    discover_tasks,
    load_task_config,
    resolve_task_run,
    validate_task_name,
)
from dataforge.core.review import summarize_review_records, utc_now as review_utc_now, validate_review_records
from dataforge.core.runtime_catalog import (
    BUILTIN_RUNTIME_PROVIDER_CATALOG,
    GLOBAL_LLM_MODEL_ENV_KEYS,
    RUNTIME_STAGE_ORDER,
    build_runtime_catalog,
    load_custom_runtime_providers,
    load_runtime_provider_model_overrides,
    normalize_provider_models,
    recommended_provider_model,
    runtime_provider_catalog,
    save_custom_runtime_providers,
    save_runtime_provider_model_overrides,
)
from dataforge.core.storage import (
    delete_run as delete_run_from_storage,
    get_artifact_info,
    load_artifact_records,
    load_blob_artifact,
    load_review_records as load_review_records_from_storage,
    latest_run as latest_run_from_storage,
    list_run_stages,
    list_runs,
    save_review_records,
)
from dataforge.pipelines import build_gold, classify, eval as eval_pipeline, filter_export, generate, review_export, student_export, validate_review
from dataforge.providers.anthropic_compatible import AnthropicCompatibleClient, AnthropicCompatibleError
from dataforge.providers.openai_compatible import OpenAICompatibleChatClient, OpenAICompatibleError


COMMAND_HANDLERS = {
    "generate": generate.run,
    "classify": classify.run,
    "filter-export": filter_export.run,
    "review-export": review_export.run,
    "validate-review": validate_review.run,
    "build-gold": build_gold.run,
    "eval": eval_pipeline.run,
    "student-export": student_export.run,
}
NEW_RUN_COMMANDS = {"generate", "run-all"}
SUPPORTED_COMMANDS = set(COMMAND_HANDLERS) | {"run-all"}
CUSTOM_PROVIDER_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
ENV_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")
CUSTOM_PROVIDER_IMPLEMENTATIONS = tuple(name for name in BUILTIN_RUNTIME_PROVIDER_CATALOG if name != "mock")
DB_RECORD_ARTIFACT_KEYS = {
    "raw_candidates",
    "teacher_labeled",
    "filtered_train",
    "rejected_samples",
    "review_candidates",
    "gold_eval",
    "hard_cases",
    "eval_predictions",
}
DB_BLOB_ARTIFACT_KEYS = {
    "labelstudio_import",
    "train_export_metadata",
    "eval_export_metadata",
    "training_metadata",
    "eval_result",
    "hard_cases_metadata",
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


class TaskCreatePayload(BaseModel):
    task: dict[str, Any]
    runtime: dict[str, dict[str, Any]] | None = None
    rules: dict[str, Any] | None = None
    exports: dict[str, Any] | None = None
    labels: list[str] | None = None
    scenarios: list[dict[str, Any]] | None = None
    generator_prompt: str | None = None
    teacher_prompt: str | None = None


class GlobalLLMProviderPayload(BaseModel):
    name: str
    label: str | None = None
    description: str | None = None
    badge: str | None = None
    implementation: str | None = None
    base_url_env: str | None = None
    api_key_env: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    models: dict[str, list[dict[str, Any]]] | None = None


class GlobalLLMSettingsPayload(BaseModel):
    providers: list[GlobalLLMProviderPayload]


class GlobalLLMTestPayload(BaseModel):
    provider: str
    implementation: str | None = None
    base_url_env: str | None = None
    api_key_env: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    default_model: str | None = None


def _http_404(message: str) -> HTTPException:
    return HTTPException(status_code=404, detail=message)


def _http_400(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def _command_stage_key(command: str) -> str | None:
    if command in NEW_RUN_COMMANDS:
        return None
    if command in COMMAND_HANDLERS:
        return command.replace("-", "_")
    return None


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


def _normalize_optional_string(value: Any, *, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    normalized = value.strip()
    return normalized or None


def _normalize_provider_name(value: Any, *, field: str) -> str:
    normalized = _normalize_string(value, field=field)
    if not CUSTOM_PROVIDER_NAME_PATTERN.fullmatch(normalized):
        raise ValueError(f"{field} must match ^[a-z0-9][a-z0-9_-]*$")
    return normalized


def _normalize_env_key(value: Any, *, field: str, fallback: str | None = None) -> str | None:
    normalized = _normalize_optional_string(value, field=field)
    if normalized is None:
        return fallback
    normalized = normalized.upper()
    if not ENV_KEY_PATTERN.fullmatch(normalized):
        raise ValueError(f"{field} must match ^[A-Z][A-Z0-9_]*$")
    return normalized


def _default_custom_env_key(provider_name: str, suffix: str) -> str:
    return f"{provider_name.upper().replace('-', '_')}_{suffix}"


def _provider_catalog(project_root: Path | None = None) -> dict[str, dict[str, Any]]:
    return runtime_provider_catalog(project_root)


def _provider_env_keys(provider_name: str, *, provider_meta: dict[str, Any] | None = None) -> dict[str, str | None]:
    meta = provider_meta or _provider_catalog().get(provider_name) or {}
    defaults = meta.get("defaults", {})
    return {
        "base_url_env": defaults.get("base_url_env"),
        "api_key_env": defaults.get("api_key_env"),
        "model_env": GLOBAL_LLM_MODEL_ENV_KEYS.get(provider_name),
    }


def _effective_env_values(project_root: Path) -> dict[str, str]:
    env_path = project_root / ".env"
    file_values = read_dotenv(env_path)
    catalog = _provider_catalog(project_root)
    relevant_keys = {
        env_key
        for provider_name, provider_meta in catalog.items()
        for env_key in _provider_env_keys(provider_name, provider_meta=provider_meta).values()
        if env_key
    }
    for key in relevant_keys:
        value = os.environ.get(key)
        if value is not None:
            file_values[key] = value
    return file_values


def _mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}…{value[-4:]}"


def _serialize_global_llm_settings(project_root: Path) -> dict[str, Any]:
    env_values = _effective_env_values(project_root)
    catalog = _provider_catalog(project_root)
    providers: list[dict[str, Any]] = []
    for provider_name, provider_meta in catalog.items():
        env_keys = _provider_env_keys(provider_name, provider_meta=provider_meta)
        api_key = env_values.get(env_keys["api_key_env"]) if env_keys["api_key_env"] else None
        base_url = env_values.get(env_keys["base_url_env"]) if env_keys["base_url_env"] else None
        default_model = env_values.get(env_keys["model_env"]) if env_keys["model_env"] else None
        providers.append(
            {
                "name": provider_name,
                "label": provider_meta["label"],
                "description": provider_meta["description"],
                "badge": provider_meta.get("badge"),
                "implementation": provider_meta.get("implementation", provider_name),
                "kind": provider_meta.get("kind", "builtin"),
                "editable": bool(provider_meta.get("editable")),
                "models": provider_meta.get("models", {}),
                "configured": provider_name == "mock" or bool(api_key),
                "env_keys": env_keys,
                "config": {
                    "base_url": base_url,
                    "default_model": default_model or recommended_provider_model(provider_meta),
                    "api_key": "",
                    "has_api_key": bool(api_key),
                    "api_key_masked": _mask_secret(api_key),
                },
            }
        )
    return {"providers": providers}


def _normalize_global_llm_settings(project_root: Path, payload: GlobalLLMSettingsPayload) -> dict[str, list[dict[str, Any]]]:
    catalog = _provider_catalog(project_root)
    builtin_names = {
        provider_name
        for provider_name, provider_meta in catalog.items()
        if provider_meta.get("kind") == "builtin"
    }
    normalized: dict[str, list[dict[str, Any]]] = {"builtin": [], "custom": []}
    seen: set[str] = set()

    for item in payload.providers:
        provider_name = _normalize_provider_name(item.name, field="providers[].name")
        if provider_name in seen:
            raise ValueError(f"Duplicate provider in payload: {provider_name}")
        seen.add(provider_name)

        base_url = _normalize_optional_string(item.base_url, field=f"{provider_name}.base_url")
        api_key = _normalize_optional_string(item.api_key, field=f"{provider_name}.api_key")
        default_model = _normalize_optional_string(item.default_model, field=f"{provider_name}.default_model")
        provider_meta = catalog.get(provider_name)
        provider_models = normalize_provider_models(item.models if item.models is not None else (provider_meta or {}).get("models", {}))

        if provider_name in builtin_names:
            normalized["builtin"].append(
                {
                    "name": provider_name,
                    "base_url": base_url,
                    "api_key": api_key,
                    "default_model": default_model,
                    "models": provider_models,
                }
            )
            continue

        implementation = _normalize_optional_string(item.implementation, field=f"{provider_name}.implementation")
        if implementation is None and provider_meta and provider_meta.get("kind") == "custom":
            implementation = str(provider_meta.get("implementation", "")).strip() or None
        if implementation not in CUSTOM_PROVIDER_IMPLEMENTATIONS:
            raise ValueError(
                f"{provider_name}.implementation must be one of: {', '.join(CUSTOM_PROVIDER_IMPLEMENTATIONS)}"
            )

        implementation_meta = BUILTIN_RUNTIME_PROVIDER_CATALOG[implementation]
        previous_defaults = provider_meta.get("defaults", {}) if provider_meta else {}
        base_url_env = _normalize_env_key(
            item.base_url_env,
            field=f"{provider_name}.base_url_env",
            fallback=previous_defaults.get("base_url_env") or _default_custom_env_key(provider_name, "BASE_URL"),
        )
        api_key_env = _normalize_env_key(
            item.api_key_env,
            field=f"{provider_name}.api_key_env",
            fallback=previous_defaults.get("api_key_env") or _default_custom_env_key(provider_name, "API_KEY"),
        )
        label = _normalize_optional_string(item.label, field=f"{provider_name}.label") or (
            str(provider_meta.get("label", "")).strip() if provider_meta else provider_name
        )
        description = _normalize_optional_string(item.description, field=f"{provider_name}.description") or (
            str(provider_meta.get("description", "")).strip() if provider_meta else implementation_meta["description"]
        )
        badge = _normalize_optional_string(item.badge, field=f"{provider_name}.badge") or (
            str(provider_meta.get("badge", "")).strip() if provider_meta else "custom"
        )

        normalized["custom"].append(
            {
                "name": provider_name,
                "label": label,
                "description": description,
                "badge": badge,
                "implementation": implementation,
                "base_url_env": base_url_env,
                "api_key_env": api_key_env,
                "default_model": default_model or recommended_provider_model(implementation_meta),
                "base_url": base_url,
                "api_key": api_key,
                "models": provider_models,
            }
        )

    return normalized


def _save_global_llm_settings(project_root: Path, payload: GlobalLLMSettingsPayload) -> dict[str, Any]:
    normalized = _normalize_global_llm_settings(project_root, payload)
    env_path = project_root / ".env"
    current_values = _effective_env_values(project_root)
    catalog = _provider_catalog(project_root)
    existing_custom = {
        str(item.get("name", "")).strip(): item
        for item in load_custom_runtime_providers(project_root)
        if str(item.get("name", "")).strip()
    }
    existing_model_overrides = load_runtime_provider_model_overrides(project_root)
    next_custom = {item["name"]: item for item in normalized["custom"]}
    env_updates: dict[str, str | None] = {}
    model_overrides = dict(existing_model_overrides)

    for item in normalized["builtin"]:
        provider_name = item["name"]
        provider_meta = catalog.get(provider_name) or BUILTIN_RUNTIME_PROVIDER_CATALOG.get(provider_name, {})
        env_keys = _provider_env_keys(provider_name, provider_meta=provider_meta)
        base_url_env = env_keys["base_url_env"]
        api_key_env = env_keys["api_key_env"]
        model_env = env_keys["model_env"]

        if base_url_env:
            env_updates[base_url_env] = item["base_url"]
        if model_env:
            env_updates[model_env] = item["default_model"]
        if api_key_env and item["api_key"] is not None:
            env_updates[api_key_env] = item["api_key"]
        elif api_key_env and api_key_env not in current_values:
            env_updates[api_key_env] = None
        model_overrides[provider_name] = item["models"]

    for provider_name, item in next_custom.items():
        previous = existing_custom.get(provider_name, {})
        previous_base_url_env = str(previous.get("base_url_env", "")).strip() or None
        previous_api_key_env = str(previous.get("api_key_env", "")).strip() or None
        base_url_env = item["base_url_env"]
        api_key_env = item["api_key_env"]

        if previous_base_url_env and previous_base_url_env != base_url_env:
            env_updates[previous_base_url_env] = None
        if previous_api_key_env and previous_api_key_env != api_key_env:
            env_updates[previous_api_key_env] = None

        if base_url_env:
            migrated_base_url = (
                current_values.get(previous_base_url_env)
                if item["base_url"] is None and previous_base_url_env and previous_base_url_env != base_url_env
                else None
            )
            env_updates[base_url_env] = item["base_url"] if item["base_url"] is not None else migrated_base_url

        if api_key_env:
            migrated_api_key = (
                current_values.get(previous_api_key_env)
                if item["api_key"] is None and previous_api_key_env and previous_api_key_env != api_key_env
                else None
            )
            if item["api_key"] is not None:
                env_updates[api_key_env] = item["api_key"]
            elif migrated_api_key is not None:
                env_updates[api_key_env] = migrated_api_key
            elif api_key_env not in current_values:
                env_updates[api_key_env] = None
        model_overrides[provider_name] = item["models"]

    for provider_name, previous in existing_custom.items():
        if provider_name in next_custom:
            continue
        for env_key in (previous.get("base_url_env"), previous.get("api_key_env")):
            normalized_env_key = str(env_key).strip() if isinstance(env_key, str) else ""
            if normalized_env_key:
                env_updates[normalized_env_key] = None
    for provider_name in set(existing_model_overrides) - {
        *(item["name"] for item in normalized["builtin"]),
        *next_custom.keys(),
    }:
        model_overrides.pop(provider_name, None)

    save_custom_runtime_providers(
        project_root,
        [
            {
                "name": item["name"],
                "label": item["label"],
                "description": item["description"],
                "badge": item["badge"],
                "implementation": item["implementation"],
                "base_url_env": item["base_url_env"],
                "api_key_env": item["api_key_env"],
                "default_model": item["default_model"],
            }
            for item in normalized["custom"]
        ],
    )
    save_runtime_provider_model_overrides(project_root, model_overrides)
    write_dotenv_updates(env_path, env_updates)
    apply_env_updates(env_updates)
    return _serialize_global_llm_settings(project_root)


def _resolve_global_llm_runtime(
    project_root: Path,
    provider_name: str,
    *,
    implementation: str | None = None,
    base_url_env: str | None = None,
    api_key_env: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    default_model: str | None = None,
) -> dict[str, Any]:
    catalog = _provider_catalog(project_root)
    provider_meta = catalog.get(provider_name)
    resolved_implementation = implementation
    resolved_base_url_env = base_url_env
    resolved_api_key_env = api_key_env

    if provider_meta is None:
        if resolved_implementation not in CUSTOM_PROVIDER_IMPLEMENTATIONS:
            raise ValueError(f"Unsupported provider: {provider_name}")
        provider_meta = BUILTIN_RUNTIME_PROVIDER_CATALOG[resolved_implementation]
    else:
        resolved_implementation = resolved_implementation or str(provider_meta.get("implementation", provider_name))

    env_values = _effective_env_values(project_root)
    env_keys = _provider_env_keys(provider_name, provider_meta=provider_meta)
    if resolved_base_url_env is not None:
        env_keys["base_url_env"] = resolved_base_url_env
    if resolved_api_key_env is not None:
        env_keys["api_key_env"] = resolved_api_key_env
    resolved_base_url = base_url if base_url is not None else (env_values.get(env_keys["base_url_env"]) if env_keys["base_url_env"] else None)
    resolved_api_key = api_key if api_key is not None else (env_values.get(env_keys["api_key_env"]) if env_keys["api_key_env"] else None)
    resolved_model = default_model if default_model is not None else (
        env_values.get(env_keys["model_env"]) if env_keys["model_env"] else None
    )

    runtime = dict(provider_meta.get("defaults", {}))
    runtime["provider"] = resolved_implementation or provider_meta.get("implementation", provider_name)
    runtime["model"] = resolved_model or recommended_provider_model(provider_meta)
    runtime["temperature"] = 0
    runtime["max_tokens"] = 32
    runtime["max_retries"] = 0
    runtime["timeout_seconds"] = min(int(runtime.get("timeout_seconds", 15) or 15), 15)
    if env_keys["base_url_env"]:
        runtime["base_url_env"] = env_keys["base_url_env"]
    if env_keys["api_key_env"]:
        runtime["api_key_env"] = env_keys["api_key_env"]
    if resolved_base_url:
        runtime["base_url"] = resolved_base_url
    if resolved_api_key:
        runtime["api_key"] = resolved_api_key
    return runtime


def _runtime_endpoint(implementation: str, runtime: dict[str, Any]) -> str:
    if implementation == "openai_compatible":
        return runtime.get("base_url") or "https://api.openai.com/v1"
    if implementation in {"anthropic_compatible", "minimax"}:
        return runtime.get("base_url") or "https://api.anthropic.com/v1"
    return "local://mock"


def _parse_model_timestamp(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.isdigit():
        return int(normalized)
    try:
        return int(datetime.fromisoformat(normalized.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def _extract_model_date_token(model_id: str) -> int | None:
    match = re.search(r"(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)", model_id)
    if not match:
        return None
    try:
        parsed = datetime(
            year=int(match.group(1)),
            month=int(match.group(2)),
            day=int(match.group(3)),
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None
    return int(parsed.timestamp())


def _extract_model_version_token(model_id: str) -> tuple[int, ...] | None:
    match = re.search(r"(\d+(?:[.-]\d+){0,3})", model_id)
    if not match:
        return None
    parts: list[int] = []
    for chunk in re.split(r"[.-]", match.group(1)):
        if not chunk.isdigit():
            return None
        parts.append(int(chunk))
    return tuple(parts) if parts else None


def _model_sort_key(model_id: str, item: dict[str, Any], index: int) -> tuple[Any, ...]:
    timestamp = _parse_model_timestamp(item.get("created"))
    if timestamp is None:
        timestamp = _parse_model_timestamp(item.get("created_at"))
    if timestamp is not None:
        return (3, timestamp, -index)

    dated = _extract_model_date_token(model_id)
    if dated is not None:
        return (2, dated, -index)

    version = _extract_model_version_token(model_id)
    if version is not None:
        return (1, version, -index)

    return (0, -index)


def _is_generation_model(model_id: str) -> bool:
    normalized = model_id.lower()
    excluded_tokens = (
        "embedding",
        "embed",
        "moderation",
        "tts",
        "transcribe",
        "transcription",
        "whisper",
        "gpt-image",
        "dall-e",
        "omni-moderation",
        "audio-preview",
    )
    return not any(token in normalized for token in excluded_tokens)


def _normalize_discovered_models(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        model_id = str(item.get("id") or item.get("value") or "").strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        label = str(item.get("display_name") or item.get("name") or item.get("label") or model_id).strip() or model_id
        normalized.append(
            {
                "value": model_id,
                "label": label,
                "_sort_key": _model_sort_key(model_id, item, index),
                "_candidate": _is_generation_model(model_id),
            }
        )

    normalized.sort(key=lambda item: item["_sort_key"], reverse=True)
    display_items = [item for item in normalized if item["_candidate"]] or normalized
    latest_model = display_items[0]["value"] if display_items else None
    return (
        [
            {
                "value": item["value"],
                "label": item["label"],
                "recommended": item["value"] == latest_model,
            }
            for item in display_items
        ],
        latest_model,
    )


def _discover_runtime_models(implementation: str, runtime: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    if implementation == "openai_compatible":
        models = OpenAICompatibleChatClient().list_models(runtime)
        return _normalize_discovered_models(models)
    if implementation in {"anthropic_compatible", "minimax"}:
        models = AnthropicCompatibleClient().list_models(runtime)
        return _normalize_discovered_models(models)
    return ([], None)


def _probe_llm_connection(provider_name: str, runtime: dict[str, Any], *, project_root: Path | None = None) -> dict[str, Any]:
    provider_meta = _provider_catalog(project_root).get(provider_name) if project_root else _provider_catalog().get(provider_name)
    implementation = (
        str(runtime.get("provider", "")).strip()
        or (str(provider_meta.get("implementation", provider_name)) if provider_meta else provider_name)
    )
    started_at = time.perf_counter()
    endpoint = _runtime_endpoint(implementation, runtime)
    models: list[dict[str, Any]] = []
    latest_model: str | None = None
    models_error: str | None = None
    probe_runtime = dict(runtime)
    if implementation != "mock":
        try:
            models, latest_model = _discover_runtime_models(implementation, runtime)
        except (OpenAICompatibleError, AnthropicCompatibleError) as exc:
            models_error = str(exc)

    discovered_model_ids = {item["value"] for item in models}
    if latest_model and (not probe_runtime.get("model") or probe_runtime.get("model") not in discovered_model_ids):
        probe_runtime["model"] = latest_model

    try:
        if implementation == "mock":
            preview = "mock-ok"
        elif implementation == "openai_compatible":
            client = OpenAICompatibleChatClient()
            preview = client.complete(
                probe_runtime,
                [
                    {"role": "system", "content": 'Reply with JSON {"status":"ok"}.'},
                    {"role": "user", "content": "connection test"},
                ],
            )
        elif implementation in {"anthropic_compatible", "minimax"}:
            client = AnthropicCompatibleClient()
            preview = client.complete(
                probe_runtime,
                [
                    {"role": "system", "content": "Reply with OK."},
                    {"role": "user", "content": "connection test"},
                ],
            )
        else:
            raise ValueError(f"Unsupported provider: {implementation}")
    except (OpenAICompatibleError, AnthropicCompatibleError) as exc:
        return {
            "ok": False,
            "provider": provider_name,
            "implementation": implementation,
            "model": probe_runtime.get("model"),
            "latest_model": latest_model,
            "models": models,
            "endpoint": endpoint,
            "latency_ms": int((time.perf_counter() - started_at) * 1000),
            "error": str(exc),
        }

    result = {
        "ok": True,
        "provider": provider_name,
        "implementation": implementation,
        "model": probe_runtime.get("model"),
        "latest_model": latest_model,
        "models": models,
        "endpoint": endpoint,
        "latency_ms": int((time.perf_counter() - started_at) * 1000),
        "preview": str(preview).strip()[:120],
    }
    if models_error:
        result["models_error"] = models_error
    return result


def _load_runs_index(task: TaskConfig) -> list[dict[str, Any]]:
    runs = []
    for row in list_runs(task.project_root, task_name=task.name):
        stages = list_run_stages(task.project_root, task_name=task.name, run_id=row["run_id"])
        runs.append(
            {
                "run_id": row["run_id"],
                "task_name": task.name,
                "run_root": str((task.task_root / "runs" / row["run_id"]).resolve()),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "status": row["status"],
                "last_stage": row["last_stage"],
                "stages": {
                    stage_name: {
                        "manifest_path": stage_payload["manifest"].get("manifest_path"),
                        "completed_at": stage_payload["completed_at"],
                        "stats": stage_payload["stats"],
                        "summary": stage_payload["summary"],
                    }
                    for stage_name, stage_payload in stages.items()
                },
            }
        )
    return runs


def _find_run_entry(task: TaskConfig, run_id: str) -> dict[str, Any]:
    for entry in _load_runs_index(task):
        if entry.get("run_id") == run_id:
            return entry
    raise _http_404(f"Run not found: {run_id}")


def _delete_run(task: TaskConfig, run_id: str) -> list[dict[str, Any]]:
    runs = _load_runs_index(task)
    if not any(entry.get("run_id") == run_id for entry in runs):
        raise _http_404(f"Run not found: {run_id}")
    try:
        delete_run_from_storage(task.project_root, task_name=task.name, run_id=run_id)
    except FileNotFoundError as exc:
        raise _http_404(str(exc)) from exc
    run_root = task.task_root / "runs" / run_id
    if run_root.exists():
        shutil.rmtree(run_root)
    return _load_runs_index(task)


def _delete_task(task: TaskConfig) -> list[str]:
    task_root = task.task_root
    tasks_root = (task.project_root / "tasks").resolve()

    if not task_root.exists():
        raise _http_404(f"Task not found: {task.name}")
    if task_root.parent != tasks_root:
        raise _http_400(f"Refusing to delete task outside tasks root: {task_root}")

    shutil.rmtree(task_root)
    return discover_tasks(task.project_root)


def _artifact_kind(path: Path) -> str:
    if path.suffix == ".jsonl":
        return "jsonl"
    if path.suffix == ".json":
        return "json"
    return "text"


def _artifact_role_meta(artifact_key: str) -> dict[str, Any]:
    mapping = {
        "filtered_train": {
            "artifact_role": "canonical_dataset",
            "role_badge": {"label": "Canonical Dataset", "tone": "success"},
        },
        "train_export": {
            "artifact_role": "audit_export",
            "role_badge": {"label": "Audit Export", "tone": "warning"},
        },
        "train_export_metadata": {
            "artifact_role": "audit_metadata",
            "role_badge": {"label": "Audit Metadata", "tone": "warning"},
        },
        "student_train": {
            "artifact_role": "final_sft_dataset",
            "role_badge": {"label": "Final SFT Dataset", "tone": "success"},
        },
        "training_metadata": {
            "artifact_role": "final_sft_metadata",
            "role_badge": {"label": "Final SFT Metadata", "tone": "success"},
        },
    }
    return mapping.get(artifact_key, {"artifact_role": "general", "role_badge": None})


def _artifact_kind_for_key(path: Path, artifact_key: str) -> str:
    if artifact_key in DB_RECORD_ARTIFACT_KEYS or artifact_key == "review_results":
        return "jsonl"
    if artifact_key in DB_BLOB_ARTIFACT_KEYS:
        return "json"
    return _artifact_kind(path)


def _serialize_artifact_meta(run: TaskRun, artifact_key: str, relative_path: str) -> dict[str, Any]:
    path = run.path_for(artifact_key)
    path_exists = path.exists()
    db_info = get_artifact_info(
        run.project_root,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key=artifact_key,
    )
    db_exists = db_info is not None or (artifact_key == "review_results" and bool(load_review_records_from_storage(
        run.project_root,
        task_name=run.name,
        run_id=run.run_id,
    )))
    exists = path_exists or db_exists
    return {
        "key": artifact_key,
        "relative_path": relative_path,
        "absolute_path": str(path),
        "category": relative_path.split("/", 1)[0],
        "kind": _artifact_kind_for_key(path, artifact_key),
        "exists": exists,
        "size_bytes": path.stat().st_size if path_exists else 0,
        **_artifact_role_meta(artifact_key),
    }


def _serialize_run(task: TaskConfig, entry: dict[str, Any]) -> dict[str, Any]:
    run = TaskRun(task=task, run_id=entry["run_id"])
    artifacts = [
        _serialize_artifact_meta(run, artifact_key, relative_path)
        for artifact_key, relative_path in RUN_ARTIFACT_PATHS.items()
    ]
    eval_summary = entry.get("stages", {}).get("eval", {}).get("summary", {})
    return {
        "run_id": entry["run_id"],
        "status": entry.get("status"),
        "created_at": entry.get("created_at"),
        "updated_at": entry.get("updated_at"),
        "last_stage": entry.get("last_stage"),
        "stages": entry.get("stages", {}),
        "evaluation": eval_summary or None,
        "run_root": str(run.run_root),
        "artifacts": artifacts,
    }


def _task_labels(task: TaskConfig) -> list[str]:
    labels = read_yaml(task.path_for("labels"))
    return list(labels.get("labels", []))


def _serialize_task(project_root: Path, task_name: str) -> dict[str, Any]:
    task = _load_task(project_root, task_name)
    runs = _load_runs_index(task)
    return {
        "name": task.name,
        "theme": task.config.get("theme"),
        "language": task.config.get("language"),
        "task_type": task.config.get("task_type"),
        "labels": _task_labels(task),
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
        "runtime": task.raw_runtime,
        "rules": task.rules,
        "exports": task.exports,
        "labels": _task_labels(task),
        "paths": {key: str(value) for key, value in task.resolved_paths.items()},
        "scenarios": scenario_matrix.get("scenarios", []),
        "generator_prompt": read_text(task.path_for("generator_prompt")),
        "teacher_prompt": read_text(task.path_for("teacher_prompt")),
        "raw_config": task.config,
    }


def _build_runtime_catalog(project_root: Path | None = None) -> dict[str, Any]:
    return build_runtime_catalog(project_root)


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
        "runtime": task.raw_runtime,
        "rules": task.rules,
        "exports": task.exports,
        "labels": _task_labels(task),
        "paths": {key: str(value) for key, value in task.resolved_paths.items()},
        "scenarios": scenarios,
        "generator_prompt": read_text(task.path_for("generator_prompt")),
        "teacher_prompt": read_text(task.path_for("teacher_prompt")),
        "estimated_sample_count": sum(item["estimated_samples"] for item in scenario_estimates),
        "scenario_estimates": scenario_estimates,
        "runtime_catalog": _build_runtime_catalog(task.project_root),
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


def _normalize_task_create_payload(payload: TaskCreatePayload) -> dict[str, Any]:
    task_section = payload.task
    if not isinstance(task_section, dict):
        raise ValueError("task must be an object")

    task_name = validate_task_name(_normalize_string(task_section.get("name"), field="task.name"))
    defaults = build_default_task_definition(task_name)
    merged_task = {
        **defaults["task"],
        **{
            key: value
            for key, value in task_section.items()
            if key in {"name", "theme", "language", "task_type", "entry_schema"} and value is not None
        },
    }

    normalized_task = {
        "name": validate_task_name(_normalize_string(merged_task.get("name"), field="task.name")),
        "theme": _normalize_string(merged_task.get("theme"), field="task.theme"),
        "language": _normalize_string(merged_task.get("language"), field="task.language"),
        "task_type": _normalize_string(merged_task.get("task_type"), field="task.task_type"),
        "entry_schema": _normalize_string(merged_task.get("entry_schema"), field="task.entry_schema"),
    }

    runtime_payload = payload.runtime if payload.runtime is not None else defaults["runtime"]
    rules_payload = payload.rules if payload.rules is not None else defaults["rules"]
    exports_payload = payload.exports if payload.exports is not None else defaults["exports"]
    labels_payload = payload.labels if payload.labels is not None else defaults["labels"]
    scenarios_payload = payload.scenarios if payload.scenarios is not None else defaults["scenarios"]
    generator_prompt_payload = (
        payload.generator_prompt if payload.generator_prompt is not None else defaults["generator_prompt"]
    )
    teacher_prompt_payload = payload.teacher_prompt if payload.teacher_prompt is not None else defaults["teacher_prompt"]

    return {
        "task": normalized_task,
        "runtime": _normalize_runtime(runtime_payload),
        "rules": _normalize_primitive_object(rules_payload, field="rules"),
        "exports": _normalize_primitive_object(exports_payload, field="exports"),
        "labels": _normalize_string_list(labels_payload, field="labels"),
        "scenarios": _normalize_scenarios(scenarios_payload),
        "generator_prompt": _normalize_prompt(generator_prompt_payload, field="generator_prompt"),
        "teacher_prompt": _normalize_prompt(teacher_prompt_payload, field="teacher_prompt"),
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
    review_results = load_review_records_from_storage(run.project_root, task_name=run.name, run_id=run.run_id)

    if review_results:
        return "review_results", review_results_path, review_results
    review_candidates = load_artifact_records(
        run.project_root,
        task_name=run.name,
        run_id=run.run_id,
        artifact_key="review_candidates",
    )
    if review_candidates:
        return "review_candidates", review_candidates_path, review_candidates
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
    save_review_records(
        run.project_root,
        task_name=run.name,
        task_root=run.task_root,
        run_id=run.run_id,
        records=normalized,
    )
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


def _ensure_command_is_runnable(task: TaskConfig, command: str, task_run: TaskRun) -> None:
    if command not in SUPPORTED_COMMANDS:
        raise _http_404(f"Unsupported command: {command}")

    stage_key = _command_stage_key(command)
    if stage_key is None:
        return

    entry = _find_run_entry(task, task_run.run_id)
    if stage_key in entry.get("stages", {}):
        raise ValueError(
            f"Command {command} has already been completed for run {task_run.run_id}. "
            "Use generate or run-all to create a new run."
        )


def create_app(project_root: Path | None = None) -> FastAPI:
    resolved_root = (project_root or Path.cwd()).resolve()
    frontend_dir = resolved_root / "frontend"
    frontend_dist_dir = frontend_dir / "dist"
    if not frontend_dist_dir.exists():
        raise FileNotFoundError(
            f"Frontend build directory not found: {frontend_dist_dir}. "
            "Run `cd frontend && npm install && npm run build` first."
        )

    load_dotenv(resolved_root / ".env")

    app = FastAPI(title="DataForge Workbench", version="0.1.0")
    app.state.project_root = resolved_root
    app.mount("/assets", StaticFiles(directory=str(frontend_dist_dir)), name="assets")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/settings/llm")
    def get_global_llm_settings() -> dict[str, Any]:
        return _serialize_global_llm_settings(resolved_root)

    @app.put("/api/settings/llm")
    def save_global_llm_settings(payload: GlobalLLMSettingsPayload) -> dict[str, Any]:
        try:
            settings = _save_global_llm_settings(resolved_root, payload)
        except ValueError as exc:
            raise _http_400(str(exc)) from exc
        return {"ok": True, "settings": settings}

    @app.post("/api/settings/llm/test")
    def test_global_llm_connection(payload: GlobalLLMTestPayload) -> dict[str, Any]:
        try:
            provider_name = _normalize_provider_name(payload.provider, field="provider")
            runtime = _resolve_global_llm_runtime(
                resolved_root,
                provider_name,
                implementation=_normalize_optional_string(payload.implementation, field="implementation"),
                base_url_env=_normalize_env_key(payload.base_url_env, field="base_url_env"),
                api_key_env=_normalize_env_key(payload.api_key_env, field="api_key_env"),
                base_url=_normalize_optional_string(payload.base_url, field="base_url"),
                api_key=_normalize_optional_string(payload.api_key, field="api_key"),
                default_model=_normalize_optional_string(payload.default_model, field="default_model"),
            )
        except ValueError as exc:
            raise _http_400(str(exc)) from exc
        return _probe_llm_connection(provider_name, runtime, project_root=resolved_root)

    @app.get("/api/tasks")
    def list_tasks() -> dict[str, list[dict[str, Any]]]:
        return {"items": [_serialize_task(resolved_root, task_name) for task_name in discover_tasks(resolved_root)]}

    @app.post("/api/tasks")
    def create_task(payload: TaskCreatePayload) -> dict[str, Any]:
        try:
            normalized = _normalize_task_create_payload(payload)
            task = create_task_scaffold(resolved_root, normalized)
        except FileExistsError as exc:
            raise _http_400(str(exc)) from exc
        except ValueError as exc:
            raise _http_400(str(exc)) from exc

        return {
            "ok": True,
            "task": _serialize_task(resolved_root, task.name),
            "config": _serialize_task_config_files(task),
            "spec": _serialize_task_spec(task),
        }

    @app.get("/api/tasks/{task_name}")
    def get_task(task_name: str) -> dict[str, Any]:
        return _serialize_task(resolved_root, task_name)

    @app.delete("/api/tasks/{task_name}")
    def delete_task(task_name: str) -> dict[str, Any]:
        task = _load_task(resolved_root, task_name)
        remaining_tasks = _delete_task(task)
        return {
            "ok": True,
            "deleted_task_name": task_name,
            "next_task_name": remaining_tasks[0] if remaining_tasks else None,
            "items": [_serialize_task(resolved_root, name) for name in remaining_tasks],
        }

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
            if command not in SUPPORTED_COMMANDS:
                raise _http_404(f"Unsupported command: {command}")
            task_run = resolve_task_run(task, command=command, run_id=payload.run_id)
            _ensure_command_is_runnable(task, command, task_run)
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
        db_info = get_artifact_info(
            resolved_root,
            task_name=task_name,
            run_id=run_id,
            artifact_key=artifact_key,
        )
        if artifact_key == "review_results":
            records = load_review_records_from_storage(resolved_root, task_name=task_name, run_id=run_id)
            if records or get_artifact_info(resolved_root, task_name=task_name, run_id=run_id, artifact_key=artifact_key):
                return {
                    **payload,
                    "content": records[:limit],
                    "total_records": len(records),
                    "truncated": len(records) > limit,
                }
        elif db_info is not None and artifact_key in DB_RECORD_ARTIFACT_KEYS:
            records = load_artifact_records(
                resolved_root,
                task_name=task_name,
                run_id=run_id,
                artifact_key=artifact_key,
            )
            return {
                **payload,
                "content": records[:limit],
                "total_records": db_info["record_count"],
                "truncated": len(records) > limit,
            }
        elif db_info is not None and artifact_key in DB_BLOB_ARTIFACT_KEYS:
            return {
                **payload,
                "content": load_blob_artifact(
                    resolved_root,
                    task_name=task_name,
                    run_id=run_id,
                    artifact_key=artifact_key,
                ),
                "truncated": False,
            }

        if artifact_key in DB_RECORD_ARTIFACT_KEYS or artifact_key in DB_BLOB_ARTIFACT_KEYS or artifact_key == "review_results":
            return {**payload, "content": None, "truncated": False}

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

    @app.get("/api/tasks/{task_name}/runs/{run_id}/artifacts/{artifact_key}/download")
    def download_artifact(task_name: str, run_id: str, artifact_key: str) -> FileResponse:
        task = _load_task(resolved_root, task_name)
        _find_run_entry(task, run_id)
        if artifact_key != "student_train":
            raise _http_404(f"Download is not available for artifact: {artifact_key}")

        run = TaskRun(task=task, run_id=run_id)
        path = run.path_for(artifact_key)
        if not path.exists():
            raise _http_404(f"Artifact file not found: {artifact_key}")

        return FileResponse(
            path,
            media_type="application/x-ndjson",
            filename=path.name,
        )

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

        records = load_review_records_from_storage(resolved_root, task_name=task_name, run_id=run_id)
        return {
            "ok": True,
            "path": str(target),
            "records": records,
            "summary": summarize_review_records(records),
        }

    @app.get("/", include_in_schema=False)
    def workbench() -> FileResponse:
        return FileResponse(frontend_dist_dir / "index.html")

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
