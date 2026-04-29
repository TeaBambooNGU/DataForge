import io
import logging
from pathlib import Path
from urllib import error

from dataforge.core.registry import load_task_config
from dataforge.providers import get_eval_provider, get_generator_provider, get_teacher_provider
from dataforge.providers.anthropic_compatible import (
    AnthropicCompatibleClient,
    AnthropicCompatibleError,
    AnthropicCompatibleEvalProvider,
    AnthropicCompatibleGeneratorProvider,
    AnthropicCompatibleTeacherProvider,
    MiniMaxGeneratorProvider,
    _models_url as _anthropic_models_url,
    _messages_url,
)
from dataforge.providers.openai_compatible import (
    OpenAICompatibleChatClient,
    OpenAICompatibleError,
    OpenAICompatibleEvalProvider,
    OpenAICompatibleGeneratorProvider,
    OpenAICompatibleTeacherProvider,
    _chat_completions_url,
    _models_url as _openai_models_url,
)


def test_mock_generator_provider_returns_samples() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    provider = get_generator_provider("mock")
    scenarios = [
        {
            "intent": "chat",
            "difficulty": "easy",
            "tags": ["explicit_chat"],
            "context": {"has_visible_report": False},
            "templates": ["解释一下这个结论"],
        }
    ]
    samples = provider.generate_samples(task, scenarios)
    assert len(samples) == 1
    assert samples[0]["stage"] == "candidate"


def test_mock_teacher_provider_classifies() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    provider = get_teacher_provider("mock")
    parse_ok, label, _, error_code = provider.classify_sample(
        task,
        {
            "input": {"user_text": "按最新信息重跑一版"},
            "metadata": {"label_hint": "chat", "tags": []},
        },
    )
    assert parse_ok is True
    assert label == "regenerate_report"
    assert error_code is None


def test_provider_registry_supports_anthropic_compatible_and_minimax() -> None:
    assert isinstance(get_generator_provider("anthropic_compatible"), AnthropicCompatibleGeneratorProvider)
    assert isinstance(get_generator_provider("minimax"), MiniMaxGeneratorProvider)
    assert isinstance(get_teacher_provider("anthropic_compatible"), AnthropicCompatibleTeacherProvider)
    assert isinstance(get_eval_provider("anthropic_compatible"), AnthropicCompatibleEvalProvider)


def test_chat_completion_url_normalization() -> None:
    assert _chat_completions_url("https://relay.example.com/v1") == "https://relay.example.com/v1/chat/completions"
    assert _chat_completions_url("https://relay.example.com/v1/") == "https://relay.example.com/v1/chat/completions"
    assert (
        _chat_completions_url("https://relay.example.com/v1/chat/completions")
        == "https://relay.example.com/v1/chat/completions"
    )


def test_messages_url_normalization() -> None:
    assert _messages_url("https://relay.example.com") == "https://relay.example.com/v1/messages"
    assert _messages_url("https://relay.example.com/v1") == "https://relay.example.com/v1/messages"
    assert _messages_url("https://relay.example.com/v1/") == "https://relay.example.com/v1/messages"
    assert _messages_url("https://api.minimaxi.com/anthropic") == "https://api.minimaxi.com/anthropic/v1/messages"
    assert _messages_url("https://relay.example.com/v1/messages") == "https://relay.example.com/v1/messages"


def test_openai_models_url_normalization() -> None:
    assert _openai_models_url("https://relay.example.com/v1") == "https://relay.example.com/v1/models"
    assert _openai_models_url("https://relay.example.com/v1/") == "https://relay.example.com/v1/models"
    assert _openai_models_url("https://relay.example.com/v1/chat/completions") == "https://relay.example.com/v1/models"
    assert _openai_models_url("https://relay.example.com/v1/models") == "https://relay.example.com/v1/models"


def test_anthropic_models_url_normalization() -> None:
    assert _anthropic_models_url("https://relay.example.com") == "https://relay.example.com/v1/models"
    assert _anthropic_models_url("https://relay.example.com/v1") == "https://relay.example.com/v1/models"
    assert _anthropic_models_url("https://relay.example.com/v1/") == "https://relay.example.com/v1/models"
    assert _anthropic_models_url("https://relay.example.com/v1/models") == "https://relay.example.com/v1/models"


class _FakeClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[tuple[dict, list[dict[str, str]]]] = []

    def complete(self, runtime: dict, messages: list[dict[str, str]]) -> str:
        self.calls.append((runtime, messages))
        return self.responses.pop(0)


