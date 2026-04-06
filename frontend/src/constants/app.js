export const STAGE_ACTIONS = [
  {
    command: "generate",
    label: "Forge Run",
    eyebrow: "01",
    description: "新建一个空白 run，只执行生成阶段。",
    requiresRun: false,
  },
  {
    command: "run-all",
    label: "Run All",
    eyebrow: "02",
    description: "一键推进 generate -> classify -> filter-export -> review-export。",
    requiresRun: false,
  },
  {
    command: "classify",
    label: "Classify",
    eyebrow: "03",
    description: "让教师模型正式判定标签。",
    requiresRun: true,
  },
  {
    command: "filter-export",
    label: "Filter",
    eyebrow: "04",
    description: "过滤、去重并导出训练样本。",
    requiresRun: true,
  },
  {
    command: "review-export",
    label: "Review Export",
    eyebrow: "05",
    description: "把高风险样本送入人工复核池。",
    requiresRun: true,
  },
  {
    command: "validate-review",
    label: "Validate",
    eyebrow: "06",
    description: "校验 review 结果是否可进入 gold 阶段。",
    requiresRun: true,
  },
  {
    command: "build-gold",
    label: "Build Gold",
    eyebrow: "07",
    description: "冻结 gold 集与 hard cases。",
    requiresRun: true,
  },
  {
    command: "eval",
    label: "Eval",
    eyebrow: "08",
    description: "对 gold 集回放评测并生成摘要。",
    requiresRun: true,
  },
  {
    command: "student-export",
    label: "Student Export",
    eyebrow: "09",
    description: "导出标准化 student 训练输入。",
    requiresRun: true,
  },
];

export const WORKSPACE_TABS = [
  { key: "overview", label: "Run" },
  { key: "artifacts", label: "Artifacts" },
  { key: "review", label: "Review" },
  { key: "config", label: "Task Config" },
];

export const ARTIFACT_COPY = {
  raw_candidates: "原始候选样本，用来检查生成覆盖。",
  teacher_labeled: "教师标签结果，观察 parse 与标签边界。",
  filtered_train: "过滤后的内部训练集。",
  rejected_samples: "被规则拦下的样本明细。",
  review_candidates: "待人工复核池。",
  review_results: "人工复核结果。",
  gold_eval: "冻结后的 gold 评测集。",
  hard_cases: "高风险 hard cases 子集。",
  eval_predictions: "模型预测与错例明细。",
  eval_result: "结构化评测结论。",
  student_train: "标准化 student 训练输入。",
};

