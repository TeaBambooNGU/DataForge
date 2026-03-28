# report-intent-distill

First task for the DataForge MVP. It classifies user intent into `chat`, `rewrite_report`, or `regenerate_report`.

Run artifacts are versioned under:

```text
tasks/report-intent-distill/runs/<run_id>/
```

The latest run pointer is stored in:

```text
tasks/report-intent-distill/runs/latest.json
```

Typical review flow:

```bash
uv run dataforge review-export --task report-intent-distill --run-id <run_id>
uv run dataforge validate-review --task report-intent-distill --run-id <run_id>
uv run dataforge build-gold --task report-intent-distill --run-id <run_id>
```

To switch to an OpenAI-compatible relay, update `configs/task.yaml`:

```yaml
runtime:
  generator:
    provider: openai_compatible
    model: gpt-5.3-codex
    base_url_env: OPENAI_BASE_URL
    api_key_env: OPENAI_API_KEY
    response_format_json_object: true
    max_retries: 2
    retry_backoff_seconds: 1.0
  teacher:
    provider: openai_compatible
    model: gpt-5.3-codex
    base_url_env: OPENAI_BASE_URL
    api_key_env: OPENAI_API_KEY
    response_format_json_object: true
    max_retries: 2
    retry_backoff_seconds: 1.0
  eval:
    provider: openai_compatible
    model: gpt-5.3-codex
    base_url_env: OPENAI_BASE_URL
    api_key_env: OPENAI_API_KEY
    response_format_json_object: true
    max_retries: 2
    retry_backoff_seconds: 1.0
```

To switch to an Anthropic-compatible or MiniMax relay:

```yaml
runtime:
  generator:
    provider: anthropic_compatible
    model: claude-3-5-haiku-20241022
    base_url_env: ANTHROPIC_BASE_URL
    api_key_env: ANTHROPIC_API_KEY
    max_tokens: 1024
  teacher:
    provider: minimax
    model: MiniMax-M2.5
    max_tokens: 1024
  eval:
    provider: minimax
    model: MiniMax-M2.5
    max_tokens: 1024
```

`provider: minimax` reuses the Anthropic-compatible Messages implementation and defaults to `MINIMAX_BASE_URL` plus `MINIMAX_API_KEY`.
