# 研报意图分类蒸馏方案设计

## 1. 目标

围绕“判断用户当前是在聊天、改写已有报告，还是要求重新生成报告”这一任务，构建一套可持续迭代的数据生产与蒸馏流程。

目标分类标签固定为：

- `chat`
- `rewrite_report`
- `regenerate_report`

教师模型（teacher model）使用高质量大模型，先生成候选用户表达，再基于既定分类提示完成自动打标。随后通过人工抽检与评测闭环，产出适合蒸馏小模型的高质量训练集与评测集。

---

## 2. 任务定义

### 2.1 分类定义

教师分类提示语如下：

```text
你是会话动作分类器。
请在 chat、rewrite_report、regenerate_report 中严格选择一个动作。
chat: 用户是在追问、讨论、解释、澄清，不要求生成新报告。
rewrite_report: 用户要基于现有报告改写、润色、改口吻、改结构、改风险偏好。
regenerate_report: 用户要重新分析、重跑、按最新信息生成新报告，或明确要求出一版报告。
若当前没有可见报告，不要返回 rewrite_report，应在 chat 和 regenerate_report 中选择更合适者。
输出必须是单行 JSON，例如 {"action":"chat"}。
```

### 2.2 核心难点

该任务看似是简单三分类，实际难点在于：

1. `rewrite_report` 与 `regenerate_report` 边界容易混淆
2. `chat` 与“隐式要求重写/重生成”之间存在口语化模糊地带
3. 任务标签依赖上下文，尤其依赖：
   - 当前是否存在“可见报告”
   - 用户是否明确引用前文
   - 用户表达是否是继续讨论，还是触发新产出
4. 真实用户表达往往并不标准，常见：
   - 省略主语
   - 指代模糊
   - 多意图混合
   - 口语化、半句式、纠结式表达

因此，设计时必须把“上下文变量”纳入数据结构，而不能只做单句裸分类。

---

## 3. 总体方案

建议采用以下工具组合：

- **Distilabel**：合成数据生成、teacher 打标、过滤、导出主训练集
- **Label Studio**：人工抽检、修正标签、构建 gold set（金标评测集）
- **DSPy**：对生成提示、分类提示进行程序化封装与迭代优化
- **Promptfoo**：对 teacher pipeline、prompt 版本、student 模型做自动评测与回归测试

整体闭环如下：

```text
需求定义
  ↓
标签体系与上下文结构设计
  ↓
DSPy 封装生成/分类模块
  ↓
Distilabel 批量生成候选样本
  ↓
Teacher 模型自动分类打标
  ↓
规则过滤 / 去重 / 质量筛查
  ↓
导入 Label Studio 人工抽检与修正
  ↓
沉淀金标评测集（gold set）
  ↓
Promptfoo 批测 teacher / prompt / student
  ↓
蒸馏训练 student model
  ↓
错误分析 + hard cases 回灌
  ↓
下一轮数据迭代
```

---

## 4. 数据设计

### 4.1 推荐数据结构

不建议只存：

```json
{
  "text": "帮我改得正式一点",
  "label": "rewrite_report"
}
```

推荐使用显式上下文结构：

```json
{
  "id": "sample_000001",
  "theme": "report_intent_classification",
  "context": {
    "has_visible_report": true,
    "previous_report_summary": "一份关于新能源行业的投资分析报告",
    "dialogue_stage": "followup",
    "language": "zh"
  },
  "user_text": "帮我改得正式一点，像给老板汇报的版本",
  "teacher_output": {
    "action": "rewrite_report"
  },
  "source": "synthetic",
  "difficulty": "medium",
  "tags": ["rewrite", "tone_change", "followup"],
  "review": {
    "status": "unreviewed",
    "human_label": null
  }
}
```

### 4.2 必备字段

建议至少包含：

- `id`：样本唯一 id
- `theme`：任务主题
- `context.has_visible_report`：是否存在可见报告
- `user_text`：用户输入
- `teacher_output.action`：teacher 标签
- `source`：`synthetic` / `real` / `edited`
- `difficulty`：`easy` / `medium` / `hard`
- `tags`：边界信息标签
- `review.status`：审阅状态
- `review.human_label`：人工标签

