export const PIPELINE_STAGES = [
  {
    command: "generate",
    stageKey: "generate",
    label: "Generate",
    shortLabel: "候选生成",
    description: "创建新的 run，并产出带有 label_hint 的原始候选样本。",
    actionHint: "这里的 label_hint 只是生成侧提示，不是正式标签，先确认 scenario matrix 与 generator prompt 是否覆盖目标样本空间。",
  },
  {
    command: "classify",
    stageKey: "classify",
    label: "Classify",
    shortLabel: "教师打标",
    description: "让教师模型基于样本文本重新判定正式标签，并写入结构化 annotation。",
    actionHint: "重点关注 parse_fail 和 teacher_label 的稳定性；这一层才是后续过滤、复核和评测使用的正式标注。",
  },
  {
    command: "filter-export",
    stageKey: "filter_export",
    label: "Filter Export",
    shortLabel: "过滤导出",
    description: "去重、规则过滤，并拆出训练集、拒绝集和复核池。",
    actionHint: "优先检查 rejected_samples 的损耗原因和 filtered_train 的纯度。",
  },
  {
    command: "review-export",
    stageKey: "review_export",
    label: "Review Export",
    shortLabel: "复核导出",
    description: "导出人工复核候选，准备 review 闭环。",
    actionHint: "导出后应尽快进入人工复核，不要让 run 卡在交接阶段。",
  },
  {
    command: "validate-review",
    stageKey: "validate_review",
    label: "Validate Review",
    shortLabel: "复核校验",
    description: "校验 review_results 是否完整、合法、可进入 gold 构建。",
    actionHint: "若这里失败，先修 review_results，再继续下游流程。",
  },
  {
    command: "build-gold",
    stageKey: "build_gold",
    label: "Build Gold",
    shortLabel: "冻结 Gold",
    description: "把人工复核结果应用到样本，冻结 gold 和 hard cases。",
    actionHint: "gold 是后续 eval 的基准，优先保证标签正确性而不是速度。",
  },
  {
    command: "eval",
    stageKey: "eval",
    label: "Eval",
    shortLabel: "评测分析",
    description: "在 gold 集上重新预测，输出 summary 与 confusion 分析。",
    actionHint: "完成后优先看 eval_summary、confusion_analysis 和 eval_predictions。",
  },
];

export const NEW_RUN_COMMANDS = new Set(["generate", "run-all"]);

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
