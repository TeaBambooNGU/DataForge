from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from dataforge.core.io import read_json, write_json

RUNTIME_STAGE_ORDER = ("generator", "teacher", "eval")
RUNTIME_FIELD_CATALOG = [
    {
        "key": "temperature",
        "label": "Temperature",
        "type": "number",
        "step": 0.1,
        "min": 0,
        "max": 2,
        "bucket": "common",
    },
    {
        "key": "max_tokens",
        "label": "Max Tokens",
        "type": "number",
        "step": 1,
        "min": 1,
        "bucket": "common",
    },
    {
        "key": "max_retries",
        "label": "Max Retries",
        "type": "number",
        "step": 1,
        "min": 0,
        "bucket": "common",
    },
    {
        "key": "retry_backoff_seconds",
        "label": "Retry Backoff",
        "type": "number",
        "step": 0.5,
        "min": 0,
        "bucket": "common",
    },
    {
        "key": "max_retry_backoff_seconds",
        "label": "Max Retry Backoff",
        "type": "number",
        "step": 0.5,
        "min": 0,
        "bucket": "common",
    },
    {
        "key": "timeout_seconds",
        "label": "Timeout Seconds",
        "type": "number",
        "step": 1,
        "min": 1,
        "bucket": "common",
    },
    {
        "key": "base_url_env",
        "label": "Base URL Env",
        "type": "env-select",
        "bucket": "provider",
    },
    {
        "key": "api_key_env",
        "label": "API Key Env",
        "type": "env-select",
        "bucket": "provider",
    },
    {
        "key": "response_format_json_object",
        "label": "JSON Object Mode",
        "type": "boolean",
        "bucket": "provider",
    },
    {
        "key": "anthropic_version",
        "label": "Anthropic Version",
        "type": "text",
        "bucket": "provider",
    },
    {
        "key": "anthropic_beta",
        "label": "Anthropic Beta",
        "type": "text",
        "bucket": "provider",
    },
]
BUILTIN_RUNTIME_PROVIDER_CATALOG = {
    "mock": {
        "label": "Mock",
        "description": "本地假数据链路，用来快速验证任务与流程。",
        "badge": "local",
        "defaults": {
            "temperature": 0,
            "max_tokens": 1024,
            "max_retries": 1,
            "retry_backoff_seconds": 1,
        },
        "models": {
            "generator": [
                {"value": "mock-generator-v1", "label": "Mock Generator v1", "recommended": True},
            ],
            "teacher": [
                {"value": "mock-teacher-v1", "label": "Mock Teacher v1", "recommended": True},
            ],
            "eval": [
                {"value": "mock-eval-v1", "label": "Mock Eval v1", "recommended": True},
            ],
        },
        "provider_fields": [],
        "env_options": {},
        "implementation": "mock",
        "kind": "builtin",
        "editable": False,
    },
    "openai_compatible": {
        "label": "OpenAI Compatible",
        "description": "面向 OpenAI 风格 Chat Completions relay 的推荐配置。",
        "badge": "json-first",
        "defaults": {
            "temperature": 0,
            "max_tokens": 1024,
            "max_retries": 2,
            "retry_backoff_seconds": 1,
            "response_format_json_object": True,
            "base_url_env": "OPENAI_BASE_URL",
            "api_key_env": "OPENAI_API_KEY",
        },
        "models": {
            stage: [
                {"value": "gpt-5.3-codex", "label": "gpt-5.3-codex", "recommended": True},
                {"value": "gpt-5.4", "label": "gpt-5.4"},
                {"value": "gpt-5.2", "label": "gpt-5.2"},
            ]
            for stage in RUNTIME_STAGE_ORDER
        },
        "provider_fields": ["base_url_env", "api_key_env", "response_format_json_object"],
        "env_options": {
            "base_url_env": ["OPENAI_BASE_URL"],
            "api_key_env": ["OPENAI_API_KEY"],
        },
        "implementation": "openai_compatible",
        "kind": "builtin",
        "editable": False,
    },
    "anthropic_compatible": {
        "label": "Anthropic Compatible",
        "description": "面向 Anthropic Messages relay 的推荐配置。",
        "badge": "messages",
        "defaults": {
            "temperature": 0,
            "max_tokens": 1024,
            "max_retries": 2,
            "retry_backoff_seconds": 1,
            "base_url_env": "ANTHROPIC_BASE_URL",
            "api_key_env": "ANTHROPIC_API_KEY",
            "anthropic_version": "2023-06-01",
        },
        "models": {
            stage: [
                {"value": "claude-3-5-haiku-20241022", "label": "Claude 3.5 Haiku", "recommended": True},
                {"value": "claude-3-7-sonnet-20250219", "label": "Claude 3.7 Sonnet"},
            ]
            for stage in RUNTIME_STAGE_ORDER
        },
        "provider_fields": ["base_url_env", "api_key_env", "anthropic_version", "anthropic_beta"],
        "env_options": {
            "base_url_env": ["ANTHROPIC_BASE_URL"],
            "api_key_env": ["ANTHROPIC_API_KEY"],
        },
        "implementation": "anthropic_compatible",
        "kind": "builtin",
        "editable": False,
    },
    "minimax": {
        "label": "MiniMax",
        "description": "复用 Anthropic-compatible 实现，默认走 MiniMax 环境变量。",
        "badge": "relay",
        "defaults": {
            "temperature": 0,
            "max_tokens": 1024,
            "max_retries": 2,
            "retry_backoff_seconds": 1,
            "base_url_env": "MINIMAX_BASE_URL",
            "api_key_env": "MINIMAX_API_KEY",
        },
        "models": {
            stage: [
                {"value": "MiniMax-M2.7", "label": "MiniMax M2.7", "recommended": True},
                {"value": "MiniMax-M2.5", "label": "MiniMax M2.5"},
            ]
            for stage in RUNTIME_STAGE_ORDER
        },
        "provider_fields": ["base_url_env", "api_key_env"],
        "env_options": {
            "base_url_env": ["MINIMAX_BASE_URL"],
            "api_key_env": ["MINIMAX_API_KEY"],
        },
        "implementation": "minimax",
        "kind": "builtin",
        "editable": False,
    },
}
GLOBAL_LLM_MODEL_ENV_KEYS = {
    "mock": "DATAFORGE_MOCK_MODEL",
    "openai_compatible": "DATAFORGE_OPENAI_MODEL",
    "anthropic_compatible": "DATAFORGE_ANTHROPIC_MODEL",
    "minimax": "DATAFORGE_MINIMAX_MODEL",
}
CUSTOM_PROVIDER_CATALOG_RELATIVE_PATH = ".dataforge/runtime_providers.json"
RUNTIME_PROVIDER_MODELS_RELATIVE_PATH = ".dataforge/runtime_provider_models.json"


