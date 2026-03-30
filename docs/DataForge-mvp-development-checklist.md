# DataForge MVP 开发清单

- 更新时间: 2026-03-30
- 基线文档:
  - [平台 MVP 设计](/Users/teabamboo/Documents/AIplusLLM/DataForge/docs/DataForge-platform-mvp-design.md)
  - [当前工程架构](/Users/teabamboo/Documents/AIplusLLM/DataForge/docs/architecture.md)

## 1. 当前实现阶段判断

基于当前代码与仓库内已存在产物，工程状态可分成两层理解：

1. 按代码能力判断：已完成 `Phase 1`、`Phase 2`，并已进入 `Phase 3`，但尚未完成 `Phase 3` 全部目标。
2. 按仓库内已提交运行产物判断：目前只看到一次 `generate` 落地产物，真实数据运行进度仍停留在 `generate`。

### 1.1 阶段结论

- `Phase 1：平台骨架`：已完成
- `Phase 2：首任务接入`：已完成
- `Phase 3：人工抽检与评测`：部分完成
- `Phase 4：训练出口`：未开始

## 2. 已完成能力

### 2.1 平台骨架

- [x] 建立 `src/dataforge/` 平台代码结构
- [x] 建立 `tasks/<task-name>/` 任务目录结构
- [x] 实现任务发现与配置加载
- [x] 实现 `run_id` 批次隔离
- [x] 实现 `runs/latest.json` 与 `runs/index.json`
- [x] 实现统一 artifact 路径注册
- [x] 实现统一 stage manifest 写入
- [x] 实现基础 schema 校验
- [x] 实现基础过滤与去重
- [x] 实现统一评测指标汇总与报告输出

### 2.2 首任务接入

- [x] 接入 `report-intent-distill`
- [x] 提供 `task.yaml`
- [x] 提供 `labels.yaml`
- [x] 提供 `scenario_matrix.yaml`
- [x] 提供 `generator_prompt.txt`
- [x] 提供 `teacher_prompt.txt`
- [x] 接通 `generate -> classify -> filter-export`
- [x] 支持 task rule `disallow_rewrite_without_visible_report`
- [x] 支持 `mock / openai_compatible / anthropic_compatible / minimax`

### 2.3 人工抽检与评测基础链路

- [x] 导出 Label Studio 导入数据
- [x] 导出 review candidates
- [x] 校验 review records
- [x] 基于 review 结果构建 `gold_eval.jsonl`
- [x] 构建 `hard_cases.jsonl`
- [x] 导出 `eval_predictions.jsonl`
- [x] 导出 `eval_for_promptfoo.jsonl`
- [x] 输出 `eval_summary.md`
- [x] 输出 `confusion_analysis.md`
- [x] 本地测试通过：`uv run pytest -q`

## 3. 部分完成能力

### 3.1 Phase 3 未收尾项

- [ ] Promptfoo 仅完成“数据导出”，未完成“真实执行”
  - 当前状态：代码会产出 `eval_for_promptfoo.jsonl`，但不会读取并执行 `promptfoo.yaml`
  - 目标状态：平台可基于任务的 `promptfoo.yaml` 真实运行评测，并将结果汇总进当前 run

- [ ] review 历史记录已保存，但 gold merge 规则未完整实现
  - 当前状态：`review_history` 会写入样本
  - 当前缺口：`build_gold` 仍按 review 记录逐条处理，没有先按 `sample_id` 聚合并取最后一次有效人工结论
  - 风险：同一样本多轮 review 时，可能重复进入 gold，或不符合设计中的 merge 规则

- [ ] 评测报告只覆盖平台内置指标，未形成完整 Promptfoo 集成报告
  - 当前状态：已有 accuracy、macro F1、per-class、JSON valid rate、hard cases accuracy、`has_visible_report=false` 子集准确率
  - 当前缺口：没有外部 Promptfoo 结果回收，也没有和任务 `promptfoo.yaml` 形成闭环

## 4. 未完成能力

### 4.1 Phase 4 训练出口

- [ ] 抽象统一训练格式导出层
- [ ] 真正消费 `exports.train_format` 配置，而不是固定写 `filtered_train.jsonl`
- [ ] 真正消费 `exports.eval_format` 配置，而不是固定写 promptfoo 风格 jsonl
- [ ] 增加 student 训练入口或标准训练数据出口
- [ ] 增加训练版本说明与产物目录约定
- [ ] 定义 hard cases 回流训练时的版本管理规则

### 4.2 数据治理与防泄漏

- [ ] 增量训练前，与历史 `gold / eval / hard_cases` 做跨版本去重
- [ ] 为 train/eval/hard cases 生成更明确的数据版本摘要
- [ ] 明确 hard cases 的来源原因与回流日期

### 4.3 首任务质量验收

- [ ] 达到 3000 到 10000 条候选样本规模
- [ ] 验证 `JSON valid rate >= 95%`
- [ ] 验证 `Macro F1 >= 0.80`
- [ ] 验证 `has_visible_report=false` 子集准确率 `>= 0.95`
- [ ] 验证 `hard cases accuracy >= 0.70`
- [ ] 验证人工抽检一致率 `>= 0.85`

## 5. 建议开发顺序

建议按下面顺序继续推进，避免先做训练出口时被上游数据闭环反复返工。

### P0：先补 Phase 3 闭环缺口

