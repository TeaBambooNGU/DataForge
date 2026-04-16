from __future__ import annotations

import os
from pathlib import Path

from dataforge.core.io import read_json
from dataforge.core.registry import (
    create_task_run,
    create_task_scaffold,
    discover_tasks,
    load_task_config,
    resolve_task_run,
)
from dataforge.core.storage import (
    get_run,
    list_run_stages,
    list_runs,
    load_artifact_records,
    load_review_records,
    save_artifact_records,
    save_blob_artifact,
)
from dataforge.core.runtime_catalog import save_custom_runtime_providers
from dataforge.web.app import (
    GlobalLLMSettingsPayload,
    GlobalLLMProviderPayload,
    TaskCreatePayload,
    _delete_task,
    _build_runtime_catalog,
    _ensure_command_is_runnable,
    _load_review_records,
    _normalize_task_create_payload,
    _probe_llm_connection,
    _resolve_global_llm_runtime,
    _save_review_records,
    _save_global_llm_settings,
    _serialize_global_llm_settings,
    _serialize_run,
    _serialize_task_config_files,
)
from dataforge.providers.openai_compatible import OpenAICompatibleError
from dataforge.web.app import create_app


def _create_test_project(tmp_path: Path) -> Path:
    frontend_dist = tmp_path / "frontend" / "dist"
    frontend_dist.mkdir(parents=True)
    (frontend_dist / "index.html").write_text("<!doctype html><html><body>ok</body></html>", encoding="utf-8")
    config_dir = tmp_path / "tasks" / "report-intent-distill" / "configs"
    config_dir.mkdir(parents=True)
    (config_dir / "task.yaml").write_text(
        "\n".join(
            [
                "name: report-intent-distill",
                "theme: report_intent_classification",
                "language: zh",
                "task_type: classification",
                "entry_schema: conversation_action",
                "runtime: {}",
                "rules: {}",
                "exports: {}",
                "paths: {}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return tmp_path


def test_student_train_download_endpoint_returns_file(tmp_path: Path) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    run = create_task_run(task, "run-download-001")
    artifact_path = run.path_for("student_train")
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text('{"messages":[{"role":"user","content":"hi"}]}\n', encoding="utf-8")

    app = create_app(project_root)
    download_endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", "") == "/api/tasks/{task_name}/runs/{run_id}/artifacts/{artifact_key}/download"
    )
    response = download_endpoint(task.name, run.run_id, "student_train")

    assert Path(response.path) == artifact_path
    assert response.media_type == "application/x-ndjson"
    assert response.filename == "student_train.jsonl"


def test_serialize_run_exposes_eval_summary(tmp_path: Path) -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.project_root = tmp_path
    task.task_root = tmp_path / "report-intent-distill"
    run = create_task_run(task, "run-web-001")
    manifest = {
        "completed_at": "2026-04-04T00:00:00+00:00",
        "stats": {"sample_count": 12},
        "summary": {
            "sample_count": 12,
            "overall_accuracy": 0.9,
            "macro_f1": 0.88,
            "promptfoo_status": "ok",
        },
    }
    run.record_stage("eval", manifest, run.path_for("eval_manifest"))
    entry = {
        "run_id": run.run_id,
        "status": get_run(tmp_path, task_name=task.name, run_id=run.run_id)["status"],
        "created_at": get_run(tmp_path, task_name=task.name, run_id=run.run_id)["created_at"],
        "updated_at": get_run(tmp_path, task_name=task.name, run_id=run.run_id)["updated_at"],
        "last_stage": get_run(tmp_path, task_name=task.name, run_id=run.run_id)["last_stage"],
        "stages": {
            name: {
                "manifest_path": stage["manifest"].get("manifest_path"),
                "completed_at": stage["completed_at"],
                "stats": stage["stats"],
                "summary": stage["summary"],
            }
            for name, stage in list_run_stages(tmp_path, task_name=task.name, run_id=run.run_id).items()
        },
    }

    serialized = _serialize_run(task, entry)

    assert serialized["evaluation"] == manifest["summary"]
    assert any(artifact["key"] == "eval_result" for artifact in serialized["artifacts"])
    training_artifact = next(artifact for artifact in serialized["artifacts"] if artifact["key"] == "student_train")
    assert training_artifact["artifact_role"] == "final_sft_dataset"
    assert training_artifact["role_badge"]["label"] == "Final SFT Dataset"


def test_run_command_rejects_repeated_stage_for_existing_run(tmp_path: Path) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    run = create_task_run(task, "run-web-002")
    run.record_stage(
        "classify",
        {"completed_at": "2026-04-04T00:00:00+00:00", "stats": {"sample_count": 3}},
        run.path_for("classify_manifest"),
    )

    try:
        _ensure_command_is_runnable(task, "classify", run)
    except ValueError as exc:
        assert "already been completed" in str(exc)
    else:
        raise AssertionError("expected repeated classify command to be rejected")


def test_run_command_allows_new_run_commands_after_previous_runs(tmp_path: Path, monkeypatch) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    existing_run = create_task_run(task, "run-existing-001")
    generated_ids = iter(["run-new-001", "run-new-002"])
    monkeypatch.setattr("dataforge.core.registry.generate_run_id", lambda prefix="run": next(generated_ids))

    for command in ("generate", "run-all"):
        next_run = resolve_task_run(task, command=command)
        _ensure_command_is_runnable(task, command, next_run)
        assert next_run.run_id.startswith("run-")
        assert next_run.run_id != existing_run.run_id

    assert len(list_runs(project_root, task_name=task.name)) == 3


def test_review_records_helpers_persist_to_storage(tmp_path: Path) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    run = create_task_run(task, "run-review-001")
    review_candidates = [
        {
            "sample_id": "sample-1",
            "task_name": task.name,
            "user_text": "帮我改一下",
            "teacher_label": "rewrite_report",
            "review_decision": "pending",
            "reviewer_label": None,
            "review_comment": "",
            "reviewed_by": None,
            "reviewed_at": None,
            "context": {},
            "tags": [],
        }
    ]
    save_artifact_records(
        project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=run.run_id,
        artifact_key="review_candidates",
        records=review_candidates,
    )

    source, path, records = _load_review_records(run)
    assert source == "review_candidates"
    assert path == run.path_for("review_candidates")
    assert records == review_candidates

    target = _save_review_records(
        run,
        [
            {
                **review_candidates[0],
                "review_decision": "accepted",
            }
        ],
        "alice",
    )
    assert target == run.path_for("review_results")
    stored = load_review_records(project_root, task_name=task.name, run_id=run.run_id)
    assert stored[0]["reviewed_by"] == "alice"

    source, _, records = _load_review_records(run)
    assert source == "review_results"
    assert records[0]["review_decision"] == "accepted"


def test_artifact_endpoint_reads_records_from_sqlite_without_file(tmp_path: Path) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    run = create_task_run(task, "run-artifact-db-001")
    save_artifact_records(
        project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=run.run_id,
        artifact_key="raw_candidates",
        records=[{"id": "sample-1", "input": {"user_text": "你好"}}],
    )

    app = create_app(project_root)
    endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", "") == "/api/tasks/{task_name}/runs/{run_id}/artifacts/{artifact_key}"
    )
    payload = endpoint(task.name, run.run_id, "raw_candidates", 200)

    assert payload["kind"] == "jsonl"
    assert payload["total_records"] == 1
    assert payload["content"][0]["id"] == "sample-1"
    assert load_artifact_records(project_root, task_name=task.name, run_id=run.run_id, artifact_key="raw_candidates")[0]["id"] == "sample-1"


def test_artifact_endpoint_reads_blob_from_sqlite_without_file(tmp_path: Path) -> None:
    project_root = _create_test_project(tmp_path)
    task = load_task_config(project_root, "report-intent-distill")
    run = create_task_run(task, "run-artifact-db-002")
    save_blob_artifact(
        project_root,
        task_name=task.name,
        task_root=task.task_root,
        run_id=run.run_id,
        artifact_key="eval_result",
        payload={"metrics": {"overall_accuracy": 1.0}},
    )

    app = create_app(project_root)
    endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", "") == "/api/tasks/{task_name}/runs/{run_id}/artifacts/{artifact_key}"
    )
    payload = endpoint(task.name, run.run_id, "eval_result", 200)

    assert payload["kind"] == "json"
    assert payload["content"]["metrics"]["overall_accuracy"] == 1.0


