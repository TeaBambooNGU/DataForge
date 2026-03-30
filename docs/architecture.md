# 工程架构梳理

- 当前梳理时间: 2026-03-30 16:30:59

## 项目概览
- 项目定位: DataForge 是一个面向离线蒸馏数据生产的 MVP 脚手架，当前围绕 `report-intent-distill` 任务提供从样本生成、教师标注、筛选导出、人工复核到 gold 集构建和评测的全流程能力。
- 当前形态:
  1. 保留命令行主入口，适合脚本化或批处理执行。
  2. 新增本地 FastAPI 工作台，负责把 pipeline、run、产物和 review 编辑能力暴露给浏览器。
  3. 新增纯静态前端工作台，直接消费本地 API，在页面里完成 task 查看、run 切换、stage 执行、产物浏览、人工复核与任务配置编辑。
- 主要能力:
  1. 通过统一 CLI 或 Web API 调度多阶段 pipeline。
  2. 通过任务配置驱动 provider、规则、静态资源路径和导出格式。
  3. 通过 `run_id` 对每次运行的中间产物、报告与 manifest 做版本化管理。
  4. 支持 `mock`、`openai_compatible`、`anthropic_compatible`、`minimax` 四类 provider 接入方式。
  5. 支持本地浏览器工作台，以页签方式查看任务定义、运行控制、运行产物与人工复核。
  6. 支持在浏览器里直接编辑任务配置文件，并回写 `task.yaml`、`labels.yaml`、`scenario_matrix.yaml`、`generator_prompt.txt`、`teacher_prompt.txt`。
  7. 支持在浏览器里删除历史 run，后端会同步维护 `runs/index.json` 与 `latest.json`。
  8. 支持对关键运行产物进行结构化诊断浏览，而不是直接展示原始 JSONL 文本。
- 关键输出:
  1. `tasks/<task>/runs/<run_id>/raw/*.jsonl`：候选样本与教师标注结果。
  2. `tasks/<task>/runs/<run_id>/processed/*`：过滤后的训练集、带 `rejection_reason` 的拒绝集、复核导出、复核结果。
  3. `tasks/<task>/runs/<run_id>/gold/*`：gold 集与 hard cases。
  4. `tasks/<task>/runs/<run_id>/exports/*` 与 `reports/*`：评测导出、预测结果、评测总结、stage manifest。
  5. `frontend/*`：本地工作台静态资源。

## 工程逻辑梳理

### 入口与启动
- 入口文件/命令:
  1. Python 包入口由 [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml) 中的 `dataforge = "dataforge.cli:main"` 暴露。
  2. Web 工作台入口同样由 [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml) 中的 `dataforge-web = "dataforge.web.app:main"` 暴露。
  3. CLI 运行命令形态为 `uv run dataforge <command> --task <task> [--run-id <run_id>] [--project-root <path>]`。
  4. Web 工作台运行命令形态为 `uv run dataforge-web --host 127.0.0.1 --port 8013 [--project-root <path>]`。
  5. CLI 实现在 [src/dataforge/cli.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/cli.py)，Web 入口实现在 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py)。
- 启动流程概述:
  1. CLI `main()` 解析参数后，通过 `load_dotenv()` 加载项目根目录 `.env`，再经 `load_task_config()` 读取 `tasks/<task>/configs/task.yaml`，最后通过 `resolve_task_run()` 选择新建或复用 run 并分发到对应 pipeline。
  2. Web `create_app()` 会校验 `frontend/` 目录存在、加载 `.env`、挂载 `/assets` 静态资源并注册 API 路由，根路由 `/` 直接返回 [frontend/index.html](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/index.html)，同时提供 `/api/health` 健康检查。
  3. `run-all` 在 CLI 和 Web 中语义一致，当前只串行执行 `generate -> classify -> filter-export -> review-export`，不会自动执行 `validate-review`、`build-gold`、`eval`。

