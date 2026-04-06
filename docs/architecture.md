# 工程架构梳理

- 当前梳理时间: 2026-04-06 00:00:43

## 项目概览
- 项目定位: DataForge 是一个 local-first 的离线蒸馏数据平台脚手架，当前内置 `report-intent-distill` 与 `test` 两个 task；其中前者承载主要真实流程，后者用于配置联调与基础验证。
- 当前形态:
  1. 保留命令行主入口，适合脚本化或批处理执行。
  2. 本地 FastAPI 工作台负责把 tasks、runs、artifacts、review、task scaffold、全局 LLM 设置与连通性测试能力暴露给浏览器。
  3. 原生静态前端工作台直接消费本地 API，在页面里完成 task 新建/删除、run 切换、stage 执行、产物浏览、人工复核、任务配置编辑与全局模型配置维护。
- 主要能力:
  1. 通过统一 CLI 或 Web API 调度多阶段 pipeline。
  2. 通过任务配置驱动 provider、规则、静态资源路径和导出格式。
  3. 通过 `run_id` 对每次运行的中间产物、报告与 manifest 做版本化管理。
  4. 支持 `mock`、`openai_compatible`、`anthropic_compatible`、`minimax` 四类 provider 接入方式。
  5. 支持本地浏览器工作台，以任务页签和侧边栏 settings rail 组合查看任务定义、运行控制、运行产物、人工复核与全局设置。
  6. 支持在浏览器里新建 task scaffold，自动生成 `task.yaml`、`labels.yaml`、`scenario_matrix.yaml`、`generator_prompt.txt`、`teacher_prompt.txt` 与 `promptfoo.yaml` 默认模板。
  7. 支持在浏览器里直接编辑任务配置文件，并通过 `runtime_catalog` 辅助选择 provider、模型与 provider-specific 字段。
  8. 支持在浏览器里维护全局 LLM 设置，包括 builtin provider 凭据、默认模型、自定义 provider alias、新增/删除 alias、即时连通性测试，以及测试时自动扫描模型列表并回填最新模型。
  9. 支持把全局 LLM 设置同步落盘到 `.env`、`.dataforge/runtime_providers.json` 与 `.dataforge/runtime_provider_models.json`，并将更新后的环境变量即时注入当前进程。
  10. 支持删除整个 task 或历史 run；task 删除会移除 `tasks/<task>/` 全目录，run 删除会同步维护 `runs/index.json` 与 `latest.json`。
  11. 支持对关键运行产物进行结构化诊断浏览，而不是直接展示原始 JSONL 文本。
  12. 支持在 `eval` 阶段生成 Promptfoo tests、渲染运行时 Promptfoo 配置、调用本机 `promptfoo` CLI 并回收结果摘要。
  13. 支持对同一样本的多轮人工复核按 `sample_id` 聚合，并以最后一次有效人工结论构建 gold 集。
  14. 支持按 `exports.train_format`、`exports.eval_format`、`exports.student_format` 生成配置化导出产物，而不是把训练/评测格式写死在主流程里。
  15. 支持在 `filter-export` 阶段对训练样本执行跨 run 防泄漏去重，并把拦截摘要写入版本元数据。
  16. 支持输出 `student-export` 训练标准产物，以及 train/eval/hard cases 的版本摘要文件。
  17. 支持在任务配置编辑态将 runtime 编辑区以整行自适应网格展示，并根据全局 provider 配置给出推荐模型和环境变量映射。
- 关键输出:
  1. `tasks/<task>/runs/<run_id>/raw/*.jsonl`：候选样本与教师标注结果。
  2. `tasks/<task>/runs/<run_id>/processed/*`：过滤后的训练集、带 `rejection_reason` 的拒绝集、复核导出、复核结果。
  3. `tasks/<task>/runs/<run_id>/gold/*`：gold 集与 hard cases。
  4. `tasks/<task>/runs/<run_id>/exports/*` 与 `reports/*`：训练导出、评测导出、版本元数据、预测结果、结构化 eval 摘要、Promptfoo 运行时配置、Promptfoo 原始结果、评测总结、stage manifest。
  5. `tasks/<task>/runs/<run_id>/training/*`：student 标准训练输入与训练版本元数据。
  6. `frontend/*`：本地工作台静态资源，其中 `frontend/js/` 与 `frontend/styles/` 已按职责拆分。
  7. `.dataforge/runtime_providers.json`：自定义全局 provider alias catalog。
  8. `.dataforge/runtime_provider_models.json`：各 provider 扫描得到的模型列表覆盖文件，供 runtime catalog 与全局设置页回显。

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
  2. Web `create_app()` 会校验 `frontend/` 目录存在、加载 `.env`、挂载 `/assets` 静态资源并注册 `/api/settings/llm`、`/api/settings/llm/test`、`/api/tasks`、`/api/tasks/{task}/runs/*`、`/api/tasks/{task}/runs/{run_id}/review-records` 等路由；根路由 `/` 直接返回 [frontend/index.html](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/index.html)，同时提供 `/api/health` 健康检查。
  3. `run-all` 在 CLI 和 Web 中语义一致，当前只串行执行 `generate -> classify -> filter-export -> review-export`，不会自动执行 `validate-review`、`build-gold`、`eval`。