def custom_provider_catalog_path(project_root: Path) -> Path:
    return (project_root / CUSTOM_PROVIDER_CATALOG_RELATIVE_PATH).resolve()


def runtime_provider_models_path(project_root: Path) -> Path:
    return (project_root / RUNTIME_PROVIDER_MODELS_RELATIVE_PATH).resolve()


def normalize_provider_models(models: Any) -> dict[str, list[dict[str, Any]]]:
    if not isinstance(models, dict):
        return {}

    normalized: dict[str, list[dict[str, Any]]] = {}
    for stage in RUNTIME_STAGE_ORDER:
        stage_items = models.get(stage)
        if not isinstance(stage_items, list):
            continue
        entries: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in stage_items:
            if isinstance(item, str):
                value = item.strip()
                label = value
                recommended = False
            elif isinstance(item, dict):
                value = str(item.get("value", "")).strip()
                label = str(item.get("label", "")).strip() or value
                recommended = bool(item.get("recommended"))
            else:
                continue
            if not value or value in seen:
                continue
            seen.add(value)
            entries.append(
                {
                    "value": value,
                    "label": label,
                    "recommended": recommended,
                }
            )
        if entries:
            normalized[stage] = entries
    return normalized


def load_runtime_provider_model_overrides(project_root: Path) -> dict[str, dict[str, list[dict[str, Any]]]]:
    path = runtime_provider_models_path(project_root)
    if not path.exists():
        return {}
    payload = read_json(path)
    providers = payload.get("providers", {})
    if not isinstance(providers, dict):
        return {}
    normalized: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for provider_name, models in providers.items():
        key = str(provider_name).strip()
        if not key:
            continue
        stage_models = normalize_provider_models(models)
        if stage_models:
            normalized[key] = stage_models
    return normalized


def save_runtime_provider_model_overrides(
    project_root: Path,
    providers: dict[str, dict[str, list[dict[str, Any]]]],
) -> None:
    normalized: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for provider_name, models in providers.items():
        key = str(provider_name).strip()
        if not key:
            continue
        stage_models = normalize_provider_models(models)
        if stage_models:
            normalized[key] = stage_models
    write_json(runtime_provider_models_path(project_root), {"providers": normalized})