class _FakeHTTPResponse:
    def __init__(self, payload: str) -> None:
        self.payload = payload.encode("utf-8")

    def read(self) -> bytes:
        return self.payload

    def __enter__(self) -> "_FakeHTTPResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class _SequenceOpener:
    def __init__(self, responses: list[object]) -> None:
        self.responses = responses
        self.calls = 0

    def __call__(self, req, timeout=60):
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_openai_compatible_generator_provider_builds_samples() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "openai_compatible",
        "model": "relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
    }
    provider = OpenAICompatibleGeneratorProvider(
        client=_FakeClient(['{"items":[{"user_text":"请按最新数据重跑一版"}]}'])
    )
    samples = provider.generate_samples(
        task,
        [
            {
                "intent": "regenerate_report",
                "difficulty": "medium",
                "tags": ["latest_info_request"],
                "context": {"has_visible_report": True},
                "templates": ["按最新信息重跑一版"],
            }
        ],
    )
    assert len(samples) == 1
    assert samples[0]["input"]["user_text"] == "请按最新数据重跑一版"
    assert samples[0]["metadata"]["label_hint"] == "regenerate_report"


def test_openai_compatible_generator_provider_accepts_json_lines_payload() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "openai_compatible",
        "model": "relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
    }
    provider = OpenAICompatibleGeneratorProvider(
        client=_FakeClient(
            [
                '\n'.join(
                    [
                        '{"user_text":"帮我把这份新能源行业日报改得正式一点，像给老板汇报的版本，语气再专业一些。"}',
                        '{"user_text":"这份报告内容别变，但语气要调整得更正式，适合给领导看。"}',
                    ]
                )
            ]
        )
    )
    samples = provider.generate_samples(
        task,
        [
            {
                "intent": "rewrite_report",
                "difficulty": "medium",
                "tags": ["tone_adjustment"],
                "context": {"has_visible_report": True},
                "templates": ["帮我把日报改正式一些"],
            }
        ],
    )
    assert len(samples) == 2
    assert samples[0]["input"]["user_text"] == "帮我把这份新能源行业日报改得正式一点，像给老板汇报的版本，语气再专业一些。"
    assert samples[1]["input"]["user_text"] == "这份报告内容别变，但语气要调整得更正式，适合给领导看。"


def test_openai_compatible_generator_provider_accepts_single_user_text_payload() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "openai_compatible",
        "model": "relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
    }
    provider = OpenAICompatibleGeneratorProvider(
        client=_FakeClient(['{"user_text":"按最新信息重跑一版半导体板块的晨报，刚才那份有点旧了。"}'])
    )
    samples = provider.generate_samples(
        task,
        [
            {
                "intent": "regenerate_report",
                "difficulty": "medium",
                "tags": ["latest_info_request"],
                "context": {"has_visible_report": True},
                "templates": ["按最新信息重跑一版"],
            }
        ],
    )
    assert len(samples) == 1
    assert samples[0]["input"]["user_text"] == "按最新信息重跑一版半导体板块的晨报，刚才那份有点旧了。"


def test_openai_compatible_teacher_provider_parses_action() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["teacher"] = {
        "provider": "openai_compatible",
        "model": "relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
    }
    provider = OpenAICompatibleTeacherProvider(client=_FakeClient(['{"action":"chat"}']))
    parse_ok, label, raw_output, error_code = provider.classify_sample(
        task,
        {
            "context": {"has_visible_report": False},
            "input": {"user_text": "这是什么意思"},
        },
    )
    assert parse_ok is True
    assert label == "chat"
    assert raw_output == '{"action":"chat"}'
    assert error_code is None


def test_openai_compatible_teacher_provider_marks_invalid_json() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["teacher"] = {
        "provider": "openai_compatible",
        "model": "relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
    }
    provider = OpenAICompatibleTeacherProvider(client=_FakeClient(["not-json"]))
    parse_ok, label, raw_output, error_code = provider.classify_sample(
        task,
        {
            "context": {"has_visible_report": False},
            "input": {"user_text": "这是什么意思"},
        },
    )
    assert parse_ok is False
    assert label is None
    assert raw_output == "not-json"
    assert error_code == "invalid_teacher_output"