### 核心模块
- 模块划分:
  1. [src/dataforge/cli.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/cli.py)：CLI 参数解析与 pipeline 调度。
  2. [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py)：FastAPI 本地工作台，负责任务/运行查询、pipeline 执行代理、产物读取、review 读写、任务配置文件读写与标准化校验，以及 run 删除后的索引同步。
  3. [frontend/index.html](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/index.html)、[frontend/app.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/app.js)、[frontend/styles.css](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles.css)：无构建步骤的原生前端工作台，负责浏览器内交互与展示，并提供结构化产物阅读、run 删除和 artifact 解释层。
  4. [src/dataforge/core/registry.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/registry.py)：任务发现、配置加载、`TaskConfig`/`TaskRun` 建模、run 状态推进、产物路径映射。
  5. [src/dataforge/core/io.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/io.py)：YAML/JSON/JSONL/Text 读写、目录保障、manifest 持久化。
  6. [src/dataforge/core/schemas.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/schemas.py)：样本 schema 校验，覆盖 candidate/classified/reviewed/gold 四个 stage。
  7. [src/dataforge/core/filters.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/filters.py) 与 [src/dataforge/core/dedupe.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/dedupe.py)：样本去重、规则过滤、review pool 划分。
  8. [src/dataforge/core/review.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/review.py)：复核记录模板、复核校验、复核统计、review 应用。
  9. [src/dataforge/core/eval_runner.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/eval_runner.py)：评测指标计算、promptfoo 导出、summary/confusion 报告生成。
  10. [src/dataforge/providers/](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/providers)：provider 抽象与具体模型接入。
  11. [src/dataforge/pipelines/](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines)：按 stage 划分的流水线执行单元。
  12. [tasks/report-intent-distill/configs/](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs)：任务级静态配置、prompt、labels、scenario matrix。
- 关键职责:
  1. `registry` 负责统一 run 生命周期，保证 `index.json`、`latest.json`、`status`、`last_stage`、`stages` 同步更新。
  2. `pipelines` 各自只处理单一 stage，并在结束后写入对应 manifest。
  3. `web/app.py` 不直接执行 shell CLI，而是复用现有 Python pipeline 函数作为执行桥接层，避免浏览器直接运行命令。
  4. `web/app.py` 中 `_normalize_task_config_files()`、`_normalize_runtime()`、`_normalize_scenarios()` 等函数负责把前端提交的配置规整为可落盘的合法结构，再由 `_save_task_config_files()` 分别写入各配置文件；`_delete_run()`、`_write_runs_index()`、`_sync_latest_run_pointer()` 则负责删除 run 后维持 run 索引一致性。
  5. `frontend/app.js` 负责前端状态机，围绕 `selectedTask`、`selectedRun`、`taskSpec`、`artifactPayload`、`reviewRecords`、`isEditingTaskConfig` 等状态组织页面更新，并维护 `rawCandidateViewMode`、`rawCandidateGroupBy` 等结构化浏览状态。
  6. `frontend/index.html` 当前采用页签工作台布局，将“运行控制”“任务定义”“运行产物”“人工复核”拆成独立面板，避免单页信息过载。
  7. `frontend` 的“任务定义”页已拆成默认只读查看态和独立编辑态，避免只读摘要与编辑表单在同一页面同时出现。
  8. `frontend` 在产物展示上默认只展示实际存在的 artifact，并隐藏 `*_manifest`，结构化浏览优先于原始 JSONL 转储。
  9. `frontend/app.js` 中 `ARTIFACT_EXPLANATIONS` 与 `renderArtifactExplanation()` 为每个 artifact 提供“用途/阶段/阅读提示”说明，降低直接查看中间产物的理解成本。
- 主要依赖:
  1. `fastapi`：提供本地工作台 HTTP API。
  2. `uvicorn`：提供本地 ASGI 服务启动。
  3. `pytest`：测试与 smoke 验证。
  4. `pyyaml`：任务与场景配置解析。
  5. Python 标准库 `argparse`、`json`、`pathlib`、`datetime` 等：支撑 CLI、配置、文件组织与本地服务启动。

### 依赖关系
- 外部依赖:
  1. [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml) 当前声明 `fastapi`、`uvicorn`、`pytest`、`pyyaml`。
  2. `openai_compatible` 通过标准 Chat Completions HTTP 接口对接 OpenAI 风格 relay。
  3. `anthropic_compatible` 通过 Messages HTTP 接口对接 Anthropic 风格 relay。
  4. `minimax` 复用 `anthropic_compatible` 实现，仅替换默认环境变量为 `MINIMAX_BASE_URL` 与 `MINIMAX_API_KEY`。
- 内部依赖:
  1. CLI 依赖 `core.env`、`core.registry` 和所有 `pipelines`。
  2. Web API 依赖 `core.env`、`core.io`、`core.registry`、`core.review` 和各 pipeline。
  3. 前端只通过 `fetch()` 调用本地 HTTP API，不直接触达文件系统。
  4. `pipelines.generate/classify/eval` 依赖 provider registry 获取具体 provider。
  5. `pipelines.filter_export` 依赖 `dedupe`、`filters`、`io`、`registry`，其中 `filters.reject_sample()` 负责为拒绝样本写入 `rejection_reason`。
  6. `pipelines.review_export/validate_review/build_gold` 依赖 `review` 模块处理人工复核闭环。
  7. `TaskRun.path_for()` 是运行期文件寻址的中心入口，CLI stage 与 Web API 均通过 artifact key 间接访问具体路径。