### 核心模块
- 模块划分:
  1. [src/dataforge/cli.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/cli.py)：CLI 参数解析与 pipeline 调度。
  2. [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py)：FastAPI 本地工作台，负责 health、task 列表/创建/删除、run 查询与删除、pipeline 执行代理、artifact 读取、review 读写、任务配置文件读写、全局 LLM 设置读写与 provider 连通性探测。
  3. [frontend/index.html](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/index.html)：工作台壳层，定义侧边栏、workspace header、任务页签与 settings rail 入口。
  4. [frontend/app.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/app.js)：前端顶层状态机，负责 task/run/settings 三类视图切换、全局刷新、命令调度、task/run 创建删除与模块编排。
  5. [frontend/js/core/](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/js/core)：基础设施层，封装 API 调用、常量、任务配置归一化与公共工具。
  6. [frontend/js/modules/task-spec.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/js/modules/task-spec.js)、[frontend/js/modules/review.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/js/modules/review.js)、[frontend/js/modules/artifacts.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/js/modules/artifacts.js)：分别处理任务定义与全局 LLM 设置、人工复核、产物结构化浏览。
  7. [frontend/styles/index.css](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles/index.css)、[frontend/styles/tokens.css](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles/tokens.css)、[frontend/styles/base.css](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles/base.css)、[frontend/styles/theme.css](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles/theme.css)：样式入口、设计 token、基础布局与主题层。
  8. [src/dataforge/core/registry.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/registry.py)：任务发现、默认 scaffold 生成、`TaskConfig`/`TaskRun` 建模、run 状态推进、产物路径映射。
  9. [src/dataforge/core/runtime_catalog.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/runtime_catalog.py)：builtin/custom provider catalog、推荐模型、provider 字段目录、运行时默认值解析，以及扫描模型列表的持久化覆盖。
  10. [src/dataforge/core/env.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/env.py)：`.env` 读取、增量写回、进程环境应用与“外部已导出变量优先”策略。
  11. [src/dataforge/core/io.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/io.py)：YAML/JSON/JSONL/Text 读写、目录保障、manifest 持久化。
  12. [src/dataforge/core/schemas.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/schemas.py)：样本 schema 校验，覆盖 candidate/classified/reviewed/gold 四个 stage。
  13. [src/dataforge/core/filters.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/filters.py) 与 [src/dataforge/core/dedupe.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/dedupe.py)：样本去重、规则过滤、review pool 划分，以及跨 run 历史泄漏拦截。
  14. [src/dataforge/core/review.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/review.py)：复核记录模板、复核校验、复核统计、多轮 review 聚合与 review 应用。
  15. [src/dataforge/core/eval_runner.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/eval_runner.py)：评测指标计算、Promptfoo tests 导出、运行时 Promptfoo 配置生成、Promptfoo CLI 执行与 summary/confusion 报告生成。
  16. [src/dataforge/core/exporters.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/exporters.py) 与 [src/dataforge/core/versioning.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/versioning.py)：导出格式渲染、Promptfoo 测试结构复用、数据版本摘要生成。
  17. [src/dataforge/providers/](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/providers)：provider 抽象与具体模型接入。
  18. [src/dataforge/pipelines/](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines)：按 stage 划分的流水线执行单元，现包含 `generate`、`classify`、`filter_export`、`review_export`、`validate_review`、`build_gold`、`eval`、`student_export`。
  19. [tasks/report-intent-distill/configs/](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs) 与 [tasks/test/configs/](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/test/configs)：任务级静态配置、prompt、labels、scenario matrix 与 Promptfoo 模板。
