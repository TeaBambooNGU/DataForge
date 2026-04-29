from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any
from urllib import error, request

from dataforge.core.io import read_text, read_yaml
from dataforge.core.registry import TaskConfig
from dataforge.providers.base import EvalProvider, GeneratorProvider, TeacherProvider


class OpenAICompatibleError(RuntimeError):
    pass


class RetryableOpenAICompatibleError(OpenAICompatibleError):
    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def _chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _models_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/models"):
        return normalized
    if normalized.endswith("/chat/completions"):
        return f"{normalized[: -len('/chat/completions')]}/models"
    if normalized.endswith("/v1"):
        return f"{normalized}/models"
    return f"{normalized}/models"


def _merge_optional_runtime_fields(payload: dict[str, Any], runtime: dict[str, Any]) -> dict[str, Any]:
    for field in ("seed", "top_p", "max_tokens", "presence_penalty", "frequency_penalty"):
        if field in runtime:
            payload[field] = runtime[field]
    extra_body = runtime.get("extra_body", {})
    if isinstance(extra_body, dict):
        payload.update(extra_body)
    if runtime.get("response_format_json_object"):
        payload["response_format"] = {"type": "json_object"}
    return payload


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


class OpenAICompatibleChatClient:
    def __init__(
        self,
        *,
        opener: Any | None = None,
        sleeper: Any | None = None,
    ) -> None:
        self._opener = opener or request.urlopen
        self._sleeper = sleeper or time.sleep

    def _request_once(self, runtime: dict[str, Any], messages: list[dict[str, str]]) -> str:
        api_key_env = runtime.get("api_key_env", "OPENAI_API_KEY")
        base_url_env = runtime.get("base_url_env", "OPENAI_BASE_URL")
        api_key = runtime.get("api_key") or os.environ.get(api_key_env)
        base_url = runtime.get("base_url") or os.environ.get(base_url_env) or "https://api.openai.com/v1"
        model = runtime.get("model")
        timeout = runtime.get("timeout_seconds", 60)

        if not api_key:
            raise OpenAICompatibleError(f"Missing API key. Set {api_key_env} or runtime.api_key.")
        if not model:
            raise OpenAICompatibleError("runtime.model is required for openai_compatible provider")

        payload = _merge_optional_runtime_fields(
            {
                "model": model,
                "messages": messages,
                "temperature": runtime.get("temperature", 0),
            },
            runtime,
        )
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            _chat_completions_url(base_url),
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with self._opener(req, timeout=timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            retry_after = _parse_retry_after(exc.headers.get("Retry-After")) if exc.headers else None
            message = f"HTTP {exc.code} from openai-compatible endpoint: {detail}"
            if exc.code in _retry_status_codes(runtime):
                raise RetryableOpenAICompatibleError(
                    f"{message} [retryable]"
                    if retry_after is None
                    else f"{message} [retryable after {retry_after}s]",
                    retry_after=retry_after,
                ) from exc
            raise OpenAICompatibleError(message) from exc
        except error.URLError as exc:
            raise RetryableOpenAICompatibleError(
                f"Failed to reach openai-compatible endpoint: {exc.reason}"
            ) from exc

        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise OpenAICompatibleError(f"Unexpected chat completion response: {data}") from exc

    def complete(self, runtime: dict[str, Any], messages: list[dict[str, str]]) -> str:
        max_retries = _default_retry_count(runtime)
        last_error: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                return self._request_once(runtime, messages)
            except RetryableOpenAICompatibleError as exc:
                last_error = exc
                if attempt >= max_retries:
                    break
                self._sleeper(_backoff_seconds(runtime, attempt, exc.retry_after))
        if last_error is not None:
            raise OpenAICompatibleError(str(last_error)) from last_error
        raise OpenAICompatibleError("OpenAI-compatible request failed without an explicit error")

    def _list_models_once(self, runtime: dict[str, Any]) -> list[dict[str, Any]]:
        api_key_env = runtime.get("api_key_env", "OPENAI_API_KEY")
        base_url_env = runtime.get("base_url_env", "OPENAI_BASE_URL")
        api_key = runtime.get("api_key") or os.environ.get(api_key_env)
        base_url = runtime.get("base_url") or os.environ.get(base_url_env) or "https://api.openai.com/v1"
        timeout = runtime.get("timeout_seconds", 60)

        if not api_key:
            raise OpenAICompatibleError(f"Missing API key. Set {api_key_env} or runtime.api_key.")

        req = request.Request(
            _models_url(base_url),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="GET",
        )
        try:
            with self._opener(req, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            retry_after = _parse_retry_after(exc.headers.get("Retry-After")) if exc.headers else None
            message = f"HTTP {exc.code} from openai-compatible endpoint: {detail}"
            if exc.code in _retry_status_codes(runtime):
                raise RetryableOpenAICompatibleError(
                    f"{message} [retryable]"
                    if retry_after is None
                    else f"{message} [retryable after {retry_after}s]",
                    retry_after=retry_after,
                ) from exc
            raise OpenAICompatibleError(message) from exc
        except error.URLError as exc:
            raise RetryableOpenAICompatibleError(
                f"Failed to reach openai-compatible endpoint: {exc.reason}"
            ) from exc

        items = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(items, list):
            raise OpenAICompatibleError(f"Unexpected models response: {payload}")

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
                    "created": item.get("created"),
                }
            )
        return models

    def list_models(self, runtime: dict[str, Any]) -> list[dict[str, Any]]:
        max_retries = _default_retry_count(runtime)
        last_error: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                return self._list_models_once(runtime)
            except RetryableOpenAICompatibleError as exc:
                last_error = exc
                if attempt >= max_retries:
                    break
                self._sleeper(_backoff_seconds(runtime, attempt, exc.retry_after))
        if last_error is not None:
            raise OpenAICompatibleError(str(last_error)) from last_error
        raise OpenAICompatibleError("OpenAI-compatible models request failed without an explicit error")


