# DataForge 通用蒸馏平台 MVP 设计文档

## 1. 文档定位

本文基于 [report-intent-distillation-design.md](../report-intent-distillation-design.md) 重新收敛设计，但不再将 MVP 定义为一个只服务于 `report-intent-distill` 的单任务工程，而是定义为一个通用蒸馏平台的首版方案。

平台工程名采用当前工程名：

- 平台名：`DataForge`
- 首个接入任务：`report-intent-distill`

平台目标是提供一套可复用的蒸馏基础设施，用统一方式支持：

1. 任务定义
2. 样本生成
3. teacher 打标
4. 数据过滤
5. 人工抽检
6. 离线评测
7. 后续 student 蒸馏训练接入

`report-intent-distill` 只是第一个落地场景，用来验证平台骨架是否成立。

---

## 2. 设计目标

MVP 要解决的是“平台能力最小闭环”，而不是只产出一个任务的数据文件。

首版目标分为两层。

### 2.1 平台层目标

1. 定义统一任务注册结构
2. 定义统一样本 schema 和目录规范
3. 定义统一 prompt、pipeline、eval 配置接口
4. 支持按任务运行生成、打标、过滤、导出、评测流程
5. 允许后续新增其它蒸馏任务时尽量不改平台主干

### 2.2 首任务目标

`report-intent-distill` 作为首个任务，需要验证以下闭环：

1. 生成三分类 synthetic 样本
2. 完成 teacher 自动打标
3. 导出训练集和 Label Studio 抽检集
4. 建立一版 Promptfoo 评测集
5. 形成平台级可复用流程样板

---

## 3. MVP 非目标

首版明确不做以下内容：

1. 不做线上推理服务
2. 不做多租户权限系统
3. 不做可视化 Web 控制台
4. 不做复杂工作流编排系统
5. 不要求平台首版同时接多个真实任务
6. 不强制落 student 训练实现，只预留标准出口

---

## 4. 核心设计原则

1. 平台先抽象稳定边界，任务后按配置接入
2. 平台只沉淀共性能力，不把首任务规则硬编码进主干
3. 任务差异通过任务目录、配置和 prompt 注入
4. 所有关键产物文件化，保证可审计、可版本化、可回放
5. 先打通离线闭环，再扩展训练和部署能力

---

## 5. 平台总体抽象

平台划分为两层：

1. `platform` 层
2. `task` 层

### 5.1 platform 层职责

平台层只负责通用能力：

1. 任务发现与任务元数据读取
2. 通用样本 schema 校验
3. 通用 pipeline 执行入口
4. 通用过滤、去重、导出流程
5. 通用评测执行器
6. 通用产物目录约定

### 5.2 task 层职责

任务层只负责领域差异：

1. 标签定义
2. 上下文字段定义
3. 生成 prompt
4. teacher 分类 prompt
5. 场景矩阵
6. task-specific 规则
7. 评测集与 hard cases

### 5.3 本次首个接入任务

`report-intent-distill` 负责研报会话动作三分类：

- `chat`
- `rewrite_report`
- `regenerate_report`

其关键约束是：

若当前没有可见报告，不允许输出 `rewrite_report`。

这条规则属于任务规则，不属于平台内置通用规则。平台只提供规则注入能力。

---

## 6. 平台架构

MVP 架构采用“通用执行骨架 + 任务配置驱动”的模式。

```text
task registry
  ↓
load task config
  ↓
build scenario matrix
  ↓
generate candidates
  ↓
teacher classify
  ↓
filter / dedupe / export
  ↓
human review import/export
  ↓
eval runner
  ↓
reports / training exports
```

### 6.1 平台执行入口

平台统一支持按任务执行，例如：

- `run generate --task report-intent-distill`
- `run classify --task report-intent-distill`
- `run export-review --task report-intent-distill`
- `run eval --task report-intent-distill`

这里的命令只是接口语义，首版可用 Python 脚本或 Makefile 形式实现，不要求先做成统一 CLI 工具。

### 6.2 平台与任务的调用关系

1. 平台读取任务注册信息
2. 平台加载该任务的 labels、schema、prompts、scenario 配置
3. 平台执行通用 pipeline
4. 平台将任务规则作为配置注入各环节
5. 各阶段产物写入对应 task 的 `runs/<run_id>/` 目录