export const ARTIFACT_EXPLANATIONS = {
  raw_candidates: {
    stage: "generate",
    role: "生成阶段产出的原始候选样本，用来检查场景覆盖、生成意图分布和话术自然度。",
    usage:
      "先看这里判断 generator prompt 和 scenario matrix 是否生成了你真正想要的数据；其中 label_hint 只是生成时的弱标签提示。",
    readingHint:
      "优先看 user_text、label_hint、difficulty、has_visible_report。注意 label_hint 不是正式标签，后续还要经过 teacher_labeled 重新判定。",
  },
  teacher_labeled: {
    stage: "classify",
    role: "教师模型对候选样本的正式打标结果，同时保留了解析状态、错误码和教师原始输出。",
    usage:
      "用来把 generate 阶段的 label_hint 转成更可信的 teacher_label，并判断 teacher prompt 是否稳定、标签是否合理。",
    readingHint:
      "重点关注 parse_fail、teacher_label、error_code；这里的 teacher_label 才是 filter-export 的直接输入。",
  },
  filtered_train: {
    stage: "filter-export",
    role: "经过去重和规则过滤后，可以直接进入训练的数据子集。",
    usage: "这是最终可训练样本池，适合看数据纯度和标签分布是否符合预期。",
    readingHint: "如果这里数量偏少，回头检查 teacher_labeled、过滤规则和 rejected_samples。",
  },
  train_export: {
    stage: "filter-export",
    role: "按 exports.train_format 渲染出来的训练导出文件，用于下游 student 或外部训练器消费。",
    usage: "这里反映的是配置化导出格式，不一定和内部 filtered_train 的原始样本结构相同。",
    readingHint: "先确认格式字段是否符合预期，再决定是否继续接训练执行器。",
  },
  train_export_metadata: {
    stage: "filter-export",
    role: "训练导出版本摘要，记录格式、样本数和历史泄漏拦截结果。",
    usage: "需要确认跨版本去重是否生效时，优先看这份元数据而不是手动翻 rejected_samples。",
    readingHint: "重点看 version_id、historical_leakage、sample_count。",
  },
  rejected_samples: {
    stage: "filter-export",
    role: "被过滤掉的样本集合，每条记录带有 rejection_reason，说明为什么不能进入训练集。",
    usage: "用于排查规则误伤、教师打标问题、解析失败和脏数据来源。",
    readingHint: "先看顶部 reason 汇总，再按 rejection_reason 筛选，快速定位主要损耗来源。",
  },
  labelstudio_import: {
    stage: "filter-export",
    role: "供人工复核工具导入的结构化数据包，本质上是 review pool 的中间导出。",
    usage: "如果接外部标注或复核平台，这个文件就是桥接格式。",
    readingHint: "通常不需要逐条浏览，主要确认导出结构和条目数量是否正确。",
  },
  review_candidates: {
    stage: "review-export",
    role: "需要人工判断的高风险样本列表，通常来自 hard、ambiguous、multi_intent 样本。",
    usage: "这是人工复核入口，用来决定哪些教师标签需要人工确认或修正。",
    readingHint: "重点看 teacher_label、difficulty、tags 和用户文本是否存在歧义。",
  },
  review_results: {
    stage: "人工复核",
    role: "人工复核后的最终结果，包含 decision、reviewer_label、review_comment 等信息。",
    usage: "这是 build-gold 前的核心输入，决定 gold 样本的最终标签。",
    readingHint: "先看 accepted/corrected/rejected 分布，再看 comment 和 reviewer_label 是否完整。",
  },
  gold_eval: {
    stage: "build-gold",
    role: "冻结后的 gold 评测集，是后续 eval 的标准答案来源。",
    usage: "用来确认最终基准集内容和人工修正后的标签结果。",
    readingHint: "重点看 final_label、teacher_label、difficulty 和 hard case 分布。",
  },
  hard_cases: {
    stage: "build-gold",
    role: "从 gold 集里抽出的高难度样本子集，用于单独检查边界情况。",
    usage: "适合做模型薄弱点分析和回归测试样本池。",
    readingHint: "优先关注 ambiguous、多意图和高风险场景。",
  },
  eval_for_promptfoo: {
    stage: "eval",
    role: "导给 promptfoo 或外部评测框架使用的评测输入文件。",
    usage: "用于和外部评测工具对接，不是给人直接阅读的主视图。",
    readingHint: "主要确认导出是否生成成功、格式是否符合评测工具要求。",
  },
  eval_predictions: {
    stage: "eval",
    role: "模型在 gold 集上的预测结果，包含 expected/predicted/parse/error 等关键信息。",
    usage: "用来做误差分析、混淆对比和回归质量判断。",
    readingHint: "先看 mismatch 和 parse_fail，再从表格里追具体错例。",
  },
  eval_export: {
    stage: "eval",
    role: "按 exports.eval_format 渲染出来的评测导出文件，用于外部评测器或离线分析程序消费。",
    usage: "这是配置化评测导出，不等同于 Promptfoo 运行时必须使用的内部输入文件。",
    readingHint: "如果更换了 eval_format，优先确认这里的结构是否与目标评测框架匹配。",
  },
  eval_export_metadata: {
    stage: "eval",
    role: "评测导出版本摘要，记录本次 eval 导出版本、样本数和来源路径。",
    usage: "需要追踪某版评测集来自哪次 run、使用何种格式时，优先查看这里。",
    readingHint: "重点看 version_id、format、source_paths、hard_case_sample_count。",
  },
  student_train: {
    stage: "student-export",
    role: "标准化 student 训练输入文件，是后续训练执行器最直接消费的产物。",
    usage: "如果准备接 student 蒸馏或分类训练，优先使用这份文件而不是内部中间样本。",
    readingHint: "先确认消息结构、标签编码和 sample_count，再决定是否启动训练。",
  },
  training_metadata: {
    stage: "student-export",
    role: "student 训练产物的版本说明，记录来源 run、格式、样本量和回流约束。",
    usage: "用于追踪这版训练输入来自哪里，以及是否包含 hard cases 等关键治理信息。",
    readingHint: "优先看 version_id、source_artifact、format、includes_hard_cases。",
  },
  hard_cases_metadata: {
    stage: "build-gold",
    role: "hard cases 版本摘要，记录来源原因分布与回流日期。",
    usage: "用于治理 hard cases 资产，而不是直接看逐条样本才知道为什么进 hard cases。",
    readingHint: "重点看 source_reason_breakdown、reflow_date、sample_count。",
  },
  eval_result: {
    stage: "eval",
    role: "结构化评测摘要，汇总数据规模、核心指标、错例概况和 Promptfoo 结果。",
    usage: "这是 API 和前端读取 eval 结论的主摘要文件，适合快速确认一次 run 是否达到可保留基线。",
    readingHint: "先看 metrics、quality、promptfoo 三段，再决定是否继续追 eval_predictions 或 confusion_analysis。",
  },
  eval_summary: {
    stage: "eval",
    role: "评测阶段的文字总结报告，通常概括整体准确率、错误概况和结论。",
    usage: "适合快速看本次 run 的整体评估结果，不必逐条翻预测明细。",
    readingHint: "结合 eval_predictions 和 confusion_analysis 一起看更完整。",
  },
  confusion_analysis: {
    stage: "eval",
    role: "标签混淆分析报告，帮助判断哪些意图之间最容易相互误判。",
    usage: "适合产品和算法一起复盘标签体系是否足够可分。",
    readingHint: "重点看高频混淆对，反推 prompt、labels 或 scenario 设计问题。",
  },
  review_validation_report: {
    stage: "validate-review",
    role: "人工复核结果的校验报告，用来发现 review_results 中缺失或不合法的字段。",
    usage: "在 build-gold 前先确认人工复核结果可用。",
    readingHint: "如果这里报错，先修 review_results，再继续后续阶段。",
  },
};