def test_create_task_payload_uses_defaults_and_scaffold_is_discoverable(tmp_path: Path) -> None:
    normalized = _normalize_task_create_payload(TaskCreatePayload(task={"name": "custom-intent-task"}))
    created = create_task_scaffold(tmp_path, normalized)

    assert created.name == "custom-intent-task"
    assert created.runtime["generator"]["provider"] == "mock"
    assert created.path_for("promptfoo").exists()
    assert (tmp_path / "tasks" / "custom-intent-task" / "configs" / "task.yaml").exists()
    assert discover_tasks(tmp_path) == ["custom-intent-task"]


def test_create_task_scaffold_rejects_duplicate_task_name(tmp_path: Path) -> None:
    normalized = _normalize_task_create_payload(TaskCreatePayload(task={"name": "duplicate-task"}))

    create_task_scaffold(tmp_path, normalized)

    try:
        create_task_scaffold(tmp_path, normalized)
    except FileExistsError as exc:
        assert "Task already exists" in str(exc)
    else:
        raise AssertionError("expected duplicate task scaffold creation to fail")


def test_delete_task_removes_task_directory_and_updates_discovery(tmp_path: Path) -> None:
    first = create_task_scaffold(tmp_path, _normalize_task_create_payload(TaskCreatePayload(task={"name": "first-task"})))
    create_task_scaffold(tmp_path, _normalize_task_create_payload(TaskCreatePayload(task={"name": "second-task"})))

    remaining = _delete_task(first)

    assert remaining == ["second-task"]
    assert not (tmp_path / "tasks" / "first-task").exists()
    assert discover_tasks(tmp_path) == ["second-task"]