- 关键职责:
  1. `registry` 负责统一 task scaffold 与 run 生命周期，保证 `index.json`、`latest.json`、`status`、`last_stage`、`stages` 同步更新。
  2. `pipelines` 各自只处理单一 stage，并在结束后写入对应 manifest。
  3. `web/app.py` 不直接执行 shell CLI，而是复用现有 Python pipeline 函数作为执行桥接层，避免浏览器直接运行命令。
  4. `web/app.py` 中 `_normalize_task_create_payload()` 负责 new task scaffold 的默认化与合法性校验；`_normalize_task_config_files()`、`_normalize_runtime()`、`_normalize_scenarios()` 等函数负责把前端提交的配置规整为可落盘结构，再由 `_save_task_config_files()` 分别写入各配置文件。
  5. `web/app.py` 中 `_save_global_llm_settings()`、`_resolve_global_llm_runtime()` 与 `_probe_llm_connection()` 负责 builtin/custom provider 设置保存、运行时解析与连通性测试；其中 `_probe_llm_connection()` 会先尝试扫描远端模型列表、推断最新生成模型，再执行 probe，并兼容“尚未保存的 custom provider 用即时表单值探活”。`_delete_run()`、`_write_runs_index()`、`_sync_latest_run_pointer()` 负责删除 run 后维持 run 索引一致性，`_delete_task()` 则负责删除整个 task 目录并重新发现剩余任务。
  6. `core/runtime_catalog.py` 负责把 builtin provider、`.dataforge/runtime_providers.json` 中的 custom alias 与 `.dataforge/runtime_provider_models.json` 中的模型覆盖合并成统一 catalog，并为前端编辑器提供 `stages`、`fields`、`providers` 与推荐模型。
  7. `core/env.py` 负责 `.env` 的增量更新与环境变量注入；`load_dotenv()` 不会覆盖外部已经导出的同名环境变量。
  8. `frontend/app.js` 负责前端状态机，围绕 `selectedTask`、`selectedRun`、`taskSpec`、`artifactPayload`、`reviewRecords`、`isEditingTaskConfig`、`llmSettings`、`activeTab`、`deletingTaskName` 等状态组织页面更新，并维护 `rawCandidateViewMode`、`rawCandidateGroupBy` 等结构化浏览状态。
  9. `frontend/index.html` 当前采用任务页签加侧边栏 settings rail 的工作台布局，将“任务定义”“运行控制”“运行产物”“人工复核”拆成独立面板，同时为 workspace 级全局模型配置预留独立入口。
  10. `frontend/js/modules/task-spec.js` 同时负责 task 配置编辑与全局 LLM 设置面板，支持 provider alias 新增/删除、即时探测、运行时推荐模型回填，以及 task scaffold 创建后的二次编辑；其中 custom provider 的 `Provider ID` 会自动规范化为合法 id，并派生 `BASE_URL/API_KEY` env key，展示名也直接跟随 `Provider ID`。
  11. `frontend` 在产物展示上默认只展示实际存在的 artifact，并隐藏 `*_manifest`，结构化浏览优先于原始 JSONL 转储；`ARTIFACT_EXPLANATIONS` 为每个 artifact 提供“用途/阶段/阅读提示”说明。
  12. `core/review.py` 中 `group_review_records()` 与 `merge_review_records()` 负责将同一样本的多轮复核记录按输入顺序聚合，再由 `build_gold` 只消费每个 `sample_id` 的最终状态，避免重复产出 gold 样本。
  13. `core/eval_runner.py` 中 `build_promptfoo_runtime_config()` 会把任务侧 `promptfoo.yaml` 渲染为 run 级配置文件，`run_promptfoo_eval()` 则调用本机 `promptfoo eval` 并回收结果摘要，`build_eval_result()` 则把评测结果转成结构化 `eval_result.json`。
  14. `core/exporters.py` 负责把内部样本转换为 `chatml_jsonl`、`prediction_jsonl`、`promptfoo_jsonl` 等目标格式，主流程只消费导出接口，不直接写死格式。
  15. `core/versioning.py` 负责给 train/eval/hard cases/student 产物生成统一版本摘要，便于 run 内回放与追责。
- 主要依赖:
  1. `fastapi`：提供本地工作台 HTTP API。
  2. `uvicorn`：提供本地 ASGI 服务启动。
  3. `pytest`：测试与 smoke 验证。
  4. `pyyaml`：任务与场景配置解析。
  5. 本机 `promptfoo` CLI：执行 Promptfoo 离线评测并输出 JSON 结果。
  6. Python 标准库 `argparse`、`json`、`pathlib`、`datetime`、`subprocess` 等：支撑 CLI、配置、文件组织、本地服务启动与外部评测命令调用。

### 依赖关系
- 外部依赖:
  1. [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml) 当前声明 `fastapi`、`uvicorn`、`pytest`、`pyyaml`。
  2. `openai_compatible` 通过标准 Chat Completions HTTP 接口对接 OpenAI 风格 relay。
  3. `anthropic_compatible` 通过 Messages HTTP 接口对接 Anthropic 风格 relay。
  4. `minimax` 复用 `anthropic_compatible` 实现，仅替换默认环境变量为 `MINIMAX_BASE_URL` 与 `MINIMAX_API_KEY`。
  5. `promptfoo` 通过本机 CLI 执行离线评测；当前任务默认依赖用户环境中可直接调用的 `promptfoo` 命令。