export const ARTIFACT_CATEGORY_META = {
  raw: {
    label: "Raw Intake",
    description: "先确认上游生成和教师标注是否稳定，再决定要不要继续下游阶段。",
  },
  processed: {
    label: "Processed Pool",
    description: "过滤、复核和人工编辑阶段的核心工作区，最适合排查规则误伤和待处理样本。",
  },
  gold: {
    label: "Gold Freeze",
    description: "确认最终基准集和 hard cases 是否符合预期。",
  },
  exports: {
    label: "Evaluation Inputs",
    description: "面向外部评测工具和预测结果的导出层。",
  },
  reports: {
    label: "Readable Reports",
    description: "优先看这里获取总结、结论和混淆分析，而不是先翻原始 JSONL。",
  },
  training: {
    label: "Student Feed",
    description: "student 训练器真正会消费的输入和版本元数据。",
  },
  other: {
    label: "Other",
    description: "其他辅助文件。",
  },
};

export const RECOMMENDED_ARTIFACTS_BY_STAGE = {
  generate: ["raw_candidates"],
  classify: ["teacher_labeled"],
  "filter-export": ["rejected_samples", "filtered_train", "train_export"],
  "review-export": ["review_candidates"],
  "validate-review": ["review_results", "review_validation_report"],
  "build-gold": ["gold_eval", "hard_cases"],
  eval: ["eval_result", "eval_summary", "confusion_analysis", "eval_predictions"],
  "student-export": ["student_train", "training_metadata"],
};

export const REVIEW_DECISION_DETAILS = {
  pending: {
    label: "pending",
    display: "待处理",
    description: "暂不下最终结论，只保留这条复核记录，不改 human_label。",
    requirement: "不会进入 gold，适合还要回看上下文或等待二次确认的样本。",
  },
  accepted: {
    label: "accepted",
    display: "接受教师标签",
    description: "人工确认 teacher_label 正确，最终标签沿用教师结果。",
    requirement: "会进入 gold；如果 Reviewer Label 留空，保存时会自动回填 teacher_label。",
  },
  corrected: {
    label: "corrected",
    display: "人工改标",
    description: "人工认为 teacher_label 不对，并改成新的最终标签。",
    requirement: "会进入 gold；必须填写 Reviewer Label，最终以人工标签为准。",
  },
  rejected: {
    label: "rejected",
    display: "拒绝样本",
    description: "这条样本不应进入最终数据，通常因为样本质量或可判定性有问题。",
    requirement: "不会进入 gold；必须填写 Comment，说明拒绝原因。",
  },
};

