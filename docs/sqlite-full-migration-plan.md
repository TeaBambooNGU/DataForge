# DataForge SQLite 完整迁移实施清单

更新时间: 2026-04-16

## 目标

将 DataForge 当前基于本地文件系统的运行期数据存储，完整迁移为以 SQLite 为主存储的架构。

本次迁移的目标不是“额外增加一个数据库层”，而是把 SQLite 升级为系统事实来源，覆盖以下运行期数据：

- run 索引与状态
- stage manifest
- review 记录
- 原始候选样本
- 教师标注样本
- filtered train
- rejected samples
- review candidates
- gold eval
- hard cases
- eval predictions
- 各类 metadata JSON

以下内容继续保留在文件系统中：

- `tasks/<task>/configs/*`
- `.env`
- `.dataforge/runtime_providers.json`
- `.dataforge/runtime_provider_models.json`
- 对外导出的 `exports/*.jsonl`
- 对外可读的 `reports/*.md`
- `reports/promptfoo/*`

## 范围边界

本方案覆盖：

- 后端 Python 存储层
- run 生命周期管理
- 全部 pipeline 的输入输出链路
- review 闭环
- Web API 的 artifact 查询
- 历史 runs 数据迁移
- 自动化测试补齐

本方案暂不覆盖：

- 任务配置文件 YAML 的数据库化
- provider 配置文件的数据库化
- 前端大规模重构
- ORM 引入

## 现状问题

当前项目是“文件系统即数据库”的设计，核心依赖包括：

- [src/dataforge/core/io.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/io.py)
- [src/dataforge/core/registry.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/registry.py)
- [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py)
- [src/dataforge/pipelines/filter_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/filter_export.py)
- [src/dataforge/pipelines/build_gold.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/build_gold.py)

当前主要耦合点：

- `RUN_ARTIFACT_PATHS` 直接把 artifact key 映射为磁盘路径
- 各 pipeline 通过 `task.path_for(...)` 直接读写 JSON/JSONL
- `runs/index.json` 和 `latest.json` 承担 run 生命周期管理
- Web API 默认通过文件类型推断 artifact 内容

这意味着完整 SQLite 迁移不是单点替换，而是一次存储边界重构。

## 迁移目标架构

迁移完成后采用以下原则：

- SQLite 是运行期主存储
- 文件导出是数据库派生产物，不再作为事实来源
- pipeline 之间通过统一 storage 接口传递数据，而不是通过 JSONL 文件
- Web API 默认从数据库读取 artifact
- 配置类静态文件仍然保留在 `tasks/<task>/configs/`

建议数据库文件位置：

- `project_root/.dataforge/dataforge.db`

## 数据模型设计

建议使用 Python 标准库 `sqlite3`，先不引入 ORM。

### 表 1: `tasks`

字段建议：

- `id`
- `name`
- `task_root`
- `created_at`
- `updated_at`

约束：

- `name` 唯一

### 表 2: `runs`

字段建议：

- `id`
- `task_id`
- `run_id`
- `status`
- `last_stage`
- `created_at`
- `updated_at`

约束：

- `(task_id, run_id)` 唯一

索引：

- `(task_id, updated_at desc)`

### 表 3: `run_stages`

字段建议：

- `id`
- `run_id`
- `stage_name`
- `completed_at`
- `stats_json`
- `summary_json`
- `manifest_json`

约束：

- `(run_id, stage_name)` 唯一

### 表 4: `artifacts`

字段建议：

- `id`
- `run_id`
- `artifact_key`
- `content_type`
- `record_count`
- `updated_at`
- `metadata_json`

说明：

- `content_type` 用于区分 `records`、`blob`、`export_file`

约束：

- `(run_id, artifact_key)` 唯一

### 表 5: `artifact_records`

字段建议：

- `id`
- `artifact_id`
- `record_index`
- `sample_id`
- `payload_json`

说明：

- 用于替代 JSONL 型 artifact
- `payload_json` 保存完整记录，先不做强拆列

索引：

- `(artifact_id, record_index)`
- `(artifact_id, sample_id)`

### 表 6: `artifact_blobs`

字段建议：

- `id`
- `artifact_id`
- `payload_json`

说明：

- 用于保存单对象 JSON，如 `eval_result`、`hard_cases_metadata`

### 表 7: `review_records`

字段建议：

- `id`
- `run_id`
- `sample_id`
- `review_decision`
- `reviewer_label`
- `review_comment`
- `reviewed_by`
- `reviewed_at`
- `payload_json`