### 4.3 推荐标签维度

为了后续分析混淆区，建议给样本额外打一些辅助 tags：

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

这些 tags 不一定用于训练，但非常适合做评测分层与误判分析。

---

## 5. 数据集组成建议

### 5.1 三层数据结构

建议将数据拆成三层：

#### A. Gold Set（金标评测集）
- 规模：300 ~ 1000 条
- 来源：人工精修
- 用途：最终评测、版本回归、线上一致性验证
- 特点：高质量、覆盖边界样本、不参与训练

#### B. Synthetic Train Set（合成训练集）
- 规模：1万 ~ 10万条（视成本而定）
- 来源：teacher 生成 + teacher 打标 + 过滤
- 用途：蒸馏训练主数据
- 特点：量大、覆盖广、可持续扩展

#### C. Hard Case Set（困难样本集）
- 规模：持续增长
- 来源：student 模型错例、人工发现的混淆样本、线上匿名真实样本
- 用途：增强训练、修补边界
- 特点：高价值、强针对性

### 5.2 推荐数据配比

首版建议：

- 70% synthetic
- 20% edited / human-reviewed synthetic
- 10% anonymized real cases（若可获得）

若当前没有真实数据，也可以先全 synthetic 起步，但应尽快补入人工修正与真实样本。

---

## 6. 样本生成策略

### 6.1 生成目标

不是单纯生成“标准句子”，而是要生成：

1. 明确表达样本
2. 模糊表达样本
3. 口语化样本
4. 短句 / 半句样本
5. 指代依赖样本
6. 边界混淆样本
7. 多意图混合样本
8. 错别字 / 非标准表达样本

### 6.2 按意图拆分生成

#### chat 类
例如：
- “你刚才说风险偏高，是因为什么？”
- “这个结论我没看懂，解释一下”
- “如果我是保守型投资者，你会怎么理解这份结果？”
- “这里的逻辑能再展开说说吗”

#### rewrite_report 类
前提：存在可见报告
- “把这版写正式一点”
- “改成适合发给老板看的口吻”
- “基于刚才那份，压缩成三段”
- “风险部分别写那么重，收一收”

#### regenerate_report 类
- “按最新信息重新分析一下”
- “这次不要沿用刚才的结论，重新来一版”
- “给我完整重跑一次”
- “重新生成一个偏保守版本的报告”

### 6.3 按上下文分桶生成

每类样本都建议按以下条件分桶：

- `has_visible_report = true`
- `has_visible_report = false`
- follow-up continuation
- standalone request
- short utterance
- long instruction
- vague request
- explicit request

特别注意：

当 `has_visible_report = false` 时，所有看似“改写”的样本，都要避免直接标成 `rewrite_report`。

### 6.4 生成方法建议

建议采用“双阶段生成”：

#### 阶段一：生成候选用户话术
输入主题、标签定义、上下文变量、风格要求，让 teacher 先生成候选用户表达。

#### 阶段二：重新分类打标
将候选表达连同上下文喂给分类 teacher，严格按标准 prompt 输出 JSON 标签。

这样比“生成时直接带标签”更稳，因为：
- 降低 self-confirm bias
- 更接近真实标注过程
- 有利于发现边界问题

---

## 7. 工具分工设计

## 7.1 Distilabel

用于：
- 批量生成候选用户话术
- 批量调用 teacher 分类器
- 执行规则过滤和导出
- 串联多步 pipeline

适合输出：
- `raw_candidates.jsonl`
- `teacher_labeled.jsonl`
- `filtered_train.jsonl`
- `labelstudio_import.json`

### 推荐在 Distilabel 中实现的步骤

1. 候选样本生成
2. teacher 分类打标
3. 合法性检查（JSON schema）
4. 标签白名单检查
5. 重复样本去重
6. 过短/异常文本过滤
7. 按标签均衡采样

---

## 7.2 Label Studio

用于：
- 抽样人工复核
- 修正 teacher 错标
- 标注 hard cases
- 维护 gold set

### 推荐标注字段