- 内部依赖:
  1. CLI 依赖 `core.env`、`core.registry` 和所有 `pipelines`。
  2. Web API 依赖 `core.env`、`core.io`、`core.registry`、`core.review`、`core.runtime_catalog`、provider clients 与各 pipeline。
  3. 前端只通过 `fetch()` 调用本地 HTTP API，不直接触达文件系统；任务配置与全局设置分别消费 `/api/tasks/*` 与 `/api/settings/llm*`。
  4. `runtime_provider_catalog()` 会把 builtin provider、`.dataforge/runtime_providers.json` 中的自定义 provider alias 与 `.dataforge/runtime_provider_models.json` 中的模型覆盖合并，再由 `resolve_runtime_map()` 把 task runtime 映射成真正可执行的实现配置。
  5. `pipelines.generate/classify/eval` 依赖 provider registry 获取具体 provider。
  6. `pipelines.filter_export` 依赖 `dedupe`、`filters`、`exporters`、`versioning`、`io`、`registry`，其中 `exclude_historical_leakage()` 负责基于历史 `gold/eval/hard_cases` 拦截潜在泄漏样本。
  7. `pipelines.review_export/validate_review/build_gold` 依赖 `review` 模块处理人工复核闭环，其中 `build_gold` 基于多轮 review 聚合后的最终状态构建 gold。
  8. `TaskRun.path_for()` 是运行期文件寻址的中心入口，CLI stage 与 Web API 均通过 artifact key 间接访问具体路径。
  9. `pipelines.eval` 依赖 `core.eval_runner` 生成 Promptfoo tests、运行时配置和 CLI 调用摘要，同时复用 provider registry 产出 DataForge 自己的预测结果，并写出 `eval_result.json` 与 `eval_dataset_metadata.json`。
  10. `pipelines.student_export` 依赖 `core.exporters` 与 `core.versioning`，把过滤后的训练样本打包成标准 student 训练输入。

### 数据流/控制流
- 数据来源:
  1. 任务元配置来自 [tasks/report-intent-distill/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/task.yaml)。
  2. 其他 task 的同构配置来自 [tasks/test/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/test/configs/task.yaml) 等 task 目录；新 task 由 `create_task_scaffold()` 自动生成同结构配置。
  3. 生成场景来自 `tasks/<task>/configs/scenario_matrix.yaml`。
  4. 标签集合来自 `tasks/<task>/configs/labels.yaml`。
  5. prompt 模板来自 `generator_prompt.txt` 与 `teacher_prompt.txt`。
  6. 运行期密钥、base URL 与默认模型可从项目根目录 `.env` 或外部环境变量注入。
  7. 自定义 provider alias 元数据来自 `.dataforge/runtime_providers.json`。
  8. provider 扫描得到的模型列表来自 `.dataforge/runtime_provider_models.json`；若文件不存在，则退回 builtin/catalog 默认模型。
- CLI 数据处理链路:
  1. `generate`：读取 scenario matrix，调用 generator provider 产出 `raw/raw_candidates.jsonl`，并做 schema 校验。
  2. `classify`：读取候选样本，调用 teacher provider 输出 `raw/teacher_labeled.jsonl`，在 `annotation` 中补齐教师标签、原始输出、解析状态与错误码。
  3. `filter-export`：读取教师标注结果，基于 `user_text`、`parse_ok`、允许标签、长度限制和任务规则过滤；先按 `(user_text.lower(), has_visible_report, teacher_label)` 去重，再对训练子集执行跨 run 泄漏拦截，最后输出内部训练样本、配置化 train export、版本元数据、拒绝集、复核池与空的 Promptfoo 占位文件。
  4. `review-export`：把 review pool 组装成待人工复核模板 `processed/review_candidates.jsonl`。
  5. `validate-review`：校验 `processed/review_results.jsonl`，输出 `reports/review_validation.md`。
  6. `build-gold`：先按 `sample_id` 聚合同一样本的多轮人工复核记录，再将最终有效结论回写到教师标注样本，冻结为 `gold/gold_eval.jsonl`，并抽取带 `hard_case_reason` / `hard_case_recorded_at` 的 hard cases，同时输出 `hard_cases_metadata.json`。
  7. `eval`：对 gold 集重新做预测，输出 `exports/eval_dataset.jsonl`、`exports/eval_dataset_metadata.json`、`exports/eval_predictions.jsonl`、`exports/eval_for_promptfoo.jsonl`、`reports/eval_result.json`、`reports/promptfoo/config.yaml`、`reports/promptfoo/results.json`、`reports/eval_summary.md`、`reports/confusion_analysis.md`。
  8. `student-export`：读取 `processed/filtered_train.jsonl`，按 `exports.student_format` 生成 `training/student_train.jsonl` 与 `training/metadata.json`。