export const REJECTION_REASON_LABELS = {
  empty_user_text: "用户文本为空",
  parse_failed: "教师输出解析失败",
  label_not_allowed: "标签不在允许集合",
  text_too_short: "文本过短",
  text_too_long: "文本过长",
  rewrite_without_visible_report: "无可见报告却要求改写",
};

export const RAW_CANDIDATE_GROUP_OPTIONS = [
  { value: "label_hint", label: "按 label_hint" },
  { value: "difficulty", label: "按 difficulty" },
  { value: "has_visible_report", label: "按 has_visible_report" },
  { value: "dialogue_stage", label: "按 dialogue_stage" },
];

export const PIPELINE_STAGE_META = {
  generate: {
    shortLabel: "候选生成",
    description: "创建新的 run，并产出带有 label_hint 的原始候选样本。",
    actionHint:
      "这里的 label_hint 只是生成侧提示，不是正式标签，先确认 scenario matrix 与 generator prompt 是否覆盖目标样本空间。",
  },
  classify: {
    shortLabel: "教师打标",
    description: "让教师模型基于样本文本重新判定正式标签，并写入结构化 annotation。",
    actionHint:
      "重点关注 parse_fail 和 teacher_label 的稳定性；这一层才是后续过滤、复核和评测使用的正式标注。",
  },
  "filter-export": {
    shortLabel: "过滤导出",
    description: "去重、规则过滤，并拆出训练集、拒绝集和复核池。",
    actionHint: "优先检查 rejected_samples 的损耗原因和 filtered_train 的纯度。",
  },
  "review-export": {
    shortLabel: "复核导出",
    description: "导出人工复核候选，准备 review 闭环。",
    actionHint: "导出后应尽快进入人工复核，不要让 run 卡在交接阶段。",
  },
  "validate-review": {
    shortLabel: "复核校验",
    description: "校验 review_results 是否完整、合法、可进入 gold 构建。",
    actionHint: "若这里失败，先修 review_results，再继续下游流程。",
  },
  "build-gold": {
    shortLabel: "冻结 Gold",
    description: "把人工复核结果应用到样本，冻结 gold 和 hard cases。",
    actionHint: "gold 是后续 eval 的基准，优先保证标签正确性而不是速度。",
  },
  eval: {
    shortLabel: "评测分析",
    description: "在 gold 集上重新预测，输出 summary 与 confusion 分析。",
    actionHint: "完成后优先看 eval_summary、confusion_analysis 和 eval_predictions。",
  },
  "student-export": {
    shortLabel: "训练导出",
    description: "把最终样本导出成 student 训练器真正消费的标准输入。",
    actionHint: "确认格式和来源版本后再启动训练，不要直接拿中间产物去接训练器。",
  },
};

export const RUNTIME_STAGE_META = {
  generator: {
    index: "01",
    eyebrow: "Sample Forge",
    title: "Generator",
    description: "决定候选样本怎么被生成，先选 provider，再确认模型和控制参数。",
  },
  teacher: {
    index: "02",
    eyebrow: "Label Judge",
    title: "Teacher",
    description: "决定教师标注链路的稳定性，优先保证 JSON 输出与标签边界一致。",
  },
  eval: {
    index: "03",
    eyebrow: "Benchmark Lens",
    title: "Eval",
    description: "决定 gold 集上的回放评测行为，通常与 teacher 接近但不必完全相同。",
  },
};

export const DIFFICULTY_OPTIONS = ["easy", "medium", "hard"];
export const DIALOGUE_STAGE_OPTIONS = ["standalone", "followup"];

export const DEFAULT_CREATE_TASK = {
  name: "",
  theme: "intent_classification",
  language: "zh",
  task_type: "classification",
  entry_schema: "conversation_action",
};

export const EMPTY_RUNTIME_MODELS = {
  generator: [],
  teacher: [],
  eval: [],
};