展示给标注员的信息：
- `has_visible_report`
- `user_text`
- `teacher_action`
- 可选：前文报告摘要

人工可选标签：
- `chat`
- `rewrite_report`
- `regenerate_report`
- `uncertain`

建议加入一个可选备注字段：
- “为什么纠正 teacher”

这样后面可以回看边界误判原因。

---

## 7.3 DSPy

用于：
- 将生成 prompt 封装为模块
- 将分类 prompt 封装为模块
- 在小验证集上调优 prompt 结构
- 固化 teacher pipeline 的可复现性

### 推荐 DSPy 封装模块

- `GenerateUtterancesByIntent`
- `ClassifyConversationAction`
- `GenerateBoundaryCases`
- `RewriteAmbiguousCases`

### DSPy 主要作用

它不是替代 Distilabel，而是帮助你把“teacher 逻辑”程序化、标准化，避免后面 prompt 演进全靠手工修改。

---

## 7.4 Promptfoo

用于：
- 对不同 prompt 版本进行批量评测
- 对 teacher 和 student 模型做同一评测集回归测试
- 校验 JSON 输出合法性
- 统计准确率、混淆情况、失败样本

### 推荐评测维度

- Overall accuracy
- Per-class accuracy
- `rewrite_report` precision / recall
- `regenerate_report` precision / recall
- hard cases accuracy
- `has_visible_report=false` 子集准确率
- JSON 格式合法率

---

## 8. 推荐目录结构

建议在项目中采用如下目录：

```text
report-intent-distill/
├── README.md
├── configs/
│   ├── labels.yaml
│   ├── generation.yaml
│   ├── teacher_prompt.txt
│   ├── generator_prompt.txt
│   └── promptfoo.yaml
├── data/
│   ├── raw/
│   │   ├── raw_candidates.jsonl
│   │   └── teacher_labeled.jsonl
│   ├── processed/
│   │   ├── filtered_train.jsonl
│   │   ├── deduped_train.jsonl
│   │   └── labelstudio_import.json
│   ├── gold/
│   │   ├── gold_eval.jsonl
│   │   └── hard_cases.jsonl
│   └── exports/
│       ├── train_for_sft.jsonl
│       ├── eval_for_promptfoo.jsonl
│       └── student_eval.jsonl
├── dspy/
│   ├── signatures.py
│   ├── modules.py
│   └── optimize.py
├── pipelines/
│   ├── generate_candidates.py
│   ├── classify_with_teacher.py
│   ├── filter_and_dedupe.py
│   ├── export_to_labelstudio.py
│   ├── build_gold_set.py
│   └── export_for_training.py
├── training/
│   ├── train_unsloth.py
│   ├── train_axolotl.yaml
│   └── evaluate_student.py
├── reports/
│   ├── eval_summary.md
│   └── confusion_analysis.md
└── tests/
    ├── sample_cases.jsonl
    └── schema_tests.py
```

---

## 9. 数据生产流程设计

## 9.1 第一步：定义场景矩阵

先定义样本生成矩阵，例如：

| 维度 | 可选值 |
|---|---|
| has_visible_report | true / false |
| intent | chat / rewrite_report / regenerate_report |
| explicitness | explicit / implicit |
| style | formal / colloquial / short / typo |
| dialogue_stage | standalone / followup |
| difficulty | easy / medium / hard |

通过笛卡尔组合或受控采样生成覆盖矩阵，避免数据只集中在少数表达模板。

---

## 9.2 第二步：批量生成候选表达

输入：
- intent
- has_visible_report
- style
- difficulty
- dialogue_stage

输出：
- user_text
- tags
- generation rationale（可选，不入最终训练集）

要求：
- 每轮生成尽量多样化
- 控制重复模板
- 显式要求口语、含糊、短句、边界 case

---

## 9.3 第三步：teacher 分类打标

将以下输入交给分类 teacher：
- `has_visible_report`
- `previous_report_summary`（可选）
- `user_text`
- 分类标准 prompt

输出必须是：

```json
{"action":"chat"}
```

同时建议保留：
- 原始模型输出
- 解析后的标签
- 解析是否成功