### 数据流/控制流
- 数据来源:
  1. 任务元配置来自 [tasks/report-intent-distill/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/task.yaml)。
  2. 生成场景来自 [tasks/report-intent-distill/configs/scenario_matrix.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/scenario_matrix.yaml)。
  3. 标签集合来自 [tasks/report-intent-distill/configs/labels.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/labels.yaml)。
  4. prompt 模板来自 `generator_prompt.txt` 与 `teacher_prompt.txt`。
  5. 运行期密钥与 base URL 可从项目根目录 `.env` 或外部环境变量注入。
- CLI 数据处理链路:
  1. `generate`：读取 scenario matrix，调用 generator provider 产出 `raw/raw_candidates.jsonl`，并做 schema 校验。
  2. `classify`：读取候选样本，调用 teacher provider 输出 `raw/teacher_labeled.jsonl`，在 `annotation` 中补齐教师标签、原始输出、解析状态与错误码。
  3. `filter-export`：读取教师标注结果，基于 `user_text`、`parse_ok`、允许标签、长度限制和任务规则过滤；先按 `(user_text.lower(), has_visible_report, teacher_label)` 去重，再拆分出训练集、带 `rejection_reason` 的拒绝集、复核池与空的 promptfoo eval 占位文件。
  4. `review-export`：把 review pool 组装成待人工复核模板 `processed/review_candidates.jsonl`。
  5. `validate-review`：校验 `processed/review_results.jsonl`，输出 `reports/review_validation.md`。
  6. `build-gold`：将人工复核结果回写到教师标注样本，冻结为 `gold/gold_eval.jsonl`，并抽取 hard cases。
  7. `eval`：对 gold 集重新做预测，输出 `exports/eval_predictions.jsonl`、`exports/eval_for_promptfoo.jsonl`、`reports/eval_summary.md`、`reports/confusion_analysis.md`。
- Web 控制流:
  1. 前端初始化后先调用 `GET /api/tasks`，加载 task 列表及最新 run 摘要。
  2. 选择 task 后，前端继续调用 `GET /api/tasks/{task_name}/spec`、`GET /api/tasks/{task_name}/config-files` 和 `GET /api/tasks/{task_name}/runs`，分别加载只读任务定义、可编辑配置草稿和 run 列表。
  3. 任务定义页默认处于只读查看态；用户点击“编辑配置”后，前端把 `isEditingTaskConfig` 置为 `true`，切换到独立编辑态，隐藏只读摘要区。
  4. 用户保存配置时，前端调用 `PUT /api/tasks/{task_name}/config-files`；后端负责校验 task/runtime/rules/exports/labels/scenarios/prompts，并分别回写真实配置文件，再返回最新 `config` 和 `spec` 供前端刷新。
  5. 用户取消编辑时，前端直接回退到 `originalTaskConfig` 并退出编辑态，不向后端提交任何写入。
  6. 选择 run 后，前端调用 `GET /api/tasks/{task_name}/runs/{run_id}`、`GET /api/tasks/{task_name}/runs/{run_id}/artifacts/{artifact_key}`、`GET /api/tasks/{task_name}/runs/{run_id}/review-records`，分别拉取运行摘要、单个产物和复核数据。
  7. 用户点击 stage 按钮时，前端调用 `POST /api/tasks/{task_name}/commands/{command}`；FastAPI 内部经 `resolve_task_run()` 和 `_run_command()` 复用原 pipeline 逻辑执行任务。
  8. 用户编辑 review 后，前端调用 `PUT /api/tasks/{task_name}/runs/{run_id}/review-records`；后端负责标准化 `reviewed_by`、`reviewed_at`、`reviewer_label` 并写回 `review_results.jsonl`。
  9. 用户删除 run 时，前端调用 `DELETE /api/tasks/{task_name}/runs/{run_id}`；后端删除对应目录后重写 `runs/index.json`，并根据剩余 runs 更新或移除 `latest.json`，前端随后刷新 run 列表并自动选中剩余最新 run。
  10. 用户切换“运行产物”页中的 artifact 时，前端先渲染 artifact explanation，再根据 artifact 类型进入结构化视图；其中 `raw_candidates` 支持表格/分类双视图，`rejected_samples` 支持按 `rejection_reason` 汇总与过滤。
