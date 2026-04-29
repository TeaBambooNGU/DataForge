from __future__ import annotations

import json
import os
import time
from typing import Any
from urllib import error, request

from dataforge.core.io import read_text, read_yaml
from dataforge.core.registry import TaskConfig
from dataforge.providers.base import EvalProvider, GeneratorProvider, TeacherProvider


class AnthropicCompatibleError(RuntimeError):
    pass


class RetryableAnthropicCompatibleError(AnthropicCompatibleError):
    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def _messages_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/messages"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/messages"
    return f"{normalized}/v1/messages"


def _models_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/models"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/models"
    return f"{normalized}/v1/models"


def _default_retry_count(runtime: dict[str, Any]) -> int:
    if "max_retries" in runtime:
        return int(runtime["max_retries"])
    policy = runtime.get("retry_policy", "default")
    if policy == "none":
        return 0
    if policy == "strict_json":
        return 2
    return 2


def _retry_status_codes(runtime: dict[str, Any]) -> set[int]:
    configured = runtime.get("retry_status_codes")
    if isinstance(configured, list):
        return {int(code) for code in configured}
    return {408, 409, 429, 500, 502, 503, 504}


def _backoff_seconds(runtime: dict[str, Any], attempt: int, retry_after: float | None = None) -> float:
    if retry_after is not None and retry_after > 0:
        return retry_after
    base = float(runtime.get("retry_backoff_seconds", 1.0))
    max_backoff = float(runtime.get("max_retry_backoff_seconds", 8.0))
    return min(base * (2 ** attempt), max_backoff)


def _parse_retry_after(header_value: str | None) -> float | None:
    if not header_value:
        return None
    try:
        value = float(header_value)
    except ValueError:
        return None
    return max(value, 0.0)


def _parse_json_payload(content: str) -> Any:
    normalized = content.strip()
    try:
        return json.loads(normalized)
    except json.JSONDecodeError as exc:
        if normalized.startswith("```") and normalized.endswith("```"):
            lines = normalized.splitlines()
            if len(lines) >= 3:
                candidate = "\n".join(lines[1:-1]).strip()
                if candidate.lower().startswith("json"):
                    candidate = candidate[4:].strip()
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    pass
        raise AnthropicCompatibleError(f"Provider returned non-JSON content: {content}") from exc


def _parse_generator_payload(content: str) -> dict[str, Any]:
    try:
        payload = _parse_json_payload(content)
    except AnthropicCompatibleError:
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        if not lines:
            raise
        items: list[dict[str, Any]] = []
        try:
            for line in lines:
                parsed = json.loads(line)
                if not isinstance(parsed, dict):
                    raise ValueError("generator line is not an object")
                items.append(parsed)
        except (json.JSONDecodeError, ValueError) as exc:
            raise AnthropicCompatibleError(f"Provider returned non-JSON content: {content}") from exc
        return {"items": items}

    if isinstance(payload, dict):
        return payload
    raise AnthropicCompatibleError(f"Generator response must be a JSON object: {payload}")


def _normalize_generator_items(payload: dict[str, Any]) -> list[Any]:
    items = payload.get("items")
    if isinstance(items, list):
        return items

    user_text = payload.get("user_text")
    if isinstance(user_text, list):
        return user_text
    if isinstance(user_text, str) and user_text.strip():
        return [user_text]

    raise AnthropicCompatibleError(f"Generator response missing items list: {payload}")


def _split_system_messages(messages: list[dict[str, str]]) -> tuple[str | None, list[dict[str, str]]]:
    system_parts: list[str] = []
    normalized_messages: list[dict[str, str]] = []
    for message in messages:
        role = message["role"]
        content = message["content"]
        if role == "system":
            system_parts.append(content)
            continue
        normalized_messages.append({"role": role, "content": content})
    system = "\n\n".join(system_parts) if system_parts else None
    return system, normalized_messages