说明：

- review 单独建表，避免每次都从 artifact records 中反向提取
- 兼容前端现有 review 页面时，可在 API 层重新组装旧结构

### 表 8: `schema_migrations`

字段建议：

- `id`
- `version`
- `applied_at`

用途：

- 管理数据库 schema 版本

## 数据与 artifact 映射策略

建议映射如下：

- `raw_candidates` -> `artifacts` + `artifact_records`
- `teacher_labeled` -> `artifacts` + `artifact_records`
- `filtered_train` -> `artifacts` + `artifact_records`
- `rejected_samples` -> `artifacts` + `artifact_records`
- `review_candidates` -> `artifacts` + `artifact_records`
- `gold_eval` -> `artifacts` + `artifact_records`
- `hard_cases` -> `artifacts` + `artifact_records`
- `eval_predictions` -> `artifacts` + `artifact_records`
- `review_results` -> `review_records`
- `train_export_metadata` -> `artifacts` + `artifact_blobs`
- `eval_export_metadata` -> `artifacts` + `artifact_blobs`
- `training_metadata` -> `artifacts` + `artifact_blobs`
- `eval_result` -> `artifacts` + `artifact_blobs`
- `hard_cases_metadata` -> `artifacts` + `artifact_blobs`

以下保留为导出文件：

- `train_export`
- `eval_export`
- `eval_for_promptfoo`
- `student_train`
- `eval_summary`
- `confusion_analysis`
- `review_validation_report`
- `promptfoo_config`
- `promptfoo_results`

## 分阶段实施清单

## Phase 1: 建立数据库基础设施

目标：

- 引入 SQLite 连接管理
- 初始化 schema
- 确定数据库文件位置与 PRAGMA

实施步骤：

1. 新增 [src/dataforge/core/db.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/db.py)
2. 新增 [src/dataforge/core/migrations.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/migrations.py)
3. 定义数据库路径解析逻辑
4. 实现 schema 初始化与版本检查
5. 配置 SQLite PRAGMA

涉及文件：

- `src/dataforge/core/db.py`
- `src/dataforge/core/migrations.py`
- `src/dataforge/__init__.py`

验收标准：

- 首次启动时自动创建 `.dataforge/dataforge.db`
- 重复启动不会重复建表
- 能通过简单测试插入和查询任务记录

## Phase 2: 抽象统一存储接口

目标：

- 把 pipeline 与文件路径解耦
- 建立 DB 为主的 artifact 读写边界

实施步骤：

1. 新增 [src/dataforge/core/storage.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/storage.py)
2. 封装以下能力：
   - `ensure_task()`
   - `ensure_run()`
   - `get_latest_run()`
   - `save_artifact_records()`
   - `load_artifact_records()`
   - `save_blob_artifact()`
   - `load_blob_artifact()`
   - `save_review_records()`
   - `load_review_records()`
   - `record_stage()`
3. 把数据库操作限制在 storage 层内部
4. 保持文件导出函数仍可独立使用

涉及文件：

- `src/dataforge/core/storage.py`
- `src/dataforge/core/io.py`

验收标准：

- 不依赖具体 pipeline，也能完整执行一次 artifact records 的增删查
- review records 可独立存取

## Phase 3: 重构 run registry

目标：

- 用数据库替换 `runs/index.json` 和 `latest.json`
- 保持现有 `TaskRun` 接口尽量稳定

实施步骤：

1. 修改 [src/dataforge/core/registry.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/registry.py)
2. 重写 `TaskRun.ensure_registered()`
3. 重写 `TaskRun.current_status()`
4. 重写 `TaskRun.record_stage()`
5. 重写 `latest_run_id()`
6. 让 run 生命周期来自数据库

注意事项：

- `path_for()` 暂时保留，但仅用于静态配置与导出文件
- 对数据库型 artifact，pipeline 不再直接依赖 `path_for()`

验收标准：

- 新建 run 时数据库中存在对应记录
- 更新 stage 后数据库中的 `status` 与 `last_stage` 正确推进
- Web 和 CLI 能查到最新 run

## Phase 4: 迁移 generate / classify / filter-export / review-export

目标：

- 先完成上游主链路 SQLite 化

实施步骤：

1. 修改 [src/dataforge/pipelines/generate.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/generate.py)
   - 输入仍来自 `scenario_matrix.yaml`
   - 输出改为 `save_artifact_records(..., "raw_candidates", ...)`