- Web 控制流:
  1. 前端初始化时通过 `refreshAll()` 先调用 `GET /api/settings/llm` 与 `GET /api/tasks`，同步全局 provider 状态和 task 列表。
  2. 用户点击侧边栏 Workspace 设置入口后，页面切到 `settings` 视图；前端基于 provider 数、ready 数与最近 probe 结果渲染 workspace 摘要。
  3. 用户点击“新建任务”后，前端先用 `createDefaultTaskConfig()` 生成默认 payload，再调用 `POST /api/tasks`；后端用 `create_task_scaffold()` 创建 task 目录、默认配置和空 `runs/`，前端随后自动选中该 task 并进入编辑态。
  4. 选择 task 后，前端继续调用 `GET /api/tasks/{task_name}/spec`、`GET /api/tasks/{task_name}/config-files` 和 `GET /api/tasks/{task_name}/runs`，分别加载只读任务定义、可编辑配置草稿和 run 列表。
  5. `GET /api/tasks/{task_name}/config-files` 除任务配置外还会返回 `runtime_catalog`，前端据此渲染 runtime provider 卡片、推荐模型和 provider-specific 字段。
  6. 任务定义页默认处于只读查看态；用户点击“编辑配置”后，前端把 `isEditingTaskConfig` 置为 `true`，切换到独立编辑态，隐藏只读摘要区。用户保存配置时调用 `PUT /api/tasks/{task_name}/config-files`；后端负责校验 task/runtime/rules/exports/labels/scenarios/prompts，并分别回写真实配置文件，再返回最新 `config` 和 `spec` 供前端刷新。
  7. 全局模型设置页支持调用 `PUT /api/settings/llm` 保存 builtin/custom provider 配置，并通过 `POST /api/settings/llm/test` 使用即时表单值做连通性测试；后端会同时维护 `.env`、`.dataforge/runtime_providers.json`、`.dataforge/runtime_provider_models.json` 与当前进程环境。
  8. 选择 run 后，前端调用 `GET /api/tasks/{task_name}/runs/{run_id}`、`GET /api/tasks/{task_name}/runs/{run_id}/artifacts/{artifact_key}`、`GET /api/tasks/{task_name}/runs/{run_id}/review-records`，分别拉取运行摘要、单个产物和复核数据。
  9. 用户点击 stage 按钮时，前端调用 `POST /api/tasks/{task_name}/commands/{command}`；FastAPI 内部经 `resolve_task_run()` 和 `_run_command()` 复用原 pipeline 逻辑执行任务。
  10. 用户编辑 review 后，前端调用 `PUT /api/tasks/{task_name}/runs/{run_id}/review-records`；后端负责标准化 `reviewed_by`、`reviewed_at`、`reviewer_label` 并写回 `review_results.jsonl`。
  11. 用户删除 task 时，前端调用 `DELETE /api/tasks/{task_name}`；后端删除 `tasks/<task_name>/` 全目录并重新发现剩余任务，前端随后刷新 task 列表，并在删除的是当前 task 时清空工作区状态后自动切到新的可用 task。
  12. 用户删除 run 时，前端调用 `DELETE /api/tasks/{task_name}/runs/{run_id}`；后端删除对应目录后重写 `runs/index.json`，并根据剩余 runs 更新或移除 `latest.json`，前端随后刷新 run 列表并自动选中剩余最新 run。
  13. 用户切换“运行产物”页中的 artifact 时，前端先渲染 artifact explanation，再根据 artifact 类型进入结构化视图；其中 `raw_candidates` 支持表格/分类双视图，`rejected_samples` 支持按 `rejection_reason` 汇总与过滤。
- 控制/调度规则:
  1. `resolve_task_run()` 在 `generate`/`run-all` 时总是新建 run，在其他命令下优先复用 `latest.json` 指向的最新 run。
  2. 每个 stage 完成后调用 `write_run_manifest()` 与 `task.record_stage()`，推进 `status`、`last_stage`、`stages`。
  3. `RUN_STATUS_ORDER` 保证状态只能向前推进，避免晚执行的低优先级 stage 把总体状态回退。
  4. Web 端 artifact 接口对 `.jsonl` 返回限制条数的结构化内容，对 `.json` 返回对象，对文本文件返回截断文本，避免页面一次性加载过大文件。
  5. run 删除不依赖数据库事务；一致性由 `_delete_run()` 串行完成目录删除、索引重写和 latest 指针同步，保证页面刷新后不会继续引用已删除 run。
  6. task 删除同样不依赖数据库事务；一致性由 `_delete_task()` 直接删除 `tasks` 根目录下的目标 task 目录，并拒绝删除 `tasks/` 之外的路径。
  7. `build-gold` 对每个 `sample_id` 只产出一条 gold 样本，最终 `review_status` 与 `human_label` 以该样本最后一次有效人工结论为准。
  8. `eval` 会先导出 Promptfoo tests，再根据任务侧 `promptfoo.yaml` 渲染 run 级配置，并调用本机 `promptfoo eval --output <results.json> --no-cache`；若 CLI 缺失或执行失败，会直接抛出错误终止阶段。
  9. 全局 LLM 设置保存时，builtin provider 的 base URL / API key / default model 会写回固定环境变量；custom provider 会写入 `.dataforge/runtime_providers.json`，并在 env key 变更时迁移或清理旧键；扫描得到的模型列表则写入 `.dataforge/runtime_provider_models.json`，供后续页面刷新与 runtime catalog 直接复用。
  10. `POST /api/settings/llm/test` 在 custom provider 尚未保存时，允许前端把 `implementation`、`base_url_env`、`api_key_env` 一并传入后端做临时 runtime 解析，不要求 provider id 先存在于持久化 catalog。

