# 工程架构梳理

- 当前梳理时间: 2026-03-28 18:06:50

## 项目概览
- 项目定位: DataForge 是一个面向离线蒸馏数据生产的 MVP 脚手架，当前围绕 `report-intent-distill` 任务提供从样本生成、教师标注、筛选导出、人工复核到 gold 集构建和评测的全流程能力。
- 主要能力:
  1. 通过统一 CLI 入口调度多阶段 pipeline。
  2. 通过任务配置驱动 provider、规则、静态资源路径和导出格式。
  3. 通过 `run_id` 对每次运行的中间产物、报告与 manifest 做版本化管理。
  4. 支持 `mock`、`openai_compatible`、`anthropic_compatible`、`minimax` 四类 provider 接入方式。
- 关键输出:
  1. `tasks/<task>/runs/<run_id>/raw/*.jsonl`：候选样本与教师标注结果。
  2. `tasks/<task>/runs/<run_id>/processed/*`：过滤后的训练集、复核导出、复核结果。
  3. `tasks/<task>/runs/<run_id>/gold/*`：gold 集与 hard cases。
  4. `tasks/<task>/runs/<run_id>/exports/*` 与 `reports/*`：评测导出、预测结果、评测总结、stage manifest。

## 工程逻辑梳理

### 入口与启动
- 入口文件/命令:
  1. Python 包入口由 [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml) 中的 `dataforge = "dataforge.cli:main"` 暴露。
  2. 运行命令形态为 `uv run dataforge <command> --task <task> [--run-id <run_id>] [--project-root <path>]`。
  3. CLI 实现在 [src/dataforge/cli.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/cli.py)。
- 启动流程概述:
  1. `build_parser()` 限定命令集合为 `generate`、`classify`、`filter-export`、`review-export`、`validate-review`、`build-gold`、`eval`、`run-all`。
  2. `main()` 解析参数后，先通过 `load_dotenv()` 加载项目根目录 `.env`。
  3. 随后 `load_task_config()` 读取 `tasks/<task>/configs/task.yaml`，封装成 `TaskConfig`。
  4. `resolve_task_run()` 根据命令决定是新建 run 还是复用最新 run，再分发到对应 pipeline。
  5. `run-all` 当前只串行执行 `generate -> classify -> filter_export -> review_export`，不会自动执行 `validate-review`、`build-gold`、`eval`。

### 核心模块
- 模块划分:
  1. [src/dataforge/cli.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/cli.py)：CLI 参数解析与 pipeline 调度。
  2. [src/dataforge/core/registry.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/registry.py)：任务发现、配置加载、`TaskConfig`/`TaskRun` 建模、run 状态推进、产物路径映射。
  3. [src/dataforge/core/io.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/io.py)：YAML/JSON/JSONL/Text 读写、目录保障、manifest 持久化。
  4. [src/dataforge/core/schemas.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/schemas.py)：样本 schema 校验，覆盖 candidate/classified/reviewed/gold 四个 stage。
  5. [src/dataforge/core/filters.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/filters.py) 与 [src/dataforge/core/dedupe.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/dedupe.py)：样本去重、规则过滤、review pool 划分。
  6. [src/dataforge/core/review.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/review.py)：复核记录模板、复核校验、复核统计、review 应用。
  7. [src/dataforge/core/eval_runner.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/eval_runner.py)：评测指标计算、promptfoo 导出、summary/confusion 报告生成。
  8. [src/dataforge/providers/](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/providers)：provider 抽象与具体模型接入。
  9. [src/dataforge/pipelines/](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines)：按 stage 划分的流水线执行单元。
  10. [tasks/report-intent-distill/configs/](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs)：任务级静态配置、prompt、labels、scenario matrix。
- 关键职责:
  1. `registry` 负责统一 run 生命周期，保证 `index.json`、`latest.json`、`status`、`stages` 同步更新。
  2. `pipelines` 各自只处理单一 stage，并在结束后写入对应 manifest。
  3. `providers` 负责模型调用或 mock 推断，不直接管理磁盘产物。
  4. `core` 层负责公共校验、过滤、复核和评测逻辑，尽量将业务规则从 CLI 与 provider 中抽离。
- 主要依赖:
  1. `pytest`：测试与 smoke 验证。
  2. `pyyaml`：任务与场景配置解析。
  3. Python 标准库 `argparse`、`dataclasses`、`json`、`pathlib`、`urllib`、`datetime`：支撑 CLI、配置、网络调用与文件组织。

### 依赖关系
- 外部依赖:
  1. [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml) 当前仅声明 `pytest` 与 `pyyaml`。
  2. `openai_compatible` 通过标准 Chat Completions HTTP 接口对接 OpenAI 风格 relay。
  3. `anthropic_compatible` 通过 Messages HTTP 接口对接 Anthropic 风格 relay。
  4. `minimax` 复用 `anthropic_compatible` 实现，仅替换默认环境变量为 `MINIMAX_BASE_URL` 与 `MINIMAX_API_KEY`。
- 内部依赖:
  1. CLI 依赖 `core.env`、`core.registry` 和所有 `pipelines`。
  2. `pipelines.generate/classify/eval` 依赖 provider registry 获取具体 provider。
  3. `pipelines.filter_export` 依赖 `dedupe`、`filters`、`io`、`registry`。
  4. `pipelines.review_export/validate_review/build_gold` 依赖 `review` 模块处理人工复核闭环。
  5. `TaskRun.path_for()` 是运行期文件寻址的中心入口，stage 实现通过 artifact key 间接访问具体路径。