2. 修改 [src/dataforge/pipelines/classify.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/classify.py)
   - 输入改为 `load_artifact_records("raw_candidates")`
   - 输出改为 `teacher_labeled`
3. 修改 [src/dataforge/pipelines/filter_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/filter_export.py)
   - 输入改为 `teacher_labeled`
   - 输出改为 `filtered_train`、`rejected_samples`、`review_candidates`
   - metadata 写入 blob artifact
   - 训练导出 JSONL 改为从 DB 记录派生生成
4. 修改 [src/dataforge/pipelines/review_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/review_export.py)
   - 从 DB 读取 review pool
   - 继续兼容前端所需结构

验收标准：

- `run-all` 能成功跑通到 `review-export`
- `raw_candidates`、`teacher_labeled`、`filtered_train`、`rejected_samples`、`review_candidates` 均存在于数据库
- `train_export` 与现有导出格式一致

## Phase 5: 迁移 review / validate-review / build-gold

目标：

- 完成 review 闭环数据库化

实施步骤：

1. 修改 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py)
   - review 读取走 `review_records`
   - review 保存走 `save_review_records()`
2. 修改 [src/dataforge/pipelines/validate_review.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/validate_review.py)
   - 从数据库读取 review
3. 修改 [src/dataforge/pipelines/build_gold.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/build_gold.py)
   - 从 `review_records` 和 `teacher_labeled` 生成 `gold_eval` 与 `hard_cases`
   - metadata 写入 blob artifact

验收标准：

- review 页面可正常查看和保存
- `validate-review` 仍能正确生成校验报告
- `build-gold` 生成结果与迁移前逻辑一致

## Phase 6: 迁移 eval / student-export

目标：

- 完成下游评测与训练导出数据库化

实施步骤：

1. 修改 [src/dataforge/pipelines/eval.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/eval.py)
   - 从 `gold_eval` 和 `hard_cases` 读取数据
   - `eval_predictions` 改存数据库
   - `eval_result` 改存 blob artifact
   - `eval_for_promptfoo.jsonl`、`eval_dataset.jsonl` 仍作为派生导出文件
2. 修改 [src/dataforge/pipelines/student_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/student_export.py)
   - 从 `filtered_train` 读取数据
   - `training_metadata` 改存 blob artifact
   - `student_train.jsonl` 仍作为最终交付文件输出

验收标准：

- `eval` 能从数据库跑通
- Promptfoo 仍然可用
- `student-export` 生成的训练文件结构不变

## Phase 7: 重构 Web API artifact 读取层

目标：

- API 以数据库作为 artifact 主读取源
- 保持前端尽量少改

实施步骤：

1. 修改 [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py) 中 artifact 查询逻辑
2. 按 artifact 类型分流：
   - `records`：分页查询 DB
   - `blob`：读取单对象 JSON
   - `export_file`：继续读文件
3. 保持响应结构尽可能兼容现有前端
4. 仅在必要处补充分页或 `record_count` 字段

验收标准：

- 前端 artifact 页面无需大改即可使用
- 大型 artifact 不再一次性从磁盘全文读取

## Phase 8: 历史数据迁移脚本

目标：

- 将已有 `tasks/*/runs/*` 下的历史数据迁入 SQLite

实施步骤：

1. 新增 [src/dataforge/scripts/migrate_runs_to_sqlite.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/scripts/migrate_runs_to_sqlite.py)
2. 读取历史 run 目录下的：
   - `index.json`
   - `latest.json`
   - `raw/*.jsonl`
   - `processed/*.jsonl`
   - `gold/*.jsonl`
   - `exports/*.json`
   - `reports/manifests/*.json`
3. 写入数据库
4. 输出迁移报告
5. 提供 dry-run 模式

验收标准：

- 可迁移至少一个真实 task 的全部历史 runs
- 迁移后 DB 中 artifact 数量与原文件条数一致

## Phase 9: 测试补齐与回归

目标：

- 确保 SQLite 化后主流程可回归

实施步骤：

1. 新增或修改以下测试：
   - [tests/test_pipeline_smoke.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_pipeline_smoke.py)
   - [tests/test_web_app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_web_app.py)
   - [tests/test_student_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_student_export.py)
   - [tests/test_dedupe.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_dedupe.py)
2. 新增测试：
   - `tests/test_db.py`
   - `tests/test_storage.py`
   - `tests/test_migrate_runs_to_sqlite.py`