---

## 7. 目录结构设计

MVP 目录结构改为平台化设计：

```text
docs/
  DataForge-platform-mvp-design.md

DataForge/
  README.md
  src/
    dataforge/
      core/
        registry.py
        schemas.py
        io.py
        filters.py
        dedupe.py
        eval_runner.py
        review.py
      providers/
        base.py
        mock.py
        openai_compatible.py
      pipelines/
        generate.py
        classify.py
        filter_export.py
        review_export.py
        build_gold.py
        eval.py
      cli.py
  tests/
    test_registry.py
    test_schema.py
    test_filters.py
  tasks/
    report-intent-distill/
      README.md
      configs/
        task.yaml
        labels.yaml
        scenario_matrix.yaml
        generator_prompt.txt
        teacher_prompt.txt
        promptfoo.yaml
      runs/
        index.json
        latest.json
        <run_id>/
          raw/
            raw_candidates.jsonl
            teacher_labeled.jsonl
          processed/
            filtered_train.jsonl
            labelstudio_import.json
            review_candidates.jsonl
            review_results.jsonl
            rejected_samples.jsonl
          gold/
            gold_eval.jsonl
            hard_cases.jsonl
          exports/
            eval_for_promptfoo.jsonl
            eval_predictions.jsonl
          reports/
            eval_summary.md
            confusion_analysis.md
            manifests/
              generate.json
              classify.json
              filter_export.json
              review_export.json
              build_gold.json
              eval.json
```

### 7.1 目录设计原则

1. 平台公共代码只放在 `src/dataforge/`
2. 任务差异只放在 `tasks/<task-name>/`
3. 平台不能直接依赖某个具体任务名
4. 任一任务的数据、报告、配置都必须局部闭环，避免跨任务污染

补充约束：

1. 静态配置只放在 `tasks/<task-name>/configs/`
2. 所有运行产物只放在 `tasks/<task-name>/runs/<run_id>/`
3. `runs/latest.json` 指向当前默认批次
4. `runs/index.json` 维护批次索引和各阶段 manifest 摘要

---

## 8. 任务注册模型

平台需要一个统一任务注册结构，用于描述每个任务的最小元信息。

推荐字段：

```yaml
name: report-intent-distill
theme: report_intent_classification
language: zh
task_type: classification
entry_schema: conversation_action
runtime:
  generator:
    provider: openai
    model: gpt-4.1
    temperature: 0.8
    seed: 42
    batch_size: 64
    retry_policy: default
    prompt_version: v1
  teacher:
    provider: openai
    model: gpt-4.1-mini
    temperature: 0
    seed: 42
    batch_size: 128
    retry_policy: strict_json
    prompt_version: v1
  eval:
    provider: openai
    model: gpt-4.1-mini
    temperature: 0
    prompt_version: v1
paths:
  labels: tasks/report-intent-distill/configs/labels.yaml
  scenario_matrix: tasks/report-intent-distill/configs/scenario_matrix.yaml
  generator_prompt: tasks/report-intent-distill/configs/generator_prompt.txt
  teacher_prompt: tasks/report-intent-distill/configs/teacher_prompt.txt
  promptfoo: tasks/report-intent-distill/configs/promptfoo.yaml
rules:
  disallow_rewrite_without_visible_report: true
exports:
  train_format: chatml_jsonl
  eval_format: promptfoo_jsonl
```

### 8.1 注册信息职责

任务注册信息只回答四件事：

1. 这个任务是谁
2. 平台运行它需要加载哪些配置
3. 这个任务有哪些特定规则和导出格式
4. 这个任务在 generate / classify / eval 阶段默认使用什么运行参数

### 8.2 可回放运行信息

除任务静态注册信息外，每次运行还应输出一份 `run_manifest.json`，至少记录：

1. task name
2. run id
3. stage name
4. provider / model / temperature / seed / batch size
5. prompt version 或 prompt 文件 hash
6. 输入文件路径与输出文件路径
7. 启动时间、完成时间、样本条数
8. 失败数、重试次数、关键错误码

这样后续才能稳定回放同一批生成、打标与评测结果。

---

## 9. 通用数据模型

平台必须定义统一的样本骨架，但不能假设所有样本在所有阶段都已具备完整标注信息。首版采用“统一外壳 + 分阶段状态字段”的方式建模。