def test_runtime_catalog_exposes_provider_models_and_fields() -> None:
    catalog = _build_runtime_catalog()

    assert catalog["stages"] == ["generator", "teacher", "eval"]
    provider_names = [item["name"] for item in catalog["providers"]]
    assert provider_names == ["mock", "openai_compatible", "anthropic_compatible", "minimax"]
    openai_provider = next(item for item in catalog["providers"] if item["name"] == "openai_compatible")
    assert any(model["value"] == "gpt-5.3-codex" for model in openai_provider["models"]["generator"])
    assert "base_url_env" in openai_provider["provider_fields"]
    assert any(field["key"] == "temperature" for field in catalog["fields"])


def test_task_config_payload_contains_runtime_catalog(tmp_path: Path) -> None:
    normalized = _normalize_task_create_payload(TaskCreatePayload(task={"name": "catalog-task"}))
    task = create_task_scaffold(tmp_path, normalized)

    payload = _serialize_task_config_files(task)

    assert payload["runtime_catalog"]["stages"] == ["generator", "teacher", "eval"]
    minimax_provider = next(item for item in payload["runtime_catalog"]["providers"] if item["name"] == "minimax")
    assert any(model["value"] == "MiniMax-M2.7" for model in minimax_provider["models"]["teacher"])


def test_runtime_catalog_includes_custom_provider_alias(tmp_path: Path) -> None:
    save_custom_runtime_providers(
        tmp_path,
        [
            {
                "name": "qwen_relay",
                "label": "Qwen Relay",
                "description": "第三方 OpenAI 兼容入口",
                "badge": "custom",
                "implementation": "openai_compatible",
                "base_url_env": "QWEN_RELAY_BASE_URL",
                "api_key_env": "QWEN_RELAY_API_KEY",
                "default_model": "qwen-max",
            }
        ],
    )

    catalog = _build_runtime_catalog(tmp_path)

    qwen_provider = next(item for item in catalog["providers"] if item["name"] == "qwen_relay")
    assert qwen_provider["kind"] == "custom"
    assert qwen_provider["editable"] is True
    assert qwen_provider["implementation"] == "openai_compatible"
    assert qwen_provider["defaults"]["base_url_env"] == "QWEN_RELAY_BASE_URL"
    assert qwen_provider["models"]["generator"][0]["value"] == "qwen-max"


def test_global_llm_settings_serialization_masks_api_key(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "OPENAI_API_KEY=sk-test-openai",
                "OPENAI_BASE_URL=https://relay.example.com/v1",
                "DATAFORGE_OPENAI_MODEL=gpt-5.4",
                "",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-openai")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://relay.example.com/v1")
    monkeypatch.setenv("DATAFORGE_OPENAI_MODEL", "gpt-5.4")

    payload = _serialize_global_llm_settings(tmp_path)

    openai_provider = next(item for item in payload["providers"] if item["name"] == "openai_compatible")
    assert openai_provider["configured"] is True
    assert openai_provider["config"]["base_url"] == "https://relay.example.com/v1"
    assert openai_provider["config"]["default_model"] == "gpt-5.4"
    assert openai_provider["config"]["api_key"] == ""
    assert openai_provider["config"]["has_api_key"] is True
    assert openai_provider["config"]["api_key_masked"] == "sk-t…enai"