### 关键配置
- 配置文件:
  1. [pyproject.toml](/Users/teabamboo/Documents/AIplusLLM/DataForge/pyproject.toml)：包定义、CLI/Web 脚本入口、依赖、pytest 配置。
  2. [README.md](/Users/teabamboo/Documents/AIplusLLM/DataForge/README.md)：操作命令、run versioning 说明、provider 配置示例。
  3. [tasks/report-intent-distill/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/task.yaml)：任务主题、runtime、paths、rules、exports。
  4. [tasks/report-intent-distill/configs/promptfoo.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/configs/promptfoo.yaml)：Promptfoo 模板配置，定义 providers、prompts 与 run 时注入的 tests 占位符。
  5. [tasks/report-intent-distill/README.md](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/report-intent-distill/README.md)：任务级运行说明与 provider 切换示例。
  6. [tasks/test/configs/task.yaml](/Users/teabamboo/Documents/AIplusLLM/DataForge/tasks/test/configs/task.yaml)：第二个内置 task 的 runtime/rules/exports 示例。
  7. [src/dataforge/core/runtime_catalog.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/runtime_catalog.py)：builtin/custom provider 目录与运行时字段定义。
  8. `.env`：全局 provider 凭据、base URL 与默认模型的本地配置来源。
  9. `.dataforge/runtime_providers.json`：custom provider alias 的持久化配置文件。
  10. `.dataforge/runtime_provider_models.json`：provider 模型扫描结果的持久化配置文件。
- 关键参数:
  1. `runtime.<stage>.provider`：决定 stage 选择的 provider 实现。
  2. `model`、`temperature`、`max_tokens`、`max_retries`、`retry_backoff_seconds`：控制模型调用与重试。
  3. `paths.*`：静态配置和 prompt 文件的项目内绝对解析入口。
  4. `rules.disallow_rewrite_without_visible_report`：过滤阶段的重要业务约束。
  5. `exports.*`：训练集、评测集与 student 训练产物的目标格式声明。
  6. `scenario.generation_count`：控制该场景预计生成多少样本；若留空，则退化为 `templates` 条数。
  7. `rejection_reason`：`filter-export` 输出给拒绝样本的诊断字段，用于前端汇总、筛选和问题定位。
  8. Web 启动参数 `--host`、`--port`、`--project-root`：控制本地工作台绑定地址与项目根目录。
  9. `promptfoo.yaml` 中 `dataforge.command`：定义 DataForge 在运行时调用 Promptfoo CLI 的命令前缀；当前任务默认使用本机 `promptfoo`。
  10. `promptfoo.yaml` 中 `tests: file://__DATAFORGE_EVAL_FOR_PROMPTFOO__`：作为占位符，在 `eval` 阶段被渲染为当前 run 对应的 `exports/eval_for_promptfoo.jsonl` 绝对路径。
  11. `base_url_env`、`api_key_env`、`DATAFORGE_*_MODEL`：决定 provider 运行时从哪些环境变量读取 endpoint、密钥与默认模型；custom provider 的 `base_url_env/api_key_env` 现在由 `Provider ID` 自动派生，不再由用户手输。
  12. `runtime_catalog.providers[].provider_fields` 与 `runtime_catalog.fields`：决定前端 runtime 编辑器展示哪些通用/特定字段。
- 运行环境约束:
  1. 需要 Python 3.9+。
  2. 若使用真实 provider，必须提供对应 API key 与 base URL 环境变量。
  3. `eval` 阶段若要执行 Promptfoo，要求本机环境中可直接调用 `promptfoo` 命令。
  4. 当前项目未接入数据库、消息队列或远程存储，所有产物均写入本地文件系统。
  5. 前端不经过构建流程，依赖浏览器直接加载 `frontend/index.html`、`frontend/app.js`、`frontend/js/*` 与 `frontend/styles/index.css`。
  6. `.env` 中的值只会作为默认值加载；若同名变量已在外部环境中导出，`load_dotenv()` 不会覆盖它。

### 运行流程
- CLI 工作流:
  1. 通过 `uv run dataforge generate --task <task>` 或 `run-all` 创建新的 `run_id`；当前仓库已存在 `report-intent-distill` 与 `test` 两个 task。
  2. 在自动流程结束后，人工或外部工具填充 `processed/review_results.jsonl`。
  3. 继续运行 `validate-review`、`build-gold`、`eval` 完成闭环；其中 `eval` 会额外在当前 run 下写入 Promptfoo 配置、结构化评测摘要与 eval 版本元数据。
  4. 如需交给 student 训练，再运行 `student-export` 输出 `training/student_train.jsonl` 与 `training/metadata.json`。