---

## 9.4 第四步：规则过滤

### 必做过滤
- JSON 不合法的样本剔除
- action 不在白名单内剔除
- 文本长度异常剔除
- 空文本剔除
- 高重复文本去重

### 推荐过滤
- embedding / ngram 去重
- 明显模板化重复去重
- 类别失衡重采样
- “低置信硬猜”样本单独入待审池

---

## 9.5 第五步：人工抽检

建议策略：

- 每轮 synthetic 数据抽样 5% ~ 10%
- 每类至少抽 100 条
- hard cases 单独提高抽检比例
- `rewrite_report` 在 `has_visible_report=false` 的子集中重点抽查

若抽检准确率不达标，则回滚：
- 调整生成 prompt
- 调整分类 prompt
- 增加 few-shot 示例
- 增加 hard cases 生成

---

## 9.6 第六步：构建金标评测集

Gold set 的要求：
- 不参与训练
- 由人工复核确认
- 三类均衡或按实际分布另存分层版本
- 强覆盖边界 case

建议分成：
- `gold_easy.jsonl`
- `gold_hard.jsonl`
- `gold_context_sensitive.jsonl`

---

## 10. 蒸馏训练设计

## 10.1 训练目标

student model 输入：
- 上下文信息 + 用户表达

student model 输出：
- 单行 JSON：`{"action":"chat"}`

### 推荐训练格式

```json
{
  "messages": [
    {
      "role": "system",
      "content": "你是会话动作分类器。请在 chat、rewrite_report、regenerate_report 中严格选择一个动作。若当前没有可见报告，不要返回 rewrite_report。输出必须是单行 JSON。"
    },
    {
      "role": "user",
      "content": "上下文: has_visible_report=true\n用户输入: 帮我改得更正式一点，像汇报材料。"
    },
    {
      "role": "assistant",
      "content": "{\"action\":\"rewrite_report\"}"
    }
  ]
}
```

### 为什么推荐这种格式

因为 student 最终学到的是“带上下文的分类行为”，不是孤立句子分类。

---

## 10.2 模型训练工具建议

### 快速起步
- Unsloth

适合：
- 快速验证
- 显存较有限
- QLoRA 微调

### 更标准工程化
- Axolotl
- Hugging Face TRL

适合：
- 可配置性更强
- 与标准训练流程兼容
- 后续扩展更稳

---

## 10.3 训练阶段建议

### Stage 1：只训基础三分类能力
先用 clean synthetic + reviewed set 训练一个基线 student。

### Stage 2：加入 hard cases 增强
把 student 最常错的边界样本补进去继续训。

### Stage 3：上下文强化
专门补充：
- `has_visible_report=false` 的 rewrite-like 请求
- 多轮 follow-up 场景
- 含糊/半句/短句式输入

---

## 11. 评测设计

## 11.1 核心指标

建议至少关注：

- Overall accuracy
- Macro F1
- Per-class precision / recall / F1
- JSON valid rate
- hard cases accuracy
- context-sensitive subset accuracy

---

## 11.2 特别关注的误判

### 重点误判 A
`rewrite_report` 误判为 `regenerate_report`

说明 student 没学会“基于现有报告修改”的边界。

### 重点误判 B
`rewrite_report` 在无报告上下文下仍被判为 `rewrite_report`

说明 student 没学会上下文约束。

### 重点误判 C
`chat` 被误判成 `regenerate_report`

说明模型把讨论/追问误当作产出请求。

---

## 11.3 Promptfoo 推荐配置方向

Promptfoo 中建议建立如下测试集：

- `basic_explicit_cases`
- `ambiguous_cases`
- `context_sensitive_cases`
- `short_utterance_cases`
- `hard_cases`

每次评测都同时比较：
- teacher 当前版本
- prompt 改版版本
- student 当前 checkpoint

---

## 12. 人工标注设计

## 12.1 标注规范

标注员需要遵守：