def _extract_text_content(data: dict[str, Any]) -> str:
    content_blocks = data.get("content")
    if isinstance(content_blocks, str):
        return content_blocks
    if not isinstance(content_blocks, list):
        raise AnthropicCompatibleError(f"Unexpected messages response: {data}")

    texts = [
        block.get("text", "")
        for block in content_blocks
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    merged = "".join(texts).strip()
    if not merged:
        raise AnthropicCompatibleError(f"Unexpected messages response: {data}")
    return merged


def _build_generator_messages(task: TaskConfig, scenario: dict[str, Any]) -> list[dict[str, str]]:
    generator_prompt = read_text(task.path_for("generator_prompt")).strip()
    count = scenario.get("generation_count") or max(len(scenario.get("templates", [])), 1)
    user_payload = {
        "task_name": task.name,
        "theme": task.config["theme"],
        "intent": scenario["intent"],
        "difficulty": scenario["difficulty"],
        "tags": scenario.get("tags", []),
        "context": scenario["context"],
        "count": count,
        "style_references": scenario.get("templates", []),
        "response_schema": {
            "items": [
                {
                    "user_text": "string",
                }
            ]
        },
    }
    return [
        {"role": "system", "content": generator_prompt},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]


def _build_teacher_messages(task: TaskConfig, sample: dict[str, Any]) -> list[dict[str, str]]:
    teacher_prompt = read_text(task.path_for("teacher_prompt")).strip()
    labels = read_yaml(task.path_for("labels")).get("labels", [])
    user_payload = {
        "task_name": task.name,
        "labels": labels,
        "rules": task.rules,
        "context": sample["context"],
        "user_text": sample["input"]["user_text"],
        "response_schema": {"action": "one of labels"},
    }
    return [
        {"role": "system", "content": teacher_prompt},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]


def _build_eval_messages(task: TaskConfig, sample: dict[str, Any]) -> list[dict[str, str]]:
    return _build_teacher_messages(task, sample)


class AnthropicCompatibleClient:
    def __init__(
        self,
        *,
        opener: Any | None = None,
        sleeper: Any | None = None,
    ) -> None:
        self._opener = opener or request.urlopen
        self._sleeper = sleeper or time.sleep

    def _request_once(self, runtime: dict[str, Any], messages: list[dict[str, str]]) -> str:
        api_key_env = runtime.get("api_key_env", "ANTHROPIC_API_KEY")
        base_url_env = runtime.get("base_url_env", "ANTHROPIC_BASE_URL")
        api_key = runtime.get("api_key") or os.environ.get(api_key_env)
        base_url = runtime.get("base_url") or os.environ.get(base_url_env) or "https://api.anthropic.com/v1"
        model = runtime.get("model")
        timeout = runtime.get("timeout_seconds", 60)

        if not api_key:
            raise AnthropicCompatibleError(f"Missing API key. Set {api_key_env} or runtime.api_key.")
        if not model:
            raise AnthropicCompatibleError("runtime.model is required for anthropic_compatible provider")

        system, normalized_messages = _split_system_messages(messages)
        payload: dict[str, Any] = {
            "model": model,
            "messages": normalized_messages,
            "max_tokens": int(runtime.get("max_tokens", 1024)),
        }
        if system:
            payload["system"] = system
        if "temperature" in runtime:
            payload["temperature"] = runtime["temperature"]
        if "top_p" in runtime:
            payload["top_p"] = runtime["top_p"]
        if "stop_sequences" in runtime:
            payload["stop_sequences"] = runtime["stop_sequences"]
        extra_body = runtime.get("extra_body", {})
        if isinstance(extra_body, dict):
            payload.update(extra_body)

        body = json.dumps(payload).encode("utf-8")
        headers = {
            "x-api-key": api_key,
            "anthropic-version": runtime.get("anthropic_version", "2023-06-01"),
            "Content-Type": "application/json",
        }
        beta_header = runtime.get("anthropic_beta")
        if beta_header:
            headers["anthropic-beta"] = str(beta_header)
        req = request.Request(
            _messages_url(base_url),
            data=body,
            headers=headers,
            method="POST",
        )
        try:
            with self._opener(req, timeout=timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            retry_after = _parse_retry_after(exc.headers.get("Retry-After")) if exc.headers else None
            message = f"HTTP {exc.code} from anthropic-compatible endpoint: {detail}"
            if exc.code in _retry_status_codes(runtime):
                raise RetryableAnthropicCompatibleError(
                    f"{message} [retryable]"
                    if retry_after is None
                    else f"{message} [retryable after {retry_after}s]",
                    retry_after=retry_after,
                ) from exc
            raise AnthropicCompatibleError(message) from exc
        except error.URLError as exc:
            raise RetryableAnthropicCompatibleError(
                f"Failed to reach anthropic-compatible endpoint: {exc.reason}"
            ) from exc

        return _extract_text_content(data)

    def complete(self, runtime: dict[str, Any], messages: list[dict[str, str]]) -> str:
        max_retries = _default_retry_count(runtime)
        last_error: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                return self._request_once(runtime, messages)
            except RetryableAnthropicCompatibleError as exc:
                last_error = exc
                if attempt >= max_retries:
                    break
                self._sleeper(_backoff_seconds(runtime, attempt, exc.retry_after))
        if last_error is not None:
            raise AnthropicCompatibleError(str(last_error)) from last_error
        raise AnthropicCompatibleError("Anthropic-compatible request failed without an explicit error")

    def _list_models_once(self, runtime: dict[str, Any]) -> list[dict[str, Any]]:
        api_key_env = runtime.get("api_key_env", "ANTHROPIC_API_KEY")
        base_url_env = runtime.get("base_url_env", "ANTHROPIC_BASE_URL")
        api_key = runtime.get("api_key") or os.environ.get(api_key_env)
        base_url = runtime.get("base_url") or os.environ.get(base_url_env) or "https://api.anthropic.com/v1"
        timeout = runtime.get("timeout_seconds", 60)

        if not api_key:
            raise AnthropicCompatibleError(f"Missing API key. Set {api_key_env} or runtime.api_key.")

        headers = {
            "x-api-key": api_key,
            "anthropic-version": runtime.get("anthropic_version", "2023-06-01"),
            "Content-Type": "application/json",
        }
        beta_header = runtime.get("anthropic_beta")
        if beta_header:
            headers["anthropic-beta"] = str(beta_header)
        req = request.Request(
            _models_url(base_url),
            headers=headers,
            method="GET",
        )
        try:
            with self._opener(req, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            retry_after = _parse_retry_after(exc.headers.get("Retry-After")) if exc.headers else None
            message = f"HTTP {exc.code} from anthropic-compatible endpoint: {detail}"
            if exc.code in _retry_status_codes(runtime):
                raise RetryableAnthropicCompatibleError(
                    f"{message} [retryable]"
                    if retry_after is None
                    else f"{message} [retryable after {retry_after}s]",
                    retry_after=retry_after,
                ) from exc
            raise AnthropicCompatibleError(message) from exc
        except error.URLError as exc:
            raise RetryableAnthropicCompatibleError(
                f"Failed to reach anthropic-compatible endpoint: {exc.reason}"
            ) from exc

        items = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(items, list):
            raise AnthropicCompatibleError(f"Unexpected models response: {payload}")

        models: list[dict[str, Any]] = []
        for item in items:
            if isinstance(item, str):
                model_id = item.strip()
                if model_id:
                    models.append({"id": model_id})
                continue
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id", "")).strip()
            if not model_id:
                continue
            models.append(
                {
                    "id": model_id,
                    "display_name": str(item.get("display_name", "")).strip() or None,
                    "created_at": item.get("created_at"),
                }
            )
        return models

    def list_models(self, runtime: dict[str, Any]) -> list[dict[str, Any]]:
        max_retries = _default_retry_count(runtime)
        last_error: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                return self._list_models_once(runtime)
            except RetryableAnthropicCompatibleError as exc:
                last_error = exc
                if attempt >= max_retries:
                    break
                self._sleeper(_backoff_seconds(runtime, attempt, exc.retry_after))
        if last_error is not None:
            raise AnthropicCompatibleError(str(last_error)) from last_error
        raise AnthropicCompatibleError("Anthropic-compatible models request failed without an explicit error")


class AnthropicCompatibleGeneratorProvider(GeneratorProvider):
    def __init__(
        self,
        client: AnthropicCompatibleClient | None = None,
        *,
        default_api_key_env: str = "ANTHROPIC_API_KEY",
        default_base_url_env: str = "ANTHROPIC_BASE_URL",
    ) -> None:
        self.client = client or AnthropicCompatibleClient()
        self.default_api_key_env = default_api_key_env
        self.default_base_url_env = default_base_url_env

    def _runtime(self, task: TaskConfig) -> dict[str, Any]:
        runtime = dict(task.runtime.get("generator", {}))
        runtime.setdefault("api_key_env", self.default_api_key_env)
        runtime.setdefault("base_url_env", self.default_base_url_env)
        return runtime

    def generate_samples(self, task: TaskConfig, scenarios: list[dict[str, Any]]) -> list[dict[str, Any]]:
        runtime = self._runtime(task)
        samples: list[dict[str, Any]] = []
        counter = 1
        for scenario in scenarios:
            content = self.client.complete(runtime, _build_generator_messages(task, scenario))
            payload = _parse_generator_payload(content)
            for item in _normalize_generator_items(payload):
                if isinstance(item, str):
                    user_text = item.strip()
                elif isinstance(item, dict):
                    user_text = str(item.get("user_text", "")).strip()
                else:
                    user_text = ""
                if not user_text:
                    continue
                samples.append(
                    {
                        "id": f"{task.name}-{counter:06d}",
                        "task_name": task.name,
                        "theme": task.config["theme"],
                        "stage": "candidate",
                        "context": scenario["context"],
                        "input": {"user_text": user_text},
                        "metadata": {
                            "source": "synthetic",
                            "difficulty": scenario["difficulty"],
                            "tags": scenario.get("tags", []),
                            "label_hint": scenario["intent"],
                        },
                    }
                )
                counter += 1
        return samples


class AnthropicCompatibleTeacherProvider(TeacherProvider):
    def __init__(
        self,
        client: AnthropicCompatibleClient | None = None,
        *,
        default_api_key_env: str = "ANTHROPIC_API_KEY",
        default_base_url_env: str = "ANTHROPIC_BASE_URL",
    ) -> None:
        self.client = client or AnthropicCompatibleClient()
        self.default_api_key_env = default_api_key_env
        self.default_base_url_env = default_base_url_env

    def _runtime(self, task: TaskConfig) -> dict[str, Any]:
        runtime = dict(task.runtime.get("teacher", {}))
        runtime.setdefault("api_key_env", self.default_api_key_env)
        runtime.setdefault("base_url_env", self.default_base_url_env)
        return runtime

    def classify_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        runtime = self._runtime(task)
        content = self.client.complete(runtime, _build_teacher_messages(task, sample))
        try:
            payload = _parse_json_payload(content)
        except AnthropicCompatibleError:
            return False, None, content, "invalid_teacher_output"

        action = payload.get("action")
        if not isinstance(action, str) or not action.strip():
            return False, None, content, "missing_action"
        return True, action.strip(), content, None


class AnthropicCompatibleEvalProvider(EvalProvider):
    def __init__(
        self,
        client: AnthropicCompatibleClient | None = None,
        *,
        default_api_key_env: str = "ANTHROPIC_API_KEY",
        default_base_url_env: str = "ANTHROPIC_BASE_URL",
    ) -> None:
        self.client = client or AnthropicCompatibleClient()
        self.default_api_key_env = default_api_key_env
        self.default_base_url_env = default_base_url_env

    def _runtime(self, task: TaskConfig) -> dict[str, Any]:
        runtime = dict(task.runtime.get("eval", {}))
        runtime.setdefault("api_key_env", self.default_api_key_env)
        runtime.setdefault("base_url_env", self.default_base_url_env)
        return runtime

    def predict_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        runtime = self._runtime(task)
        content = self.client.complete(runtime, _build_eval_messages(task, sample))
        try:
            payload = _parse_json_payload(content)
        except AnthropicCompatibleError:
            return False, None, content, "invalid_eval_output"

        action = payload.get("action")
        if not isinstance(action, str) or not action.strip():
            return False, None, content, "missing_action"
        return True, action.strip(), content, None


class MiniMaxGeneratorProvider(AnthropicCompatibleGeneratorProvider):
    def __init__(self, client: AnthropicCompatibleClient | None = None) -> None:
        super().__init__(client, default_api_key_env="MINIMAX_API_KEY", default_base_url_env="MINIMAX_BASE_URL")


class MiniMaxTeacherProvider(AnthropicCompatibleTeacherProvider):
    def __init__(self, client: AnthropicCompatibleClient | None = None) -> None:
        super().__init__(client, default_api_key_env="MINIMAX_API_KEY", default_base_url_env="MINIMAX_BASE_URL")


class MiniMaxEvalProvider(AnthropicCompatibleEvalProvider):
    def __init__(self, client: AnthropicCompatibleClient | None = None) -> None:
        super().__init__(client, default_api_key_env="MINIMAX_API_KEY", default_base_url_env="MINIMAX_BASE_URL")