def test_openai_compatible_eval_provider_parses_action() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["eval"] = {
        "provider": "openai_compatible",
        "model": "relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
    }
    provider = OpenAICompatibleEvalProvider(client=_FakeClient(['{"action":"rewrite_report"}']))
    parse_ok, label, raw_output, error_code = provider.predict_sample(
        task,
        {
            "context": {"has_visible_report": True},
            "input": {"user_text": "帮我润色一下"},
        },
    )
    assert parse_ok is True
    assert label == "rewrite_report"
    assert raw_output == '{"action":"rewrite_report"}'
    assert error_code is None


def test_anthropic_compatible_generator_provider_builds_samples() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
        "max_tokens": 256,
    }
    provider = AnthropicCompatibleGeneratorProvider(
        client=_FakeClient(['{"items":[{"user_text":"请用最新口径生成一版"}]}'])
    )
    samples = provider.generate_samples(
        task,
        [
            {
                "intent": "regenerate_report",
                "difficulty": "medium",
                "tags": ["latest_info_request"],
                "context": {"has_visible_report": True},
                "templates": ["按最新信息重跑一版"],
            }
        ],
    )
    assert len(samples) == 1
    assert samples[0]["input"]["user_text"] == "请用最新口径生成一版"
    assert provider.client.calls[0][0]["max_tokens"] == 256


def test_anthropic_compatible_generator_provider_accepts_fenced_json_and_string_items() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
        "max_tokens": 256,
    }
    provider = AnthropicCompatibleGeneratorProvider(
        client=_FakeClient(['```json\n{"items":["请帮我解释一下这个指标"]}\n```'])
    )
    samples = provider.generate_samples(
        task,
        [
            {
                "intent": "chat",
                "difficulty": "easy",
                "tags": ["explicit_chat"],
                "context": {"has_visible_report": False},
                "templates": ["解释一下这个结论"],
            }
        ],
    )
    assert len(samples) == 1
    assert samples[0]["input"]["user_text"] == "请帮我解释一下这个指标"


def test_anthropic_compatible_generator_provider_accepts_user_text_list_payload() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
        "max_tokens": 256,
    }
    provider = AnthropicCompatibleGeneratorProvider(
        client=_FakeClient(
            [
                '{"user_text":["这份新能源日报再改改，措辞正式一些，当作给领导汇报用","内容框架不变，把语气调得更专业正式点"]}'
            ]
        )
    )
    samples = provider.generate_samples(
        task,
        [
            {
                "intent": "rewrite_report",
                "difficulty": "medium",
                "tags": ["tone_adjustment"],
                "context": {"has_visible_report": True},
                "templates": ["帮我把日报改正式一些"],
            }
        ],
    )
    assert len(samples) == 2
    assert samples[0]["input"]["user_text"] == "这份新能源日报再改改，措辞正式一些，当作给领导汇报用"
    assert samples[1]["input"]["user_text"] == "内容框架不变，把语气调得更专业正式点"


def test_anthropic_compatible_generator_provider_accepts_json_lines_payload() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
        "max_tokens": 256,
    }
    provider = AnthropicCompatibleGeneratorProvider(
        client=_FakeClient(
            [
                '\n'.join(
                    [
                        '{"user_text":"帮我把这份新能源行业日报改得正式一点，像给老板汇报的版本，语气再专业一些。"}',
                        '{"user_text":"这份报告内容别变，但语气要调整得更正式，适合给领导看。"}',
                    ]
                )
            ]
        )
    )
    samples = provider.generate_samples(
        task,
        [
            {
                "intent": "rewrite_report",
                "difficulty": "medium",
                "tags": ["tone_adjustment"],
                "context": {"has_visible_report": True},
                "templates": ["帮我把日报改正式一些"],
            }
        ],
    )
    assert len(samples) == 2
    assert samples[0]["input"]["user_text"] == "帮我把这份新能源行业日报改得正式一点，像给老板汇报的版本，语气再专业一些。"
    assert samples[1]["input"]["user_text"] == "这份报告内容别变，但语气要调整得更正式，适合给领导看。"


def test_anthropic_compatible_teacher_provider_parses_action() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["teacher"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
        "max_tokens": 256,
    }
    provider = AnthropicCompatibleTeacherProvider(client=_FakeClient(['{"action":"chat"}']))
    parse_ok, label, raw_output, error_code = provider.classify_sample(
        task,
        {
            "context": {"has_visible_report": False},
            "input": {"user_text": "这是什么意思"},
        },
    )
    assert parse_ok is True
    assert label == "chat"
    assert raw_output == '{"action":"chat"}'
    assert error_code is None


