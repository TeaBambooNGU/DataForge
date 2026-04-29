from __future__ import annotations

from dataforge.core.logging_config import DEFAULT_LOG_ASYNC_ENABLED, DEFAULT_LOG_FORMAT, log_context


def test_log_context_redacts_sensitive_values() -> None:
    extra = log_context(
        "test.component",
        "start",
        task_name="task-1",
        run_id="run-1",
        api_key="sk-test-secret",
        nested={"token": "secret-token", "safe": "visible"},
    )

    assert DEFAULT_LOG_FORMAT == "text"
    assert DEFAULT_LOG_ASYNC_ENABLED is True
    assert extra["task_id"] == "task-1"
    assert extra["run_id"] == "run-1"
    assert extra["context"]["api_key"] == "[redacted]"
    assert extra["context"]["nested"]["token"] == "[redacted]"
    assert extra["context"]["nested"]["safe"] == "visible"