### 9.1 平台统一样本结构

```json
{
  "id": "sample_000001",
  "task_name": "report-intent-distill",
  "theme": "report_intent_classification",
  "stage": "classified",
  "context": {},
  "input": {
    "user_text": "帮我改得正式一点，像给老板汇报的版本"
  },
  "annotation": {
    "teacher_label": "rewrite_report",
    "teacher_raw_output": "{\"action\":\"rewrite_report\"}",
    "parse_ok": true,
    "error_code": null,
    "human_label": null,
    "review_status": "unreviewed",
    "final_label": null
  },
  "metadata": {
    "source": "synthetic",
    "difficulty": "medium",
    "tags": ["rewrite", "tone_change", "followup"]
  }
}
```

### 9.2 平台分阶段约束

平台统一支持四类样本阶段：

1. `candidate`：仅完成生成，尚未 teacher 打标
2. `classified`：已完成 teacher 打标，允许解析失败
3. `reviewed`：已有人审结果
4. `gold`：已冻结为最终评测真值

### 9.3 平台通用必填字段

- `id`
- `task_name`
- `theme`
- `stage`
- `context`
- `input.user_text`
- `metadata.source`
- `metadata.difficulty`
- `metadata.tags`

### 9.4 分阶段必填字段

- `candidate` 阶段必填：`id`、`task_name`、`theme`、`stage`、`context`、`input.user_text`、`metadata.*`
- `classified` 阶段必填：在 `candidate` 基础上增加 `annotation.parse_ok`、`annotation.teacher_raw_output`
- `classified` 阶段条件必填：若 `annotation.parse_ok=true`，则 `annotation.teacher_label` 必填；若 `annotation.parse_ok=false`，则 `annotation.teacher_label=null` 且 `annotation.error_code` 必填
- `reviewed` 阶段必填：在 `classified` 基础上增加 `annotation.review_status`、`annotation.human_label`
- `gold` 阶段必填：在 `reviewed` 基础上增加 `annotation.final_label`

### 9.5 review 真值规则

1. `teacher_label` 是模型产出，不是真值
2. `human_label` 是人工复核后的标签；若 `review_status=accepted`，则 `human_label` 应与 `teacher_label` 保持一致
3. `final_label` 是进入 gold set 后的冻结标签
4. `final_label` 优先取人工复核后的标签；未进入 review 流程的样本不得进入 gold set

### 9.6 任务扩展字段

首版允许任务在 `context` 内自由扩展字段，但必须在 `task.yaml` 或 schema 文件中声明。

`report-intent-distill` 首版最小上下文字段：

- `has_visible_report`
- `previous_report_summary`
- `dialogue_stage`
- `language`

---

## 10. 平台通用能力设计

## 10.1 schema 校验

平台负责：

1. 检查必填字段
2. 按 `stage` 检查条件必填字段
2. 检查枚举值是否合法
3. 检查 task_name 与任务目录是否一致
4. 检查导出文件结构是否符合目标格式

## 10.2 过滤与去重

平台内置通用过滤逻辑：

1. 空文本过滤
2. JSON 解析失败过滤
3. 白名单标签过滤
4. 完全重复去重
5. 基础长度异常过滤

任务可额外注入 task-specific 规则。

例如 `report-intent-distill` 可增加：

1. `has_visible_report=false` 且 `teacher_label=rewrite_report` 直接判定为非法样本
2. `rewrite_report` 样本优先要求有可见报告上下文

## 10.3 导出能力

平台提供统一导出接口：

1. 导出训练集
2. 导出 Label Studio 导入数据
3. 导出 Promptfoo 评测数据
4. 导出 student 训练格式

平台只管导出格式转换，不关心具体业务标签语义。

## 10.4 评测执行器

平台提供统一评测入口：

1. 读取任务自己的 `promptfoo.yaml`
2. 读取任务自己的 eval 数据
3. 汇总输出到对应 `runs/<run_id>/reports/`

---

## 11. 首任务 `report-intent-distill` 设计

## 11.1 任务定义

任务目标是判断用户当前动作属于：

- `chat`
- `rewrite_report`
- `regenerate_report`

### 11.2 关键边界