- [ ] 任务 1：补齐 Promptfoo 真执行链路
  - 目标：从“导出 promptfoo 数据”升级为“执行任务自带 `promptfoo.yaml` 并回收结果”
  - 建议修改：
    - `src/dataforge/pipelines/eval.py`
    - `src/dataforge/core/eval_runner.py`
    - `tasks/report-intent-distill/configs/promptfoo.yaml`
    - `README.md`
    - `tests/`
  - 验收：
    - `eval` 阶段能消费 `promptfoo.yaml`
    - run 目录内能看到真实 Promptfoo 结果或标准化摘要
    - 测试可覆盖“无 Promptfoo / 有 Promptfoo 配置”两类场景

- [x] 任务 2：补齐多轮 review merge 规则
  - 目标：同一样本多次 review 时，只使用最后一次有效人工结论构建 gold
  - 建议修改：
    - `src/dataforge/core/review.py`
    - `src/dataforge/pipelines/build_gold.py`
    - `tests/test_review.py`
    - 新增或补充 `tests/test_pipeline_smoke.py`
  - 验收：
    - 多条 review 记录可按 `sample_id` 聚合
    - `accepted` / `corrected` / `rejected` 行为符合设计
    - gold 中不会因多轮 review 产生重复样本

- [ ] 任务 3：补齐评测结果回写与 run 摘要
  - 目标：让 `eval` 真正成为“可回放、可追踪”的闭环阶段
  - 建议修改：
    - `src/dataforge/core/io.py`
    - `src/dataforge/core/registry.py`
    - `src/dataforge/pipelines/eval.py`
    - `src/dataforge/web/app.py`
  - 验收：
    - eval manifest 能记录更完整输入输出
    - 前端和 API 可查看真实 eval 结果摘要

### P1：再补 Phase 4 训练出口

- [ ] 任务 4：抽象导出层
  - 目标：把训练集、评测集、student 训练格式导出做成可配置而非固定写死
  - 建议修改：
    - `src/dataforge/core/`
    - `src/dataforge/pipelines/filter_export.py`
    - `src/dataforge/pipelines/eval.py`
    - `tasks/report-intent-distill/configs/task.yaml`
    - `tests/`
  - 验收：
    - `exports.train_format` 与 `exports.eval_format` 被真实消费
    - 新增格式时不需要改动主流程大量代码

- [ ] 任务 5：补 student 训练标准出口
  - 目标：先实现“标准训练产物出口”，再决定是否直接接训练执行器
  - 建议修改：
    - `src/dataforge/pipelines/`
    - `src/dataforge/cli.py`
    - `README.md`
    - `docs/`
  - 验收：
    - 平台能输出明确的 student 训练输入产物
    - run 目录内可追踪该版本的来源与配置

### P2：最后做数据治理与质量验收

- [ ] 任务 6：补跨版本防泄漏去重
  - 目标：增量样本进训练前，先与历史 gold/eval/hard cases 去重
  - 建议修改：
    - `src/dataforge/core/dedupe.py`
    - `src/dataforge/pipelines/filter_export.py`
    - `tests/test_filters.py`
  - 验收：
    - 同一 `id` 或同义重复样本不会重新进入 train
    - 能输出被历史资产拦截的样本摘要

- [ ] 任务 7：扩大样本规模并做首任务质量验收
  - 目标：从“流程跑通”升级为“达到 MVP 质量线”
  - 建议修改：
    - `tasks/report-intent-distill/configs/scenario_matrix.yaml`
    - prompts
    - 评测与复核资产
  - 验收：
    - 候选样本规模达标
    - 关键指标达到设计要求

## 6. 推荐给 AI 的执行方式

后续 AI 建议一次只认领一个任务，避免在多个阶段同时改动导致验收边界不清晰。

### 推荐执行批次

1. 批次 A：Promptfoo 真执行链路
2. 批次 B：多轮 review merge 规则
3. 批次 C：导出层抽象
4. 批次 D：student 训练标准出口
5. 批次 E：历史防泄漏去重
6. 批次 F：数据规模与质量验收

### 每次开发前必须回答

- 本次任务属于哪个阶段
- 本次任务的输入产物是什么
- 本次任务的输出产物是什么
- 是否影响已有 run 目录结构
- 是否需要补测试
- 完成后如何验证

## 7. 可直接复用的开发提示词

下面这段可直接给后续 AI 作为开发起点。

```text
请基于 docs/DataForge-mvp-development-checklist.md 继续开发 DataForge。

要求：
1. 先读取 checklist，明确当前要完成的唯一任务。
2. 只实现一个任务，不要同时跨多个任务发散。
3. 先输出“实现步骤 + 影响文件 + 验收方式”，再开始修改代码。
4. 修改后必须补齐或更新测试。
5. 最终回答要说明：
   - 完成了 checklist 中哪一项
   - 修改了哪些文件
   - 如何验证
   - 剩余未完成项是什么
```

## 8. 下一步建议

如果只选一个最值得优先做的任务，建议下一步做：

- [ ] `P0 / 任务 1：补齐 Promptfoo 真执行链路`

原因：

1. 多轮 review merge 已补上，当前最大的 Phase 3 缺口变成 Promptfoo 只导出不执行。
2. 它会直接影响设计文档里“Promptfoo 评测报告”是否真正闭环。
3. 完成它之后，Phase 3 的剩余缺口会更清晰，便于再推进训练出口。