def test_anthropic_compatible_teacher_provider_accepts_fenced_json() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["teacher"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
        "max_tokens": 256,
    }
    provider = AnthropicCompatibleTeacherProvider(client=_FakeClient(['```json\n{"action":"chat"}\n```']))
    parse_ok, label, raw_output, error_code = provider.classify_sample(
        task,
        {
            "context": {"has_visible_report": False},
            "input": {"user_text": "这是什么意思"},
        },
    )
    assert parse_ok is True
    assert label == "chat"
    assert raw_output == '```json\n{"action":"chat"}\n```'
    assert error_code is None


def test_anthropic_compatible_teacher_provider_marks_invalid_json() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["teacher"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
    }
    provider = AnthropicCompatibleTeacherProvider(client=_FakeClient(["not-json"]))
    parse_ok, label, raw_output, error_code = provider.classify_sample(
        task,
        {
            "context": {"has_visible_report": False},
            "input": {"user_text": "这是什么意思"},
        },
    )
    assert parse_ok is False
    assert label is None
    assert raw_output == "not-json"
    assert error_code == "invalid_teacher_output"


def test_anthropic_compatible_eval_provider_parses_action() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["eval"] = {
        "provider": "anthropic_compatible",
        "model": "anthropic-relay-model",
        "base_url": "https://relay.example.com/v1",
        "api_key": "test-key",
        "max_tokens": 256,
    }
    provider = AnthropicCompatibleEvalProvider(client=_FakeClient(['{"action":"rewrite_report"}']))
    parse_ok, label, raw_output, error_code = provider.predict_sample(
        task,
        {
            "context": {"has_visible_report": True},
            "input": {"user_text": "帮我润色一下"},
        },
    )
    assert parse_ok is True
    assert label == "rewrite_report"
    assert raw_output == '{"action":"rewrite_report"}'
    assert error_code is None


def test_minimax_provider_sets_default_env_names() -> None:
    task = load_task_config(Path("."), "report-intent-distill")
    task.config["runtime"]["generator"] = {
        "provider": "minimax",
        "model": "MiniMax-M2.5",
    }
    client = _FakeClient(['{"items":[{"user_text":"请生成一条样本"}]}'])
    provider = MiniMaxGeneratorProvider(client=client)
    provider.generate_samples(
        task,
        [
            {
                "intent": "chat",
                "difficulty": "easy",
                "tags": ["explicit_chat"],
                "context": {"has_visible_report": False},
                "templates": ["解释一下这个结论"],
            }
        ],
    )
    runtime, _ = client.calls[0]
    assert runtime["api_key_env"] == "MINIMAX_API_KEY"
    assert runtime["base_url_env"] == "MINIMAX_BASE_URL"


def test_openai_compatible_chat_client_retries_on_503(caplog) -> None:
    caplog.set_level(logging.WARNING, logger="dataforge.providers.openai_compatible")
    opener = _SequenceOpener(
        [
            error.HTTPError(
                url="https://relay.example.com/v1/chat/completions",
                code=503,
                msg="Service Unavailable",
                hdrs={"Retry-After": "0"},
                fp=io.BytesIO(b'{"error":{"message":"busy"}}'),
            ),
            _FakeHTTPResponse('{"choices":[{"message":{"content":"{\\"action\\":\\"chat\\"}"}}]}'),
        ]
    )
    sleeps: list[float] = []
    client = OpenAICompatibleChatClient(opener=opener, sleeper=sleeps.append)
    content = client.complete(
        {
            "model": "relay-model",
            "api_key": "test-key",
            "base_url": "https://relay.example.com/v1",
            "max_retries": 1,
        },
        [{"role": "user", "content": "hello"}],
    )
    assert content == '{"action":"chat"}'
    assert opener.calls == 2
    assert sleeps == [1.0]
    retry_records = [record for record in caplog.records if getattr(record, "error_code", "") == "OPENAI_REQUEST_RETRY"]
    assert len(retry_records) == 1
    assert retry_records[0].context["attempt"] == 1
    assert "test-key" not in caplog.text


def test_openai_compatible_chat_client_does_not_retry_on_400() -> None:
    opener = _SequenceOpener(
        [
            error.HTTPError(
                url="https://relay.example.com/v1/chat/completions",
                code=400,
                msg="Bad Request",
                hdrs={},
                fp=io.BytesIO(b'{"error":{"message":"bad request"}}'),
            )
        ]
    )
    client = OpenAICompatibleChatClient(opener=opener, sleeper=lambda _: None)
    try:
        client.complete(
            {
                "model": "relay-model",
                "api_key": "test-key",
                "base_url": "https://relay.example.com/v1",
                "max_retries": 2,
            },
            [{"role": "user", "content": "hello"}],
        )
    except OpenAICompatibleError as exc:
        assert "HTTP 400" in str(exc)
    else:
        raise AssertionError("Expected OpenAICompatibleError")
    assert opener.calls == 1