def test_global_llm_settings_serialization_includes_custom_provider(tmp_path: Path, monkeypatch) -> None:
    save_custom_runtime_providers(
        tmp_path,
        [
            {
                "name": "qwen_relay",
                "label": "Qwen Relay",
                "description": "第三方 OpenAI 兼容入口",
                "badge": "custom",
                "implementation": "openai_compatible",
                "base_url_env": "QWEN_RELAY_BASE_URL",
                "api_key_env": "QWEN_RELAY_API_KEY",
                "default_model": "qwen-max",
            }
        ],
    )
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "QWEN_RELAY_API_KEY=sk-qwen",
                "QWEN_RELAY_BASE_URL=https://relay.example.com/v1",
                "",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("QWEN_RELAY_API_KEY", "sk-qwen")
    monkeypatch.setenv("QWEN_RELAY_BASE_URL", "https://relay.example.com/v1")

    payload = _serialize_global_llm_settings(tmp_path)

    provider = next(item for item in payload["providers"] if item["name"] == "qwen_relay")
    assert provider["kind"] == "custom"
    assert provider["implementation"] == "openai_compatible"
    assert provider["env_keys"]["base_url_env"] == "QWEN_RELAY_BASE_URL"
    assert provider["config"]["default_model"] == "qwen-max"
    assert provider["config"]["has_api_key"] is True


def test_save_global_llm_settings_persists_to_dotenv(tmp_path: Path, monkeypatch) -> None:
    payload = GlobalLLMSettingsPayload(
        providers=[
            GlobalLLMProviderPayload(
                name="openai_compatible",
                base_url="https://relay.example.com/v1",
                api_key="sk-live-openai",
                default_model="gpt-5.4",
            )
        ]
    )
    saved = _save_global_llm_settings(tmp_path, payload)

    openai_provider = next(item for item in saved["providers"] if item["name"] == "openai_compatible")
    assert openai_provider["config"]["default_model"] == "gpt-5.4"
    env_text = (tmp_path / ".env").read_text(encoding="utf-8")
    assert "OPENAI_BASE_URL=https://relay.example.com/v1" in env_text
    assert "OPENAI_API_KEY=sk-live-openai" in env_text
    assert "DATAFORGE_OPENAI_MODEL=gpt-5.4" in env_text
    assert os.environ["OPENAI_API_KEY"] == "sk-live-openai"


def test_save_global_llm_settings_persists_custom_provider_catalog_and_env(tmp_path: Path, monkeypatch) -> None:
    payload = GlobalLLMSettingsPayload(
        providers=[
            GlobalLLMProviderPayload(
                name="qwen_relay",
                label="Qwen Relay",
                description="第三方 OpenAI 兼容入口",
                badge="custom",
                implementation="openai_compatible",
                base_url_env="QWEN_RELAY_BASE_URL",
                api_key_env="QWEN_RELAY_API_KEY",
                base_url="https://relay.example.com/v1",
                api_key="sk-qwen-live",
                default_model="qwen-max",
            )
        ]
    )

    saved = _save_global_llm_settings(tmp_path, payload)

    provider = next(item for item in saved["providers"] if item["name"] == "qwen_relay")
    assert provider["kind"] == "custom"
    assert provider["config"]["default_model"] == "qwen-max"
    assert provider["env_keys"]["api_key_env"] == "QWEN_RELAY_API_KEY"

    catalog_payload = read_json(tmp_path / ".dataforge" / "runtime_providers.json")
    assert catalog_payload["providers"][0]["implementation"] == "openai_compatible"
    assert catalog_payload["providers"][0]["default_model"] == "qwen-max"

    env_text = (tmp_path / ".env").read_text(encoding="utf-8")
    assert "QWEN_RELAY_BASE_URL=https://relay.example.com/v1" in env_text
    assert "QWEN_RELAY_API_KEY=sk-qwen-live" in env_text
    assert os.environ["QWEN_RELAY_API_KEY"] == "sk-qwen-live"