### 数据流/控制流
- 数据来源:
  1. 任务元配置来自 [tasks/report-intent-distill/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/task.yaml)。
  2. 生成场景来自 [tasks/report-intent-distill/configs/scenario_matrix.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/scenario_matrix.yaml)。
  3. 标签集合来自 [tasks/report-intent-distill/configs/labels.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/labels.yaml)。
  4. prompt 模板来自 `generator_prompt.txt` 与 `teacher_prompt.txt`。
  5. 运行期密钥与 base URL 可从项目根目录 `.env` 或外部环境变量注入。
- 数据处理链路:
  1. `generate`：读取 scenario matrix，调用 generator provider 产出 `raw/raw_candidates.jsonl`，并做 schema 校验。
  2. `classify`：读取候选样本，调用 teacher provider 输出 `raw/teacher_labeled.jsonl`，在 `annotation` 中补齐教师标签、原始输出、解析状态与错误码。
  3. `filter-export`：读取教师标注结果，基于 `user_text`、`parse_ok`、允许标签、长度限制和任务规则过滤；先按 `(user_text.lower(), has_visible_report, teacher_label)` 去重，再拆分出训练集、拒绝集、复核池与空的 promptfoo eval 占位文件。
  4. `review-export`：把 review pool 组装成待人工复核模板 `processed/review_candidates.jsonl`。
  5. `validate-review`：校验 `processed/review_results.jsonl`，输出 `reports/review_validation.md`。
  6. `build-gold`：将人工复核结果回写到教师标注样本，冻结为 `gold/gold_eval.jsonl`，并抽取 hard cases。
  7. `eval`：对 gold 集重新做预测，输出 `exports/eval_predictions.jsonl`、`exports/eval_for_promptfoo.jsonl`、`reports/eval_summary.md`、`reports/confusion_analysis.md`。
- 控制/调度流程:
  1. `resolve_task_run()` 在 `generate`/`run-all` 时总是新建 run，在其他命令下优先复用 `latest.json` 指向的最新 run。
  2. 每个 stage 完成后调用 `write_run_manifest()` 与 `task.record_stage()`，推进 `status`、`last_stage`、`stages`。
  3. `RUN_STATUS_ORDER` 保证状态只能向前推进，避免晚执行的低优先级 stage 把总体状态回退。

### 关键配置
- 配置文件:
  1. [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml)：包定义、脚本入口、pytest 配置。
  2. [README.md](/Users/teabamboo/Documents/AIplusLLM/DataForge/README.md)：操作命令、run versioning 说明、provider 配置示例。
  3. [tasks/report-intent-distill/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/task.yaml)：任务主题、runtime、paths、rules、exports。
  4. [tasks/report-intent-distill/README.md](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/README.md)：任务级运行说明与 provider 切换示例。
- 关键参数:
  1. `runtime.<stage>.provider`：决定 stage 选择的 provider 实现。
  2. `model`、`temperature`、`max_tokens`、`max_retries`、`retry_backoff_seconds`：控制模型调用与重试。
  3. `paths.*`：静态配置和 prompt 文件的项目内绝对解析入口。
  4. `rules.disallow_rewrite_without_visible_report`：过滤阶段的重要业务约束。
  5. `exports.*`：训练集与评测导出的目标格式声明。
- 运行环境约束:
  1. 需要 Python 3.9+。
  2. 若使用真实 provider，必须提供对应 API key 与 base URL 环境变量。
  3. 当前项目未接入数据库、消息队列或远程存储，所有产物均写入本地文件系统。

### 运行流程
- 运行步骤:
  1. 通过 `uv run dataforge generate --task report-intent-distill` 或 `run-all` 创建新的 `run_id`。
  2. 在自动流程结束后，人工或外部工具填充 `processed/review_results.jsonl`。
  3. 继续运行 `validate-review`、`build-gold`、`eval` 完成闭环。
  4. 每次运行的索引保存在 `tasks/<task>/runs/index.json`，最新 run 指针保存在 `latest.json`。
- 异常/边界处理:
  1. 若非 `generate`/`run-all` 且没有历史 run，`resolve_task_run()` 会直接报错，要求先创建 run 或显式传入 `--run-id`。
  2. provider 返回非 JSON 或缺失 `action` 时，会把 `parse_ok` 置为 `False` 并写入错误码，而不是静默吞掉异常。
  3. `build-gold` 在 `review_results` 中找不到对应样本时会直接抛错，阻止生成不完整 gold 集。
  4. schema 与 review 校验均采用 fail-fast 策略，不做自动修复。
- 观测与日志:
  1. 当前没有统一日志系统或链路追踪。
  2. 可观测性主要依赖 `reports/manifests/*.json`、`eval_summary.md`、`confusion_analysis.md`、`review_validation.md` 和 `runs/index.json`。
  3. 从测试角度，`tests/test_pipeline_smoke.py` 覆盖了完整 smoke 流程，`tests/test_providers.py`、`tests/test_registry.py`、`tests/test_filters.py` 等分别覆盖 provider、run 管理和核心规则。

## 改动概要/变更记录

### 2026-03-28 18:06:50
- 本次新增/更新要点:
  1. 首次创建 `docs/architecture.md`。
  2. 补齐 CLI 入口、run 生命周期、pipeline 阶段职责、provider 体系、任务配置和产物目录结构说明。
  3. 明确 `run-all` 只覆盖前四阶段，以及人工复核结果需要外部回填后才能继续 `build-gold`/`eval`。
- 变更动机/需求来源: 用户显式要求使用 `architecture-doc-updater` 技能梳理当前仓库工程架构，并补齐缺失的架构文档。
- 当前更新时间: 2026-03-28 18:06:50
