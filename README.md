# DataForge

DataForge is a local-first platform scaffold for offline distillation workflows.

The project is built around a simple idea: treat synthetic generation, teacher labeling, filtering, human review, gold set construction, and offline evaluation as a versioned data pipeline instead of a loose collection of scripts.

Current MVP scope:

- task-driven offline distillation pipelines
- SQLite-backed run and artifact storage
- local CLI for stage execution
- local FastAPI + React workbench for inspection and editing
- human review to gold-set workflow
- Promptfoo-backed offline evaluation
- configurable train/eval export layer and student training bundle export

The first built-in task is `report-intent-distill`, a 3-class intent classification workflow for:

- `chat`
- `rewrite_report`
- `regenerate_report`

## Features

- Unified pipeline stages: `generate`, `classify`, `filter-export`, `review-export`, `validate-review`, `build-gold`, `eval`, `student-export`
- Task-isolated configuration under `tasks/<task>/configs/`
- SQLite-backed run state, review records, artifact records, and evaluation metadata
- Provider abstraction for `mock`, `openai_compatible`, `anthropic_compatible`, and `minimax`
- Human review records with multi-review merge support before gold freezing
- Promptfoo test export, run-scoped Promptfoo config rendering, result capture, and structured eval summary
- Config-driven `train_format` / `eval_format` export rendering plus version metadata files
- Cross-run leakage blocking against historical `gold / eval / hard_cases`
- Standard `student-export` bundle under `training/`
- Local browser workbench with task-first entry flow, run cockpit, artifact browsing, review editing, and provider deck

## Status

DataForge is currently an MVP codebase. The core offline loop is implemented for a single real task, and the repository is still evolving around that workflow.

What is already in place:

- platform skeleton and task registry
- first task integration
- review to gold workflow
- local Promptfoo execution path
- structured eval replay summary
- generalized export layer
- student training output bundle
- cross-version leakage guardrails

What is still evolving:

- broader multi-task support
- real-data quality validation at scale

## Quick Start

### Prerequisites