def test_save_global_llm_settings_persists_provider_model_overrides(tmp_path: Path) -> None:
    scanned_models = {
        "generator": [
            {"value": "gpt-5.4", "label": "gpt-5.4", "recommended": True},
            {"value": "gpt-5.2", "label": "gpt-5.2", "recommended": False},
        ],
        "teacher": [
            {"value": "gpt-5.4", "label": "gpt-5.4", "recommended": True},
        ],
        "eval": [
            {"value": "gpt-5.4", "label": "gpt-5.4", "recommended": True},
        ],
    }
    payload = GlobalLLMSettingsPayload(
        providers=[
            GlobalLLMProviderPayload(
                name="openai_compatible",
                api_key="sk-live-openai",
                default_model="gpt-5.4",
                models=scanned_models,
            )
        ]
    )

    saved = _save_global_llm_settings(tmp_path, payload)

    provider = next(item for item in saved["providers"] if item["name"] == "openai_compatible")
    assert provider["models"]["generator"][0]["value"] == "gpt-5.4"
    overrides_payload = read_json(tmp_path / ".dataforge" / "runtime_provider_models.json")
    assert overrides_payload["providers"]["openai_compatible"]["generator"][0]["value"] == "gpt-5.4"
    catalog = _build_runtime_catalog(tmp_path)
    openai_provider = next(item for item in catalog["providers"] if item["name"] == "openai_compatible")
    assert openai_provider["models"]["generator"][0]["value"] == "gpt-5.4"


def test_llm_connection_test_uses_existing_saved_secret_when_api_key_blank(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "OPENAI_API_KEY=sk-existing-openai",
                "OPENAI_BASE_URL=https://relay.example.com/v1",
                "DATAFORGE_OPENAI_MODEL=gpt-5.4",
                "",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "sk-existing-openai")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://relay.example.com/v1")
    monkeypatch.setenv("DATAFORGE_OPENAI_MODEL", "gpt-5.4")
    runtime = _resolve_global_llm_runtime(
        tmp_path,
        "openai_compatible",
        base_url=None,
        api_key=None,
        default_model=None,
    )

    assert runtime["api_key"] == "sk-existing-openai"
    assert runtime["base_url"] == "https://relay.example.com/v1"
    assert runtime["model"] == "gpt-5.4"


def test_llm_connection_test_supports_unsaved_custom_provider(tmp_path: Path) -> None:
    runtime = _resolve_global_llm_runtime(
        tmp_path,
        "xiaomi_model",
        implementation="openai_compatible",
        base_url_env="XIAOMI_MODEL_BASE_URL",
        api_key_env="XIAOMI_MODEL_API_KEY",
        base_url="https://api.xiaomimimo.com/v1",
        api_key="sk-xiaomi",
        default_model="gpt-5.4",
    )

    assert runtime["provider"] == "openai_compatible"
    assert runtime["base_url_env"] == "XIAOMI_MODEL_BASE_URL"
    assert runtime["api_key_env"] == "XIAOMI_MODEL_API_KEY"
    assert runtime["base_url"] == "https://api.xiaomimimo.com/v1"
    assert runtime["api_key"] == "sk-xiaomi"
    assert runtime["model"] == "gpt-5.4"


def test_probe_llm_connection_uses_runtime_provider_for_unsaved_custom_provider(monkeypatch) -> None:
    class _FakeOpenAIClient:
        complete_calls: list[dict[str, object]] = []

        def list_models(self, runtime: dict[str, object]) -> list[dict[str, object]]:
            return [{"id": "gpt-5.4", "created": 1740787200}]

        def complete(self, runtime: dict[str, object], messages: list[dict[str, str]]) -> str:
            self.complete_calls.append(runtime)
            return '{"status":"ok"}'

    monkeypatch.setattr("dataforge.web.app.OpenAICompatibleChatClient", _FakeOpenAIClient)

    result = _probe_llm_connection(
        "xiaomi_model",
        {
            "provider": "openai_compatible",
            "model": "gpt-5.4",
            "api_key": "sk-test",
            "base_url": "https://api.xiaomimimo.com/v1",
        },
    )

    assert result["ok"] is True
    assert result["implementation"] == "openai_compatible"
    assert _FakeOpenAIClient.complete_calls[0]["provider"] == "openai_compatible"