- 控制/调度规则:
  1. `resolve_task_run()` 在 `generate`/`run-all` 时总是新建 run，在其他命令下优先复用 `latest.json` 指向的最新 run。
  2. 每个 stage 完成后调用 `write_run_manifest()` 与 `task.record_stage()`，推进 `status`、`last_stage`、`stages`。
  3. `RUN_STATUS_ORDER` 保证状态只能向前推进，避免晚执行的低优先级 stage 把总体状态回退。
  4. Web 端 artifact 接口对 `.jsonl` 返回限制条数的结构化内容，对 `.json` 返回对象，对文本文件返回截断文本，避免页面一次性加载过大文件。
  5. run 删除不依赖数据库事务；一致性由 `_delete_run()` 串行完成目录删除、索引重写和 latest 指针同步，保证页面刷新后不会继续引用已删除 run。

### 关键配置
- 配置文件:
  1. [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml)：包定义、CLI/Web 脚本入口、依赖、pytest 配置。
  2. [README.md](/Users/teabamboo/Documents/AIplusLLM/DataForge/README.md)：操作命令、run versioning 说明、provider 配置示例。
  3. [tasks/report-intent-distill/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/task.yaml)：任务主题、runtime、paths、rules、exports。
  4. [tasks/report-intent-distill/README.md](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/README.md)：任务级运行说明与 provider 切换示例。
- 关键参数:
  1. `runtime.<stage>.provider`：决定 stage 选择的 provider 实现。
  2. `model`、`temperature`、`max_tokens`、`max_retries`、`retry_backoff_seconds`：控制模型调用与重试。
  3. `paths.*`：静态配置和 prompt 文件的项目内绝对解析入口。
  4. `rules.disallow_rewrite_without_visible_report`：过滤阶段的重要业务约束。
  5. `exports.*`：训练集与评测导出的目标格式声明。
  6. `scenario.generation_count`：控制该场景预计生成多少样本；若留空，则退化为 `templates` 条数。
  7. `rejection_reason`：`filter-export` 输出给拒绝样本的诊断字段，用于前端汇总、筛选和问题定位。
  8. Web 启动参数 `--host`、`--port`、`--project-root`：控制本地工作台绑定地址与项目根目录。
- 运行环境约束:
  1. 需要 Python 3.9+。
  2. 若使用真实 provider，必须提供对应 API key 与 base URL 环境变量。
  3. 当前项目未接入数据库、消息队列或远程存储，所有产物均写入本地文件系统。
  4. 前端不经过构建流程，依赖浏览器直接加载 `frontend/index.html`、`frontend/app.js`、`frontend/styles.css`。

### 运行流程
- CLI 工作流:
  1. 通过 `uv run dataforge generate --task report-intent-distill` 或 `run-all` 创建新的 `run_id`。
  2. 在自动流程结束后，人工或外部工具填充 `processed/review_results.jsonl`。
  3. 继续运行 `validate-review`、`build-gold`、`eval` 完成闭环。
- Web 工作流:
  1. 通过 `uv run dataforge-web --host 127.0.0.1 --port 8013` 启动本地工作台。
  2. 浏览器打开首页后，左侧选择 task / run，顶部通过页签在“运行控制”“任务定义”“运行产物”“人工复核”之间切换。
  3. “运行控制”页签直接触发 stage，替代部分终端操作。
  4. “任务定义”页签默认展示 task 概览、labels、rules、exports、runtime、scenario matrix 和 generator/teacher prompt 的只读视图。
  5. 用户点击“编辑配置”后，页面切入独立编辑态，可修改基础信息、runtime、规则、导出、labels、scenario matrix 和 prompts；保存后退出编辑态，取消则回退草稿。
  6. “运行产物”页签只展示实际存在的 artifact，默认优先结构化浏览，不展示 `*_manifest`，并在主视图上方给出该 artifact 的阶段、用途与阅读提示。
  7. `raw_candidates` 在产物页支持表格视图与分类视图，可按 `label_hint`、`difficulty`、`has_visible_report`、`dialogue_stage` 进行分组排查。
  8. `rejected_samples` 在产物页会先汇总 `rejection_reason`，再展示明细表，便于定位主要损耗来源。
  9. 用户可在 run 列表中直接删除不需要的历史 run，删除后页面会自动刷新并切换到剩余可用 run。
  10. “人工复核”页签可直接编辑并保存 `review_results.jsonl`。
  11. 每次运行的索引保存在 `tasks/<task>/runs/index.json`，最新 run 指针保存在 `latest.json`。