- Web 工作流:
  1. 通过 `uv run dataforge-web --host 127.0.0.1 --port 8013` 启动本地工作台。
  2. 浏览器打开首页后，工作台会先刷新全局 LLM 设置与 task 列表；左侧可切 task / run，顶部通过页签在“运行控制”“任务定义”“运行产物”“人工复核”之间切换，侧边栏单独进入“全局设置”。
  3. 用户可通过“新建任务”按钮创建 scaffold；创建成功后页面自动进入该 task 的编辑态，继续完善 task metadata、runtime、rules、exports、labels、scenario matrix 和 prompts。
  4. “运行控制”页签直接触发 stage，替代部分终端操作。
  5. “任务定义”页签默认展示 task 概览、labels、rules、exports、runtime、scenario matrix 和 generator/teacher prompt 的只读视图。
  6. 用户点击“编辑配置”后，页面切入独立编辑态，可修改基础信息、runtime、规则、导出、labels、scenario matrix 和 prompts；保存后退出编辑态，取消则回退草稿。
  7. “全局设置”视图允许维护 builtin provider 凭据、默认模型与 custom provider alias，并可对每个 provider 直接发起连通性测试；测试成功后会自动同步模型列表并把最新模型写入 `Default Model`。
  8. “运行产物”页签只展示实际存在的 artifact，默认优先结构化浏览，不展示 `*_manifest`，并在主视图上方给出该 artifact 的阶段、用途与阅读提示。
  9. custom provider 编辑区中只保留 `Provider ID`、`Family`、`Badge`、`Description`、`Base URL`、`API Key` 与 `Default Model` 等必要字段；展示名直接使用 `Provider ID`，`BASE_URL/API_KEY` env key 只读展示。
  10. `raw_candidates` 在产物页支持表格视图与分类视图，可按 `label_hint`、`difficulty`、`has_visible_report`、`dialogue_stage` 进行分组排查。
  11. `rejected_samples` 在产物页会先汇总 `rejection_reason`，再展示明细表，便于定位主要损耗来源。
  12. 用户可在 task 列表中直接删除整个 task，删除后页面会自动刷新任务列表，并在删除当前 task 时切换到剩余可用 task 或清空工作区。
  13. 用户可在 run 列表中直接删除不需要的历史 run，删除后页面会自动刷新并切换到剩余可用 run。
  14. “人工复核”页签可直接编辑并保存 `review_results.jsonl`。
  15. 每次运行的索引保存在 `tasks/<task>/runs/index.json`，最新 run 指针保存在 `latest.json`。
- 异常/边界处理:
  1. 若非 `generate`/`run-all` 且没有历史 run，`resolve_task_run()` 会直接报错，要求先创建 run 或显式传入 `run_id`。
  2. provider 返回非 JSON 或缺失 `action` 时，会把 `parse_ok` 置为 `False` 并写入错误码，而不是静默吞掉异常。
  3. `build-gold` 在 `review_results` 中找不到对应样本时会直接抛错，阻止生成不完整 gold 集。
  4. schema 与 review 校验均采用 fail-fast 策略，不做自动修复。
  5. 删除不存在的 run 时，`DELETE /api/tasks/{task_name}/runs/{run_id}` 会返回 404，避免前端误以为删除成功。
  6. 删除不存在的 task 时，`DELETE /api/tasks/{task_name}` 会返回 404；若目标目录不在 `tasks/` 根目录下，后端会直接拒绝删除。
  7. API 层将 `FileNotFoundError`、`ValueError` 映射为 `400/404`，前端通过消息条显示错误。
  8. `eval` 若找不到本机 `promptfoo` 命令，或 Promptfoo 运行失败，会在 `run_promptfoo_eval()` 中直接抛出异常并终止当前阶段。
- 观测与日志:
  1. 当前没有统一日志系统或链路追踪。
  2. 可观测性主要依赖 `reports/manifests/*.json`、`reports/eval_result.json`、`exports/*_metadata.json`、`reports/promptfoo/results.json`、`eval_summary.md`、`confusion_analysis.md`、`review_validation.md`、`runs/index.json` 与前端消息条。
  3. 从测试与校验角度，`tests/test_pipeline_smoke.py` 覆盖完整 smoke 流程，`tests/test_eval_runner.py` 覆盖 Promptfoo 集成与结构化摘要，`tests/test_exporters.py` 覆盖导出层，`tests/test_student_export.py` 与 `tests/test_dedupe.py` 分别覆盖 student 出口与防泄漏逻辑，`tests/test_web_app.py` 额外覆盖 task scaffold、runtime catalog、task 删除、未保存 custom provider 探活、模型扫描与全局 LLM 设置序列化/持久化；前端当前通过 `node --check frontend/js/modules/task-spec.js` 做全局设置模块的最小语法校验。

## 改动概要/变更记录

### 2026-04-06 00:00:43
- 本次新增/更新要点:
  1. 根据最新代码补齐 provider 模型扫描链路，更新 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py) 中 `_probe_llm_connection()` 先扫描模型列表、推断最新模型并在 probe 成功后返回 `models/latest_model` 的行为说明。
  2. 更新 runtime catalog 持久化说明，补充 [src/dataforge/core/runtime_catalog.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/runtime_catalog.py) 新增 `.dataforge/runtime_provider_models.json` 以及模型覆盖合并逻辑。
  3. 更新全局设置前端说明，补充 [frontend/js/modules/task-spec.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/js/modules/task-spec.js) 中 custom provider 以 `Provider ID` 驱动展示名与 env key、删除独立 `Label` 字段，以及测试连通后自动回填模型列表与最新默认模型的行为。
  4. 更新边界与测试说明，补充 [tests/test_web_app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_web_app.py) 对未保存 custom provider 探活、模型扫描回退与模型覆盖持久化的覆盖。