1. 用户只是追问、讨论、解释、澄清时，归为 `chat`
2. 用户基于已有报告要求改口吻、改结构、压缩、扩写、改风险偏好时，归为 `rewrite_report`
3. 用户要求重新分析、按最新信息重跑、重新出一版时，归为 `regenerate_report`
4. 若无可见报告，不得输出 `rewrite_report`

### 11.3 场景矩阵

首版建议维度：

| 维度 | 可选值 |
|---|---|
| intent | `chat` / `rewrite_report` / `regenerate_report` |
| has_visible_report | `true` / `false` |
| dialogue_stage | `standalone` / `followup` |
| explicitness | `explicit` / `implicit` |
| style | `formal` / `colloquial` / `short` / `typo` |
| difficulty | `easy` / `medium` / `hard` |

### 11.4 task-specific tags

建议首版支持以下 tags：

- `explicit_rewrite`
- `explicit_regenerate`
- `explicit_chat`
- `implicit_intent`
- `ambiguous`
- `has_reference`
- `no_reference`
- `tone_change`
- `structure_change`
- `risk_preference_change`
- `latest_info_request`
- `ask_explanation`
- `clarification`
- `short_utterance`
- `colloquial`
- `typo`
- `multi_intent`

---

## 12. MVP 流程设计

MVP 流程仍然是一个闭环，但现在按“平台执行 + task 注入”的方式组织。

### 12.1 步骤一：注册并加载任务

平台读取 `report-intent-distill` 的任务配置，构建运行上下文。

输出：

- 已解析的 task config
- 已加载的 labels、prompts、scenario matrix

若本次命令是 `generate` 或 `run-all`，平台自动创建新的 `run_id`。

若本次命令是 `classify`、`filter-export`、`review-export`、`build-gold`、`eval`，平台默认读取 `runs/latest.json` 指向的批次；也可以显式传入 `run_id`。

### 12.2 步骤二：生成候选样本

平台执行通用 `generate` pipeline。

任务提供：

- `scenario_matrix.yaml`
- `generator_prompt.txt`
- 任务标签和上下文定义

输出：

- `tasks/report-intent-distill/runs/<run_id>/raw/raw_candidates.jsonl`

### 12.3 步骤三：teacher 分类打标

平台执行通用 `classify` pipeline。

任务提供：

- `teacher_prompt.txt`
- 标签白名单
- task-specific 规则

输出：

- `tasks/report-intent-distill/runs/<run_id>/raw/teacher_labeled.jsonl`

此阶段允许存在 `parse_ok=false` 的记录。这些样本仍保留在 `classified` 阶段产物中，用于后续失败分析，但不得直接进入训练集或 gold set。

### 12.4 步骤四：过滤与导出

平台执行通用 `filter_export` pipeline。

平台负责：

1. schema 校验
2. 解析校验
3. 基础过滤
4. 基础去重
5. 数据切分与冻结控制
6. 通用导出

任务负责：

1. 注入额外规则
2. 定义是否进入待审池
3. 指定任务导出格式
4. 指定 hard cases 抽样规则

切分规则建议首版固定如下：

1. `filtered_train.jsonl` 仅包含通过 schema 校验、解析成功且未进入 gold/eval 冻结集的样本
2. `gold_eval.jsonl` 只来自人工复核完成且 `review_status` 为 `accepted` 或 `corrected` 的样本
3. `eval_for_promptfoo.jsonl` 必须由 `gold_eval.jsonl` 派生，不允许直接从训练集抽取
4. `hard_cases.jsonl` 默认属于评测资产，不进入训练集；若后续用于训练，必须复制出单独版本并同步更新 run manifest
5. 同一 `id` 在同一数据版本中不得同时出现在 train 与 eval

输出：

- `filtered_train.jsonl`
- `labelstudio_import.json`
- `eval_for_promptfoo.jsonl`

这些文件实际落到：

- `tasks/report-intent-distill/runs/<run_id>/processed/filtered_train.jsonl`
- `tasks/report-intent-distill/runs/<run_id>/processed/labelstudio_import.json`
- `tasks/report-intent-distill/runs/<run_id>/exports/eval_for_promptfoo.jsonl`

### 12.5 步骤五：人工抽检与 gold set

平台提供 review 导出与 gold 构建脚本。

任务负责：