3. 覆盖以下场景：
   - schema init
   - run 注册与状态推进
   - artifact records 读写
   - blob artifact 读写
   - review records 读写
   - 全链路 smoke
   - 历史数据迁移

验收标准：

- 本地测试全部通过
- smoke 流程与迁移前行为一致

## 文件级改造清单

必改文件：

- [src/dataforge/core/registry.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/registry.py)
- [src/dataforge/core/io.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/io.py)
- [src/dataforge/web/app.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/web/app.py)
- [src/dataforge/pipelines/generate.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/generate.py)
- [src/dataforge/pipelines/classify.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/classify.py)
- [src/dataforge/pipelines/filter_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/filter_export.py)
- [src/dataforge/pipelines/review_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/review_export.py)
- [src/dataforge/pipelines/validate_review.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/validate_review.py)
- [src/dataforge/pipelines/build_gold.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/build_gold.py)
- [src/dataforge/pipelines/eval.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/eval.py)
- [src/dataforge/pipelines/student_export.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/pipelines/student_export.py)

新增文件：

- [src/dataforge/core/db.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/db.py)
- [src/dataforge/core/migrations.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/migrations.py)
- [src/dataforge/core/storage.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/core/storage.py)
- [src/dataforge/scripts/migrate_runs_to_sqlite.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/src/dataforge/scripts/migrate_runs_to_sqlite.py)
- [tests/test_db.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_db.py)
- [tests/test_storage.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_storage.py)
- [tests/test_migrate_runs_to_sqlite.py](/Users/teabamboo/Documents/AIplusLLM/DataForge/tests/test_migrate_runs_to_sqlite.py)

## 风险清单

高风险项：

- `path_for()` 语义转型不彻底，导致文件与数据库双源冲突
- Web API 响应结构变化过大，前端出现兼容问题
- 迁移脚本遗漏历史 artifact，导致历史 run 丢数
- `eval` 依赖 Promptfoo 文件输入，若导出层处理不干净会中断

中风险项：

- 数据量增大后 `payload_json` 查询性能下降
- review 聚合逻辑从文件迁移到 DB 后行为出现边界差异
- 去重逻辑依赖读取方式，迁移后可能暴露顺序相关问题

低风险项：

- 配置文件仍保留文件模式，不影响主要迁移目标

## 回滚策略

迁移期间应保留以下回滚能力：

1. 在独立分支内完成改造，不直接覆盖主分支
2. 历史 run 文件不删除，先保留一轮版本
3. 迁移脚本支持 dry-run
4. 完成 DB 导入后，抽样比对文件与 DB 条数
5. 在未完成回归前，不删除旧导出文件逻辑

回滚触发条件：

- Web 主流程不可用
- `run-all` 无法完成
- review 保存或 gold 构建错误
- eval 导出与 Promptfoo 调用失败

## 建议实施顺序

建议严格按以下顺序推进：

1. `db.py` + `migrations.py`
2. `storage.py`
3. `registry.py`
4. 上游四个 pipeline：`generate`、`classify`、`filter-export`、`review-export`
5. review API + `validate-review` + `build-gold`
6. `eval` + `student-export`
7. `web/app.py` artifact 读取层
8. 历史数据迁移脚本
9. 测试与回归
10. 清理旧主路径依赖

## 验收标准

迁移完成的验收条件：

1. 新 run 的运行期核心数据全部写入 SQLite
2. `run-all` 可正常执行到 `review-export`
3. `validate-review`、`build-gold`、`eval`、`student-export` 均可正常执行
4. Web 工作台能查看 run、artifact、review
5. 历史 runs 可导入 SQLite
6. 对外导出文件格式不变
7. 自动化测试通过

## 推荐执行方式

建议采用单分支、分阶段提交策略：

- 第 1 提交：数据库基础设施
- 第 2 提交：storage 与 registry
- 第 3 提交：上游 pipeline
- 第 4 提交：review 与 gold
- 第 5 提交：eval 与 student-export
- 第 6 提交：web API
- 第 7 提交：迁移脚本与测试

这样便于逐步回归，也便于中途止损。

## 当前结论

SQLite 完整迁移是可做的，但它本质上是一次存储边界重构，不是“把 JSONL 换个落盘方式”。

如果按本清单执行，推荐先做“SQLite 为主、文件导出保留”的版本，等主链路稳定后，再考虑是否进一步弱化旧文件 artifact 的存在感。