- 异常/边界处理:
  1. 若非 `generate`/`run-all` 且没有历史 run，`resolve_task_run()` 会直接报错，要求先创建 run 或显式传入 `run_id`。
  2. provider 返回非 JSON 或缺失 `action` 时，会把 `parse_ok` 置为 `False` 并写入错误码，而不是静默吞掉异常。
  3. `build-gold` 在 `review_results` 中找不到对应样本时会直接抛错，阻止生成不完整 gold 集。
  4. schema 与 review 校验均采用 fail-fast 策略，不做自动修复。
  5. 删除不存在的 run 时，`DELETE /api/tasks/{task_name}/runs/{run_id}` 会返回 404，避免前端误以为删除成功。
  6. API 层将 `FileNotFoundError`、`ValueError` 映射为 `400/404`，前端通过消息条显示错误。
- 观测与日志:
  1. 当前没有统一日志系统或链路追踪。
  2. 可观测性主要依赖 `reports/manifests/*.json`、`eval_summary.md`、`confusion_analysis.md`、`review_validation.md`、`runs/index.json` 与前端消息条。
  3. 从测试与校验角度，`tests/test_pipeline_smoke.py` 覆盖完整 smoke 流程；本地工作台当前主要依赖 `node --check frontend/app.js` 与 `create_app()` 路由存在性做最小验证。

## 改动概要/变更记录

### 2026-03-30 16:30:59
- 本次新增/更新要点:
  1. 根据最新代码补齐 run 删除能力，更新 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py) 中 `DELETE /api/tasks/{task_name}/runs/{run_id}` 与索引同步逻辑说明。
  2. 更新 `filter-export` 与运行产物说明，明确 `rejected_samples.jsonl` 现在携带 `rejection_reason`，前端可按原因汇总和筛选。
  3. 更新产物浏览架构，补充 `raw_candidates` 的表格/分类双视图、分组诊断能力，以及 artifact explanation 解释层。
  4. 更新 Web 工作流，明确前端 run 删除交互、删除后的自动刷新与最新 run 重新选择行为。
- 变更动机/需求来源: 用户要求依据最新代码再次更新 `docs/architecture.md`，补齐 run 删除、结构化产物浏览和拒绝原因展示等最近迭代后的真实行为。
- 当前更新时间: 2026-03-30 16:30:59

### 2026-03-30 13:05:59
- 本次新增/更新要点:
  1. 根据最新代码补齐 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py) 中任务配置读写接口、配置标准化校验与多文件回写逻辑。
  2. 更新前端工作台说明，明确“任务定义”页已经拆成默认只读查看态与独立编辑态，状态由 `isEditingTaskConfig` 控制。
  3. 更新 Web 控制流与运行流程，补充配置编辑、保存、取消编辑的交互闭环。
  4. 强化运行产物说明，明确前端只展示实际存在的 artifact，并隐藏 `*_manifest`。
- 变更动机/需求来源: 用户要求依据最新代码再次更新 `docs/architecture.md`，使文档与本地 FastAPI 工作台和前端最新交互保持一致。
- 当前更新时间: 2026-03-30 13:05:59

### 2026-03-28 23:48:56
- 本次新增/更新要点:
  1. 将文档从“纯 CLI 架构”更新为“CLI + 本地 FastAPI 工作台 + 原生前端工作台”的双入口架构。
  2. 补齐 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py) 提供的任务、run、artifact、review API 与执行桥接逻辑说明。
  3. 补齐 [frontend/index.html](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/index.html)、[frontend/app.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/app.js)、[frontend/styles.css](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles.css) 的页签式工作台结构与展示策略。
  4. 更新依赖说明，补充 `fastapi`、`uvicorn` 和 `dataforge-web` 入口。
  5. 更新运行流程，明确浏览器不直接执行 CLI，而是通过本地 API 复用 pipeline。
- 变更动机/需求来源: 用户要求依据最新代码更新 `docs/architecture.md`，补齐本地 FastAPI 工作台与前端适配后的真实工程结构。
- 当前更新时间: 2026-03-28 23:48:56

### 2026-03-28 18:06:50
- 本次新增/更新要点:
  1. 首次创建 `docs/architecture.md`。
  2. 补齐 CLI 入口、run 生命周期、pipeline 阶段职责、provider 体系、任务配置和产物目录结构说明。
  3. 明确 `run-all` 只覆盖前四阶段，以及人工复核结果需要外部回填后才能继续 `build-gold`/`eval`。
- 变更动机/需求来源: 用户显式要求使用 `architecture-doc-updater` 技能梳理当前仓库工程架构，并补齐缺失的架构文档。
- 当前更新时间: 2026-03-28 18:06:50