1. 定义标注标签
2. 定义人工说明
3. 维护 hard cases
4. 定义冲突处理策略

review 到 gold 的状态流转规则：

1. `unreviewed`：已导出待审，尚无人审结论
2. `accepted`：人工确认 teacher_label 正确，可进入 reviewed set
3. `corrected`：人工修正标签，`human_label` 覆盖 teacher 结果
4. `rejected`：样本质量或任务定义不合格，不能进入 train 或 gold
5. `gold_frozen`：样本已写入 gold set，`final_label` 冻结，不得被后续自动流程覆盖

merge 规则：

1. 同一条样本若存在人工结论，则人工结论优先于 teacher 结果
2. 多轮 review 必须保留历史记录，gold 构建默认取最后一次有效人工结论
3. `rejected` 样本仅保留在 review 记录中，用于错误分析
4. hard cases 应优先从 `corrected`、`ambiguous`、`multi_intent` 子集回流构建

输出：

- `gold_eval.jsonl`
- `hard_cases.jsonl`

这些文件实际落到：

- `tasks/report-intent-distill/runs/<run_id>/gold/gold_eval.jsonl`
- `tasks/report-intent-distill/runs/<run_id>/gold/hard_cases.jsonl`

### 12.6 步骤六：离线评测

平台执行统一 eval runner。

任务负责：

1. 提供 `promptfoo.yaml`
2. 提供任务评测集
3. 定义重点关注指标

输出：

- `eval_summary.md`
- `confusion_analysis.md`

这些文件实际落到：

- `tasks/report-intent-distill/runs/<run_id>/reports/eval_summary.md`
- `tasks/report-intent-distill/runs/<run_id>/reports/confusion_analysis.md`

此外，平台还输出：

- `tasks/report-intent-distill/runs/<run_id>/exports/eval_predictions.jsonl`

---

## 13. Prompt 与规则设计

## 13.1 平台对 prompt 的要求

平台不关心业务内容，但要求所有任务 prompt 都满足：

1. 输入结构稳定
2. 输出结构可解析
3. prompt 文件单独存放，便于版本化
4. 支持在不改平台代码的前提下单独迭代

## 13.2 `report-intent-distill` 的 prompt 要求

### generator prompt

必须满足：

1. 生成真实用户表达，不生成标签解释
2. 显式覆盖模糊、短句、口语、指代、省略、错别字
3. 必须携带任务上下文约束

### teacher prompt

必须满足：

1. 三分类边界清晰
2. 强调无可见报告时不得输出 `rewrite_report`
3. 输出必须为单行 JSON
4. 不输出多余说明文字

---

## 14. 人工抽检与评测设计

## 14.1 平台通用设计

平台统一支持：

1. 导出人工抽检数据
2. 导入人工修正结果
3. 构建 reviewed set / gold set
4. 生成统一评测报告模板

平台还需要统一约束：

1. gold set 一旦生成版本号即冻结，不允许被训练流程直接改写
2. eval 数据必须从 gold set 派生，不能绕过 review
3. hard cases 默认独立维护，并附带来源原因与回流日期
4. 每次构建 train / eval / hard cases 都要输出数据版本号和样本数摘要
5. 每次 stage 运行都要产出 `runs/<run_id>/reports/manifests/<stage>.json`

## 14.2 `report-intent-distill` 的抽检重点

1. `rewrite_report` 与 `regenerate_report` 的边界样本
2. `has_visible_report=false` 子集
3. `chat` 与隐式生成请求混淆样本
4. `hard`、`ambiguous`、`multi_intent` 样本

## 14.3 `report-intent-distill` 的核心评测指标

- Overall accuracy
- Macro F1
- Per-class precision / recall / F1
- JSON valid rate
- hard cases accuracy
- `has_visible_report=false` 子集准确率
- 人工抽检一致率

### 14.4 数据切分与防泄漏要求

1. `gold_eval.jsonl` 是唯一评测真值来源，必须版本冻结
2. `eval_for_promptfoo.jsonl` 由 `gold_eval.jsonl` 格式转换生成，不单独人工维护
3. `filtered_train.jsonl` 不得包含任何已进入 `gold_eval.jsonl` 的样本 `id`
4. `hard_cases.jsonl` 默认不回灌训练；若业务决定纳入训练，需生成新的训练版本并记录原因
5. 后续增量样本进入训练前，必须先与历史 gold / eval / hard cases 做去重比对