- Python `>= 3.9`
- [`uv`](https://docs.astral.sh/uv/)
- local `promptfoo` CLI in `PATH`

Install dependencies:

```bash
uv sync
```

Install Promptfoo if needed:

```bash
npm install -g promptfoo@latest
```

Verify the local Promptfoo installation:

```bash
promptfoo --version
```

### Run The First Task

Create a new run and execute the first four stages:

```bash
uv run dataforge run-all --task report-intent-distill
```

Complete the review and evaluation stages:

```bash
uv run dataforge validate-review --task report-intent-distill
uv run dataforge build-gold --task report-intent-distill
uv run dataforge eval --task report-intent-distill
uv run dataforge student-export --task report-intent-distill
```

### Build And Start The Local Workbench

Build the React frontend first:

```bash
cd frontend
npm install
npm run build
cd ..
```

Then start the local FastAPI workbench:

```bash
uv run dataforge-web --host 127.0.0.1 --port 8000
```

If you only need the API during local Electron development, the backend can also run without a built frontend bundle:

```bash
uv run dataforge-web --host 127.0.0.1 --port 8000 --project-root .
```

The web workbench lets you:

- choose or create a task from the home screen
- enter a run cockpit after selecting a task
- inspect artifacts
- edit task config files
- edit review records
- trigger pipeline stages from the browser
- open provider settings from the top-right gear icon

### Build The Desktop App

The desktop shell lives under `desktop/` and packages:

- the Electron shell
- a PyInstaller-built Python backend executable
- the built frontend bundle
- seed task configs copied into the user's workspace on first launch
- generated application icons and DMG installer resources from source SVG assets

Install desktop dependencies:

```bash
cd desktop
npm install
```

If Electron binary downloads are unstable behind your network, install desktop dependencies with a proxy plus an Electron mirror:

```bash
cd desktop
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
export ELECTRON_GET_USE_PROXY=true
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

Run the Electron shell in development mode:

```bash
cd frontend
npm install
npm run dev
```

In another terminal:

```bash
cd desktop
npm run dev
```

Build a macOS DMG:

```bash
cd desktop
npm run dist:mac
```

If you are building the macOS package behind a proxy, keep the proxy variables but do not set `ELECTRON_MIRROR` during the DMG step, otherwise `dmg-builder` may be redirected to a mirror path that does not exist:

```bash
cd desktop
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
export ELECTRON_GET_USE_PROXY=true
npm run dist:mac
```

If you only want to verify the unpacked macOS app bundle first:

```bash
cd desktop
npm run dist:mac:dir
```

Build a Windows NSIS installer:

```bash
cd desktop
npm run dist:win
```

Packaged desktop builds create a writable user workspace under the system Documents directory as `DataForge/`, and the application seeds task configs there on first launch.

## CLI Usage

Available commands:

```bash
uv run dataforge generate --task report-intent-distill
uv run dataforge classify --task report-intent-distill
uv run dataforge filter-export --task report-intent-distill
uv run dataforge review-export --task report-intent-distill
uv run dataforge validate-review --task report-intent-distill
uv run dataforge build-gold --task report-intent-distill
uv run dataforge eval --task report-intent-distill
uv run dataforge student-export --task report-intent-distill
uv run dataforge run-all --task report-intent-distill
```

Behavior:

- `generate` and `run-all` create a new `run_id` when `--run-id` is omitted
- other commands reuse the latest run for the task by default
- each run tracks a monotonic status such as `generated`, `classified`, `gold_built`, and `evaluated`
- `student-export` writes a standard training bundle under `tasks/<task>/runs/<run_id>/training/`

Example:

```bash
uv run dataforge run-all --task report-intent-distill
uv run dataforge classify --task report-intent-distill --run-id run-20260327T161558Z
uv run dataforge eval --task report-intent-distill --run-id run-20260327T161558Z
uv run dataforge student-export --task report-intent-distill --run-id run-20260327T161558Z
```

## Pipeline Overview

The MVP pipeline is:

```text
generate
  -> classify
  -> filter-export
  -> review-export
  -> validate-review
  -> build-gold
  -> eval
```

Runtime storage:

- core run state, review records, labeled samples, filtered datasets, gold sets, eval predictions, and metadata are stored in SQLite
- task configuration stays in `tasks/<task>/configs/`
- exported artifacts remain on disk when they are intended for external consumption or human inspection

Persisted file outputs:

- `filter-export`: `exports/train_dataset.jsonl`
- `validate-review`: `reports/review_validation.md`
- `eval`: `exports/eval_dataset.jsonl`, `exports/eval_for_promptfoo.jsonl`, `reports/promptfoo/config.yaml`, `reports/promptfoo/results.json`, `reports/eval_summary.md`, `reports/confusion_analysis.md`
- `student-export`: `training/student_train.jsonl`

## Storage Layout

Every run is versioned under:

```text
tasks/<task>/runs/<run_id>/
```

Typical layout:

```text
tasks/report-intent-distill/runs/<run_id>/
  exports/
  training/
  reports/
```

Runtime database:

- `.dataforge/dataforge.db`: run state, stages, artifact records, review records, and evaluation metadata

Important files:

- `reports/promptfoo/config.yaml`: run-scoped Promptfoo config rendered by DataForge
- `reports/promptfoo/results.json`: raw Promptfoo evaluation result
- `reports/review_validation.md`: human review validation summary
- `reports/eval_summary.md`: human-readable evaluation summary
- `reports/confusion_analysis.md`: confusion analysis report
- `exports/train_dataset.jsonl`: train export for audit or downstream tooling
- `exports/eval_dataset.jsonl`: eval export for downstream tooling
- `exports/eval_for_promptfoo.jsonl`: Promptfoo input dataset
- `training/student_train.jsonl`: final student training bundle

## Project Structure

```text
src/dataforge/
  cli.py
  web/
  core/
  pipelines/
  providers/

tasks/
  report-intent-distill/
    configs/
    runs/

frontend/
  index.html
  package.json
  vite.config.js
  src/
  dist/

desktop/
  package.json
  main.js
  preload.js
  buildResources/
  scripts/

docs/
  architecture.md
  DataForge-platform-mvp-design.md
  DataForge-mvp-development-checklist.md
```

Responsibilities:

- `src/dataforge/core/`: registry, SQLite storage, schemas, filtering, review, eval utilities
- `src/dataforge/pipelines/`: stage implementations
- `src/dataforge/providers/`: provider adapters
- `tasks/<task>/configs/`: task-specific prompts, labels, rules, and task metadata
- `frontend/`: React + Vite browser workbench source and build output
- `desktop/`: Electron shell, backend build scripts, source icon assets, and installer config
- `docs/`: architecture, design, and development planning

## Task Configuration

The first task lives in:

```text
tasks/report-intent-distill/
```

Key config files:

- `configs/task.yaml`
- `configs/labels.yaml`
- `configs/scenario_matrix.yaml`
- `configs/generator_prompt.txt`
- `configs/teacher_prompt.txt`
- `configs/promptfoo.yaml`

The pipeline uses these files to decide:

- which providers to call
- what labels are allowed
- how generation scenarios are constructed
- which business rules apply during filtering
- how Promptfoo evaluation is rendered and executed
- which train/eval/student export formats are rendered

## Providers

DataForge currently supports four provider modes:

- `mock`
- `openai_compatible`
- `anthropic_compatible`
- `minimax`

The provider runtime is configured in `tasks/<task>/configs/task.yaml`.

### OpenAI-Compatible

Use this mode for relays that expose the Chat Completions API:

```yaml
runtime:
  generator:
    provider: openai_compatible
    model: gpt-5.3-codex
    base_url_env: OPENAI_BASE_URL
    api_key_env: OPENAI_API_KEY
```

### Anthropic-Compatible

Use this mode for relays that expose the Anthropic Messages API:

```yaml
runtime:
  teacher:
    provider: anthropic_compatible
    model: claude-3-5-haiku-20241022
    base_url_env: ANTHROPIC_BASE_URL
    api_key_env: ANTHROPIC_API_KEY
```

### MiniMax

`minimax` reuses the Anthropic-compatible implementation and defaults to:

- `MINIMAX_BASE_URL`
- `MINIMAX_API_KEY`

## Review And Evaluation

Human review is part of the core data contract.

- review candidates are exported from the filtered review pool
- review results are validated before gold construction
- multiple review records for the same sample are merged in order
- gold labels are frozen from the final effective human decision

The evaluation stage does two things:

1. runs DataForge-native prediction and metric aggregation
2. exports Promptfoo tests and runs local Promptfoo for an additional evaluation artifact

Promptfoo integration details:

- Promptfoo tests are written to `exports/eval_for_promptfoo.jsonl`
- DataForge renders a run-scoped config to `reports/promptfoo/config.yaml`
- DataForge executes your local `promptfoo` binary
- raw Promptfoo output is written to `reports/promptfoo/results.json`

## Development

Run tests:

```bash
uv run pytest -q
```

Useful targeted checks:

```bash
uv run pytest -q tests/test_pipeline_smoke.py
uv run pytest -q tests/test_eval_runner.py
uv run pytest -q tests/test_review.py
```

The current repository does not yet include a published contribution guide or license file, so treat the project as an actively evolving codebase rather than a finalized public package.

## Docs

- [Architecture](docs/architecture.md)
- [MVP Design](docs/DataForge-platform-mvp-design.md)
- [Development Checklist](docs/DataForge-mvp-development-checklist.md)