def test_probe_llm_connection_prefers_latest_generation_model_from_scan(monkeypatch) -> None:
    class _FakeOpenAIClient:
        complete_calls: list[dict[str, object]] = []

        def list_models(self, runtime: dict[str, object]) -> list[dict[str, object]]:
            return [
                {"id": "text-embedding-3-large", "created": 200},
                {"id": "gpt-5.4", "created": 150},
                {"id": "gpt-5.2", "created": 100},
            ]

        def complete(self, runtime: dict[str, object], messages: list[dict[str, str]]) -> str:
            self.complete_calls.append(runtime)
            return '{"status":"ok"}'

    monkeypatch.setattr("dataforge.web.app.OpenAICompatibleChatClient", _FakeOpenAIClient)

    result = _probe_llm_connection(
        "openai_compatible",
        {
            "provider": "openai_compatible",
            "model": "gpt-5.1",
            "api_key": "sk-test",
            "base_url": "https://relay.example.com/v1",
        },
    )

    assert result["ok"] is True
    assert result["latest_model"] == "gpt-5.4"
    assert result["model"] == "gpt-5.4"
    assert result["models"] == [
        {"value": "gpt-5.4", "label": "gpt-5.4", "recommended": True},
        {"value": "gpt-5.2", "label": "gpt-5.2", "recommended": False},
    ]
    assert _FakeOpenAIClient.complete_calls[0]["model"] == "gpt-5.4"


def test_probe_llm_connection_keeps_probe_success_when_model_scan_fails(monkeypatch) -> None:
    class _FakeOpenAIClient:
        def list_models(self, runtime: dict[str, object]) -> list[dict[str, object]]:
            raise OpenAICompatibleError("models endpoint unsupported")

        def complete(self, runtime: dict[str, object], messages: list[dict[str, str]]) -> str:
            return '{"status":"ok"}'

    monkeypatch.setattr("dataforge.web.app.OpenAICompatibleChatClient", _FakeOpenAIClient)

    result = _probe_llm_connection(
        "openai_compatible",
        {
            "provider": "openai_compatible",
            "model": "gpt-5.4",
            "api_key": "sk-test",
            "base_url": "https://relay.example.com/v1",
        },
    )

    assert result["ok"] is True
    assert result["model"] == "gpt-5.4"
    assert result["models"] == []
    assert result["latest_model"] is None
    assert "models endpoint unsupported" in result["models_error"]


def test_task_runtime_resolves_custom_provider_family_but_serializes_raw_alias(tmp_path: Path) -> None:
    normalized = _normalize_task_create_payload(TaskCreatePayload(task={"name": "alias-task"}))
    create_task_scaffold(tmp_path, normalized)
    save_custom_runtime_providers(
        tmp_path,
        [
            {
                "name": "qwen_relay",
                "label": "Qwen Relay",
                "description": "第三方 OpenAI 兼容入口",
                "badge": "custom",
                "implementation": "openai_compatible",
                "base_url_env": "QWEN_RELAY_BASE_URL",
                "api_key_env": "QWEN_RELAY_API_KEY",
                "default_model": "qwen-max",
            }
        ],
    )

    task_yaml = tmp_path / "tasks" / "alias-task" / "configs" / "task.yaml"
    task_yaml.write_text(
        "\n".join(
            [
                "name: alias-task",
                "theme: alias_task_theme",
                "language: zh",
                "task_type: classification",
                "entry_schema: conversation_action",
                "runtime:",
                "  generator:",
                "    provider: qwen_relay",
                "    model: qwen-max",
                "  teacher:",
                "    provider: mock",
                "    model: mock-teacher-v1",
                "  eval:",
                "    provider: mock",
                "    model: mock-eval-v1",
                "rules: {}",
                "exports: {}",
                "paths:",
                "  labels: tasks/alias-task/configs/labels.yaml",
                "  scenario_matrix: tasks/alias-task/configs/scenario_matrix.yaml",
                "  generator_prompt: tasks/alias-task/configs/generator_prompt.txt",
                "  teacher_prompt: tasks/alias-task/configs/teacher_prompt.txt",
                "  promptfoo: tasks/alias-task/configs/promptfoo.yaml",
                "",
            ]
        ),
        encoding="utf-8",
    )

    task = load_task_config(tmp_path, "alias-task")
    payload = _serialize_task_config_files(task)

    assert task.raw_runtime["generator"]["provider"] == "qwen_relay"
    assert task.runtime["generator"]["provider"] == "openai_compatible"
    assert task.runtime["generator"]["base_url_env"] == "QWEN_RELAY_BASE_URL"
    assert payload["runtime"]["generator"]["provider"] == "qwen_relay"
