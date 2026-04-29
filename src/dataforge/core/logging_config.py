from __future__ import annotations

import atexit
import json
import logging
import os
import queue
import sys
import traceback
from datetime import datetime, timezone
from logging.handlers import QueueHandler, QueueListener
from pathlib import Path
from typing import Any


DEFAULT_LOG_FORMAT = "text"
DEFAULT_LOG_ASYNC_ENABLED = True
_DEFAULT_SERVICE_NAME = "dataforge"
_DEFAULT_ENV = "dev"
_DEFAULT_INSTANCE_ID = "-"
_CONTEXT_FIELDS = (
    "service_name",
    "env",
    "instance_id",
    "trace_id",
    "task_id",
    "user_id",
    "run_id",
    "component",
    "event",
    "error_code",
    "context",
)
_SENSITIVE_TOKENS = ("api_key", "authorization", "bearer", "password", "secret", "token")
_configured = False
_listener: QueueListener | None = None


class _ContextDefaultsFilter(logging.Filter):
    def __init__(self, *, service_name: str, env: str, instance_id: str) -> None:
        super().__init__()
        self.service_name = service_name
        self.env = env
        self.instance_id = instance_id

    def filter(self, record: logging.LogRecord) -> bool:
        defaults = {
            "service_name": self.service_name,
            "env": self.env,
            "instance_id": self.instance_id,
            "trace_id": "-",
            "task_id": "-",
            "user_id": "-",
            "run_id": "-",
            "component": record.name,
            "event": "-",
            "error_code": "-",
            "context": {},
        }
        for key, value in defaults.items():
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


class _TextFormatter(logging.Formatter):
    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        timestamp = datetime.fromtimestamp(record.created, timezone.utc)
        return timestamp.isoformat()


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created, timezone.utc).isoformat()
        payload: dict[str, Any] = {
            "timestamp": timestamp,
            "level": record.levelname,
            "message": record.getMessage(),
            "service_name": getattr(record, "service_name", _DEFAULT_SERVICE_NAME),
            "env": getattr(record, "env", _DEFAULT_ENV),
            "instance_id": getattr(record, "instance_id", _DEFAULT_INSTANCE_ID),
            "trace_id": getattr(record, "trace_id", "-"),
            "task_id": getattr(record, "task_id", "-"),
            "user_id": getattr(record, "user_id", "-"),
            "run_id": getattr(record, "run_id", "-"),
            "component": getattr(record, "component", record.name),
            "event": getattr(record, "event", "-"),
            "error_code": getattr(record, "error_code", "-"),
            "context": _sanitize(getattr(record, "context", {})),
        }
        if record.exc_info:
            exc_type, exc_value, _ = record.exc_info
            payload.update(
                {
                    "error_type": exc_type.__name__ if exc_type else "-",
                    "error_message": str(exc_value) if exc_value else "-",
                    "stack_trace": "".join(traceback.format_exception(*record.exc_info)),
                }
            )
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)


class _DropWhenFullQueueHandler(QueueHandler):
    def enqueue(self, record: logging.LogRecord) -> None:
        try:
            self.queue.put_nowait(record)
        except queue.Full:
            return


def configure_logging(*, service_name: str = _DEFAULT_SERVICE_NAME, force: bool = False) -> None:
    global _configured, _listener

    if _configured and not force:
        return
    if _listener is not None:
        _listener.stop()
        _listener = None

    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    log_format = os.environ.get("LOG_FORMAT", DEFAULT_LOG_FORMAT).strip().lower()
    if log_format not in {"text", "json"}:
        log_format = DEFAULT_LOG_FORMAT
    async_enabled = _env_bool("LOG_ASYNC_ENABLED", DEFAULT_LOG_ASYNC_ENABLED)
    queue_maxsize = _env_int("LOG_QUEUE_MAXSIZE", 10000)
    app_env = os.environ.get("APP_ENV", _DEFAULT_ENV).strip() or _DEFAULT_ENV
    instance_id = os.environ.get("INSTANCE_ID", _DEFAULT_INSTANCE_ID).strip() or _DEFAULT_INSTANCE_ID

    output_handler = logging.StreamHandler(sys.stderr)
    output_handler.setLevel(level)
    output_handler.addFilter(
        _ContextDefaultsFilter(service_name=service_name, env=app_env, instance_id=instance_id)
    )
    if log_format == "json":
        output_handler.setFormatter(_JsonFormatter())
    else:
        output_handler.setFormatter(
            _TextFormatter(
                "%(asctime)s %(levelname)s service=%(service_name)s env=%(env)s "
                "component=%(component)s event=%(event)s task=%(task_id)s run=%(run_id)s "
                "error_code=%(error_code)s context=%(context)s message=%(message)s"
            )
        )

    root_logger = logging.getLogger()
    if force:
        root_logger.handlers.clear()
    root_logger.setLevel(level)

    if async_enabled:
        log_queue: queue.Queue[logging.LogRecord] = queue.Queue(maxsize=max(queue_maxsize, 1))
        queue_handler = _DropWhenFullQueueHandler(log_queue)
        queue_handler.setLevel(level)
        root_logger.addHandler(queue_handler)
        _listener = QueueListener(log_queue, output_handler, respect_handler_level=True)
        _listener.start()
        atexit.register(_stop_listener)
    else:
        root_logger.addHandler(output_handler)

    _configured = True


def log_context(
    component: str,
    event: str,
    *,
    task_name: str | None = None,
    run_id: str | None = None,
    error_code: str | None = None,
    **context: Any,
) -> dict[str, Any]:
    return {
        "component": component,
        "event": event,
        "task_id": task_name or "-",
        "run_id": run_id or "-",
        "error_code": error_code or "-",
        "context": _sanitize(context) if context else {},
    }


def task_run_context(
    task: Any,
    component: str,
    event: str,
    *,
    error_code: str | None = None,
    **context: Any,
) -> dict[str, Any]:
    return log_context(
        component,
        event,
        task_name=getattr(task, "name", None),
        run_id=getattr(task, "run_id", None),
        error_code=error_code,
        **context,
    )


def _stop_listener() -> None:
    global _listener
    if _listener is not None:
        _listener.stop()
        _listener = None


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            normalized_key = str(key)
            if _is_sensitive_key(normalized_key):
                sanitized[normalized_key] = "[redacted]"
            else:
                sanitized[normalized_key] = _sanitize(item)
        return sanitized
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize(item) for item in value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower()
    return any(token in normalized for token in _SENSITIVE_TOKENS)