def recommended_provider_model(provider_meta: dict[str, Any], stage: str = "generator") -> str:
    models = provider_meta.get("models", {}).get(stage, [])
    for item in models:
        if item.get("recommended"):
            return str(item["value"])
    return str(models[0]["value"]) if models else ""


def load_custom_runtime_providers(project_root: Path) -> list[dict[str, Any]]:
    path = custom_provider_catalog_path(project_root)
    if not path.exists():
        return []
    payload = read_json(path)
    providers = payload.get("providers", [])
    return providers if isinstance(providers, list) else []


def save_custom_runtime_providers(project_root: Path, providers: list[dict[str, Any]]) -> None:
    write_json(custom_provider_catalog_path(project_root), {"providers": providers})


def runtime_provider_catalog(project_root: Path | None = None) -> dict[str, dict[str, Any]]:
    catalog = {name: deepcopy(meta) for name, meta in BUILTIN_RUNTIME_PROVIDER_CATALOG.items()}
    if project_root is None:
        return catalog

    for item in load_custom_runtime_providers(project_root):
        provider_name = str(item.get("name", "")).strip()
        implementation = str(item.get("implementation", "")).strip()
        if not provider_name or implementation not in BUILTIN_RUNTIME_PROVIDER_CATALOG:
            continue

        family_meta = deepcopy(BUILTIN_RUNTIME_PROVIDER_CATALOG[implementation])
        base_url_env = str(item.get("base_url_env", "")).strip() or family_meta["defaults"].get("base_url_env")
        api_key_env = str(item.get("api_key_env", "")).strip() or family_meta["defaults"].get("api_key_env")
        default_model = str(item.get("default_model", "")).strip() or recommended_provider_model(family_meta)
        family_meta["label"] = str(item.get("label", "")).strip() or provider_name
        family_meta["description"] = str(item.get("description", "")).strip() or family_meta["description"]
        family_meta["badge"] = str(item.get("badge", "")).strip() or "custom"
        family_meta["implementation"] = implementation
        family_meta["kind"] = "custom"
        family_meta["editable"] = True
        family_meta["defaults"]["base_url_env"] = base_url_env
        family_meta["defaults"]["api_key_env"] = api_key_env
        family_meta["env_options"] = {
            **family_meta.get("env_options", {}),
            "base_url_env": list(dict.fromkeys([*(family_meta.get("env_options", {}).get("base_url_env", [])), base_url_env])),
            "api_key_env": list(dict.fromkeys([*(family_meta.get("env_options", {}).get("api_key_env", [])), api_key_env])),
        }
        family_meta["models"] = {
            stage: [{"value": default_model, "label": default_model, "recommended": True}]
            for stage in RUNTIME_STAGE_ORDER
        }
        catalog[provider_name] = family_meta

    for provider_name, stage_models in load_runtime_provider_model_overrides(project_root).items():
        provider_meta = catalog.get(provider_name)
        if provider_meta is None:
            continue
        provider_meta["models"] = deepcopy(stage_models)
    return catalog


def build_runtime_catalog(project_root: Path | None = None) -> dict[str, Any]:
    catalog = runtime_provider_catalog(project_root)
    return {
        "stages": list(RUNTIME_STAGE_ORDER),
        "fields": deepcopy(RUNTIME_FIELD_CATALOG),
        "providers": [
            {
                "name": provider_name,
                **deepcopy(provider_meta),
            }
            for provider_name, provider_meta in catalog.items()
        ],
    }


def resolve_runtime_stage(project_root: Path, config: dict[str, Any]) -> dict[str, Any]:
    stage_config = dict(config or {})
    provider_name = str(stage_config.get("provider", "")).strip() or "mock"
    catalog = runtime_provider_catalog(project_root)
    provider_meta = catalog.get(provider_name)
    if provider_meta is None:
        return stage_config

    resolved = {
        **deepcopy(provider_meta.get("defaults", {})),
        **stage_config,
    }
    resolved["provider"] = provider_meta.get("implementation", provider_name)
    if not resolved.get("model"):
        resolved["model"] = recommended_provider_model(provider_meta)
    return resolved


def resolve_runtime_map(project_root: Path, runtime: dict[str, Any]) -> dict[str, Any]:
    return {
        stage: resolve_runtime_stage(project_root, runtime.get(stage, {}))
        for stage in RUNTIME_STAGE_ORDER
    }