---

## 15. MVP 输出物

本次 MVP 的输出物分为两类。

### 15.1 平台层输出物

1. 平台目录骨架
2. 任务注册机制
3. 通用 schema 和过滤能力
4. 通用 pipeline 骨架
5. 通用导出与评测接口

### 15.2 首任务输出物

1. `report-intent-distill` 任务配置
2. 三分类 labels 配置
3. 场景矩阵配置
4. generator 和 teacher prompt
5. synthetic 数据产物
6. Label Studio 导入集
7. Promptfoo 评测集和报告

---

## 16. 验收标准

验收同样分为平台层和首任务层。

## 16.1 平台层验收

1. 平台可以通过任务名加载对应配置
2. 平台 pipeline 不硬编码 `report-intent-distill`
3. 平台能基于任务注册信息和 run manifest 回放一次完整 generate / classify / eval 运行
4. 平台能输出统一格式的数据和报告文件
5. 平台支持后续新增任务时仅增加 `tasks/<task-name>/` 内容
6. 平台 schema 能正确表达 `candidate`、`classified`、`reviewed`、`gold` 四类阶段状态
7. 平台支持 `run_id` 批次隔离，不同批次产物互不覆盖
8. 平台维护 `runs/latest.json` 和 `runs/index.json`

## 16.2 首任务层验收

1. 能生成 3000 到 10000 条候选样本
2. 能完成 teacher 自动打标并产出可过滤数据
3. `has_visible_report=false` 的非法 `rewrite_report` 能被识别并过滤
4. 能导出 Label Studio 抽检文件
5. 能完成 review 导入并稳定构建首版 `gold_eval.jsonl`
6. 能运行 Promptfoo 评测并产出首版评测报告
7. `JSON valid rate` 不低于 95%
8. `Macro F1` 不低于 0.80
9. `has_visible_report=false` 子集准确率不低于 0.95
10. `hard cases accuracy` 不低于 0.70
11. 人工抽检一致率不低于 0.85；若低于该值，MVP 仅算流程跑通，不算质量验收通过

---

## 17. 实施阶段建议

建议按四阶段推进。

### Phase 1：平台骨架

1. 建立仓库根目录与 `src/dataforge/` 包结构
2. 落平台级目录结构
3. 定义 registry、schema、filters、eval runner 骨架

### Phase 2：首任务接入

1. 创建 `tasks/report-intent-distill/`
2. 编写 labels、scenario matrix、prompts
3. 接通生成、打标、过滤导出链路

### Phase 3：人工抽检与评测

1. 导出 Label Studio 标注集
2. 构建首版 gold eval
3. 产出 Promptfoo 评测报告

### Phase 4：训练出口

1. 导出统一训练格式
2. 接 student 蒸馏训练
3. 基于错例补充 hard cases

---

## 18. 风险与应对

## 18.1 平台抽象过早失真

风险：
平台层抽象过度，结果首任务都接不顺。

应对：
所有平台抽象必须先服务 `report-intent-distill` 跑通，再考虑第二个任务。

## 18.2 平台主干被首任务污染

风险：
为了快速推进，把 `report-intent-distill` 规则硬编码进平台主干，后续无法复用。

应对：
所有业务规则都通过任务配置或 task-specific filter 注入。

## 18.3 synthetic 数据分布失真

风险：
首任务数据过于工整，导致后续 student 泛化不足。

应对：
在 task prompt 中显式要求口语、短句、错别字、含糊表达，并维护 hard cases。

---

## 19. 结论

本次重设计后的 MVP，不再是“做一个 `report-intent-distill` 工程”，而是“做一个名为 `DataForge` 的通用蒸馏平台 MVP，并先用 `report-intent-distill` 完成首个任务验证”。

这个设计的关键价值有三点：

1. 平台层沉淀共性能力，避免未来重复造轮子
2. 任务层承载业务差异，避免平台被首任务绑死
3. 首版仍然聚焦最小闭环，保证能快速落地和验证

后续若要继续实现，优先顺序应为：

1. 平台骨架
2. `report-intent-distill` task 配置
3. prompt 与数据 schema
4. pipeline 脚手架
5. 抽检与评测