1. 只根据定义判断动作，不按主观喜好判断
2. 若不存在可见报告，不得标为 `rewrite_report`
3. 若用户只是解释、追问、讨论、澄清，则优先 `chat`
4. 若用户明确要求生成一版新结果、重新分析、按最新信息重跑，则标 `regenerate_report`
5. 若用户要求基于已有报告改口吻、改结构、缩写、扩写、改风险偏好，则标 `rewrite_report`

### 可加入保底标签
- `uncertain`

对 uncertain 样本做二次审核，不直接进入训练集。

---

## 12.2 质检机制

建议：
- 部分样本双人交叉标注
- 统计一致率
- 对低一致率样本沉淀“边界规则说明”

---

## 13. 版本管理与迭代

## 13.1 建议版本对象

建议同时版本化：

- 生成 prompt 版本
- 分类 prompt 版本
- synthetic dataset 版本
- gold set 版本
- student model 版本
- eval report 版本

例如：

```text
generator_prompt_v3
classifier_prompt_v5
synthetic_train_v20260325
gold_eval_v1
student_qwen2.5_3b_sft_v2
```

---

## 13.2 迭代闭环

每轮迭代建议按以下顺序：

1. 观察 student 错例
2. 汇总混淆模式
3. 补 hard cases
4. 优化 teacher prompt / few-shot
5. 重新生成部分 synthetic 数据
6. 更新训练集
7. 重训 student
8. 用 gold set 回归验证

---

## 14. 风险与注意事项

## 14.1 最大风险：teacher 偏差被 student 放大

如果 teacher prompt 边界没定义清楚，小模型会把这种偏差学得更死。

解决方式：
- 必须有人审 gold set
- 必须有 hard cases
- 必须区分训练集与评测集

---

## 14.2 数据分布失真

如果 synthetic 句子过于工整，student 在线上容易失效。

解决方式：
- 强化口语表达生成
- 引入匿名真实样本
- 单独维护 short / typo / colloquial 子集

---

## 14.3 忽略上下文字段

若训练时未显式输入 `has_visible_report`，student 很可能乱判 `rewrite_report`。

解决方式：
- 将上下文作为训练输入一部分
- 在评测集中专测上下文敏感样本

---

## 14.4 类别不均衡

真实业务里 `chat` 很可能远多于另外两类。

解决方式：
- 训练时可先做均衡采样
- 评测时同时保留均衡集和真实分布集

---

## 15. MVP 落地建议

如果要尽快出第一版，建议先做最小闭环：

### MVP 版本
- Distilabel：生成 3000 ~ 10000 条 synthetic 样本
- Label Studio：人工抽检 300 ~ 500 条
- Promptfoo：建立 200 ~ 300 条评测集
- DSPy：先只封装分类器模块，不必一开始把全链路都 DSPy 化
- Student：先训一个小基线模型验证可行性

### MVP 输出物
- 一份 synthetic train set
- 一份人工 gold eval set
- 一份 Promptfoo 评测配置
- 一个 baseline student checkpoint
- 一份 confusion analysis 报告

---

## 16. 最终推荐结论

对于当前任务，推荐的实施顺序是：

### Phase 1：快速验证
- Distilabel
- Label Studio
- Promptfoo

### Phase 2：稳定优化
- 引入 DSPy 对生成/分类 prompt 编排优化
- 建立 hard cases 迭代闭环

### Phase 3：训练与部署
- 用 Unsloth / Axolotl / TRL 做蒸馏训练
- 用 gold set + Promptfoo 做稳定回归

### 结论
这套 **Distilabel + Label Studio + DSPy + Promptfoo** 的组合，完全可以支撑“基于 teacher 合成数据 + 人工抽检 + 自动评测 + student 蒸馏”的完整流程，适合从 MVP 快速起步，并平滑演进到长期迭代的数据闭环。

---

## 17. 下一步可执行项

建议下一步直接进入以下任一工作：

1. 产出项目脚手架
2. 编写数据 schema
3. 编写 teacher prompt 与 generator prompt
4. 设计 Promptfoo 评测集
5. 设计 Label Studio 标注模板
6. 落第一版 Distilabel pipeline

如果继续推进，优先级建议为：

```text
schema → prompt → synthetic pipeline → human review → eval → student training
```