def test_openai_compatible_chat_client_lists_models() -> None:
    opener = _SequenceOpener(
        [
            _FakeHTTPResponse(
                '{"data":[{"id":"gpt-5.4","created":1740787200},{"id":"text-embedding-3-large","created":1740700800}]}'
            )
        ]
    )
    client = OpenAICompatibleChatClient(opener=opener, sleeper=lambda _: None)
    models = client.list_models(
        {
            "api_key": "test-key",
            "base_url": "https://relay.example.com/v1",
            "max_retries": 0,
        }
    )
    assert models == [
        {"id": "gpt-5.4", "display_name": None, "created": 1740787200},
        {"id": "text-embedding-3-large", "display_name": None, "created": 1740700800},
    ]
    assert opener.calls == 1


def test_anthropic_compatible_chat_client_retries_on_503(caplog) -> None:
    caplog.set_level(logging.WARNING, logger="dataforge.providers.anthropic_compatible")
    opener = _SequenceOpener(
        [
            error.HTTPError(
                url="https://relay.example.com/v1/messages",
                code=503,
                msg="Service Unavailable",
                hdrs={"Retry-After": "0"},
                fp=io.BytesIO(b'{"error":{"message":"busy"}}'),
            ),
            _FakeHTTPResponse('{"content":[{"type":"text","text":"{\\"action\\":\\"chat\\"}"}]}'),
        ]
    )
    sleeps: list[float] = []
    client = AnthropicCompatibleClient(opener=opener, sleeper=sleeps.append)
    content = client.complete(
        {
            "model": "anthropic-relay-model",
            "api_key": "test-key",
            "base_url": "https://relay.example.com/v1",
            "max_retries": 1,
            "max_tokens": 256,
        },
        [{"role": "user", "content": "hello"}],
    )
    assert content == '{"action":"chat"}'
    assert opener.calls == 2
    assert sleeps == [1.0]
    retry_records = [record for record in caplog.records if getattr(record, "error_code", "") == "ANTHROPIC_REQUEST_RETRY"]
    assert len(retry_records) == 1
    assert retry_records[0].context["attempt"] == 1
    assert "test-key" not in caplog.text


def test_anthropic_compatible_chat_client_does_not_retry_on_400() -> None:
    opener = _SequenceOpener(
        [
            error.HTTPError(
                url="https://relay.example.com/v1/messages",
                code=400,
                msg="Bad Request",
                hdrs={},
                fp=io.BytesIO(b'{"error":{"message":"bad request"}}'),
            )
        ]
    )
    client = AnthropicCompatibleClient(opener=opener, sleeper=lambda _: None)
    try:
        client.complete(
            {
                "model": "anthropic-relay-model",
                "api_key": "test-key",
                "base_url": "https://relay.example.com/v1",
                "max_retries": 2,
                "max_tokens": 256,
            },
            [{"role": "user", "content": "hello"}],
        )
    except AnthropicCompatibleError as exc:
        assert "HTTP 400" in str(exc)
    else:
        raise AssertionError("Expected AnthropicCompatibleError")
    assert opener.calls == 1


def test_anthropic_compatible_chat_client_lists_models() -> None:
    opener = _SequenceOpener(
        [
            _FakeHTTPResponse(
                '{"data":[{"id":"claude-3-7-sonnet-20250219","created_at":"2025-02-19T00:00:00Z"},{"id":"claude-3-5-haiku-20241022","created_at":"2024-10-22T00:00:00Z"}]}'
            )
        ]
    )
    client = AnthropicCompatibleClient(opener=opener, sleeper=lambda _: None)
    models = client.list_models(
        {
            "api_key": "test-key",
            "base_url": "https://relay.example.com/v1",
            "max_retries": 0,
        }
    )
    assert models == [
        {"id": "claude-3-7-sonnet-20250219", "display_name": None, "created_at": "2025-02-19T00:00:00Z"},
        {"id": "claude-3-5-haiku-20241022", "display_name": None, "created_at": "2024-10-22T00:00:00Z"},
    ]
    assert opener.calls == 1