- 变更动机/需求来源: 用户要求把当前最新代码同步到 `docs/architecture.md`，重点反映全局 LLM 设置这轮新增的模型扫描、custom provider 探活和 UI 简化后的真实实现。
- 当前更新时间: 2026-04-06 00:00:43

### 2026-04-05 22:34:01
- 本次新增/更新要点:
  1. 根据最新代码补齐全局 LLM 设置链路，更新 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py)、[src/dataforge/core/runtime_catalog.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/runtime_catalog.py) 与 [src/dataforge/core/env.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/env.py) 中 builtin/custom provider、`.env` 增量写回、`.dataforge/runtime_providers.json` 持久化及连通性测试说明。
  2. 更新前端架构说明，补充 [frontend/app.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/app.js)、[frontend/js/core/](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/js/core)、[frontend/js/modules/](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/js/modules) 与 [frontend/styles/](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles) 的模块化拆分与 settings 视图职责。
  3. 更新 task 生命周期说明，补充 `POST /api/tasks` 对 task scaffold 的创建流程、默认配置来源，以及仓库当前已存在 `report-intent-distill`、`test` 两个 task。
  4. 更新测试说明，补充 [tests/test_web_app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_web_app.py) 对 task scaffold、runtime catalog 与全局 LLM 设置持久化的覆盖。
- 变更动机/需求来源: 用户要求依据当前代码再次更新 `docs/architecture.md`，重点同步任务 scaffold、全局模型设置与前端模块化拆分后的真实实现。
- 当前更新时间: 2026-04-05 22:34:01

### 2026-04-05 18:04:32
- 本次新增/更新要点:
  1. 根据最新代码补齐 task 删除能力，更新 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py) 中 `DELETE /api/tasks/{task_name}`、`_delete_task()` 与目录级删除保护逻辑说明。
  2. 更新前端工作台说明，补充 [frontend/app.js](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/app.js) 的 task 删除交互、删除后的工作区状态回退，以及侧边栏 task 卡片旁的删除按钮。
  3. 更新任务配置编辑页说明，补充 [frontend/index.html](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/index.html) 与 [frontend/styles/](/Users/teabamboo/Documents/AIplusLLM/DataForge/frontend/styles) 中 runtime 编辑区跨整行、自适应列宽布局的实现约束。
  4. 更新测试说明，补充 [tests/test_web_app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_web_app.py) 对 task 删除能力的覆盖。
- 变更动机/需求来源: 用户要求把最新代码同步到 `docs/architecture.md`，重点反映 task 删除链路与任务配置 UI 布局修正后的真实实现。
- 当前更新时间: 2026-04-05 18:04:32

### 2026-04-04 10:30:00
- 本次新增/更新要点:
  1. 根据最新代码补齐配置化导出层，更新 [src/dataforge/core/exporters.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/exporters.py) 与 [src/dataforge/pipelines/filter_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/filter_export.py)、[src/dataforge/pipelines/eval.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/eval.py) 的 train/eval export 说明。
  2. 更新 `eval` 阶段说明，补充 [src/dataforge/core/eval_runner.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/eval_runner.py) 生成 `eval_result.json`、run 摘要与结构化 Promptfoo 概览的行为。
  3. 更新数据治理说明，补充 [src/dataforge/core/dedupe.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/dedupe.py) 的跨版本泄漏拦截，以及 `*_metadata.json` 版本摘要文件。
  4. 更新训练出口说明，补充 [src/dataforge/pipelines/student_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/student_export.py) 与 `training/` 目录约定。
- 变更动机/需求来源: 用户要求继续实现 checklist 中所有尚未落地的工程项，并同步文档到最新代码行为。
- 当前更新时间: 2026-04-04 10:30:00

### 2026-03-30 19:11:05
- 本次新增/更新要点:
  1. 根据最新代码补齐多轮 review merge 规则，更新 [src/dataforge/core/review.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/review.py) 中 `group_review_records()`、`merge_review_records()` 与 [src/dataforge/pipelines/build_gold.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/build_gold.py) 的 gold 构建逻辑说明。
  2. 更新 `eval` 阶段说明，明确 [src/dataforge/core/eval_runner.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/eval_runner.py) 现在会导出 Promptfoo tests、渲染 run 级 Promptfoo 配置、调用本机 `promptfoo` CLI 并回收 JSON 结果。
  3. 更新关键输出与运行环境约束，补充 `reports/promptfoo/config.yaml`、`reports/promptfoo/results.json` 和本机 `promptfoo` 依赖。
  4. 更新测试说明，补充 [tests/test_eval_runner.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_eval_runner.py) 对 Promptfoo 集成的最小覆盖。
- 变更动机/需求来源: 用户要求依据最新代码再次更新 `docs/architecture.md`，补齐多轮 review 合并与 Promptfoo 真实执行链路等最近迭代后的真实行为。
- 当前更新时间: 2026-03-30 19:11:05

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