def _parse_json_payload(content: str) -> Any:
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise OpenAICompatibleError(f"Provider returned non-JSON content: {content}") from exc


def _parse_generator_payload(content: str) -> dict[str, Any]:
    try:
        payload = _parse_json_payload(content)
    except OpenAICompatibleError:
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
            raise OpenAICompatibleError(f"Provider returned non-JSON content: {content}") from exc
        return {"items": items}

    if isinstance(payload, dict):
        return payload
    raise OpenAICompatibleError(f"Generator response must be a JSON object: {payload}")


def _normalize_generator_items(payload: dict[str, Any]) -> list[Any]:
    items = payload.get("items")
    if isinstance(items, list):
        return items

    user_text = payload.get("user_text")
    if isinstance(user_text, list):
        return user_text
    if isinstance(user_text, str) and user_text.strip():
        return [user_text]

    raise OpenAICompatibleError(f"Generator response missing items list: {payload}")


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
        {
            "role": "user",
            "content": json.dumps(user_payload, ensure_ascii=False),
        },
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
        {
            "role": "user",
            "content": json.dumps(user_payload, ensure_ascii=False),
        },
    ]


def _build_eval_messages(task: TaskConfig, sample: dict[str, Any]) -> list[dict[str, str]]:
    return _build_teacher_messages(task, sample)


class OpenAICompatibleGeneratorProvider(GeneratorProvider):
    def __init__(self, client: OpenAICompatibleChatClient | None = None) -> None:
        self.client = client or OpenAICompatibleChatClient()

    def generate_samples(self, task: TaskConfig, scenarios: list[dict[str, Any]]) -> list[dict[str, Any]]:
        runtime = task.runtime.get("generator", {})
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


class OpenAICompatibleTeacherProvider(TeacherProvider):
    def __init__(self, client: OpenAICompatibleChatClient | None = None) -> None:
        self.client = client or OpenAICompatibleChatClient()

    def classify_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        runtime = task.runtime.get("teacher", {})
        content = self.client.complete(runtime, _build_teacher_messages(task, sample))
        try:
            payload = _parse_json_payload(content)
        except OpenAICompatibleError:
            return False, None, content, "invalid_teacher_output"

        action = payload.get("action")
        if not isinstance(action, str) or not action.strip():
            return False, None, content, "missing_action"
        return True, action.strip(), content, None


class OpenAICompatibleEvalProvider(EvalProvider):
    def __init__(self, client: OpenAICompatibleChatClient | None = None) -> None:
        self.client = client or OpenAICompatibleChatClient()

    def predict_sample(self, task: TaskConfig, sample: dict[str, Any]) -> tuple[bool, str | None, str, str | None]:
        runtime = task.runtime.get("eval", {})
        content = self.client.complete(runtime, _build_eval_messages(task, sample))
        try:
            payload = _parse_json_payload(content)
        except OpenAICompatibleError:
            return False, None, content, "invalid_eval_output"

        action = payload.get("action")
        if not isinstance(action, str) or not action.strip():
            return False, None, content, "missing_action"
        return True, action.strip(), content, None
