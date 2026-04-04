const state = {
  tasks: [],
  runs: [],
  selectedTask: null,
  taskSpec: null,
  taskConfig: null,
  originalTaskConfig: null,
  configDirty: false,
  configSaving: false,
  isEditingTaskConfig: false,
  activeTab: "task-spec",
  promptView: "generator",
  selectedRunId: null,
  selectedRun: null,
  selectedArtifactKey: null,
  artifactPayload: null,
  artifactViewMode: "structured",
  rawCandidateViewMode: "table",
  rawCandidateGroupBy: "label_hint",
  artifactSearch: "",
  artifactFilter: "all",
  reviewRecords: [],
  reviewLabels: [],
  reviewFilter: "all",
  loadingCommand: null,
  deletingRunId: null,
};

const PIPELINE_STAGES = [
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

const NEW_RUN_COMMANDS = new Set(["generate", "run-all"]);

const REVIEW_DECISION_DETAILS = {
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

const taskListEl = document.getElementById("taskList");
const runListEl = document.getElementById("runList");
const artifactListEl = document.getElementById("artifactList");
const artifactMetaEl = document.getElementById("artifactMeta");
const artifactPreviewEl = document.getElementById("artifactPreview");
const artifactStructuredViewEl = document.getElementById("artifactStructuredView");
const artifactSummaryBarEl = document.getElementById("artifactSummaryBar");
const artifactExplainerEl = document.getElementById("artifactExplainer");
const artifactSearchInputEl = document.getElementById("artifactSearchInput");
const artifactFilterSelectEl = document.getElementById("artifactFilterSelect");
const artifactViewSwitchEl = document.getElementById("artifactViewSwitch");
const rawCandidateViewSwitchEl = document.getElementById("rawCandidateViewSwitch");
const rawCandidateGroupByFieldEl = document.getElementById("rawCandidateGroupByField");
const rawCandidateGroupBySelectEl = document.getElementById("rawCandidateGroupBySelect");
const reviewListEl = document.getElementById("reviewList");
const reviewSummaryEl = document.getElementById("reviewSummary");
const messageBarEl = document.getElementById("messageBar");

const workspaceTitleEl = document.getElementById("workspaceTitle");
const workspaceSubtitleEl = document.getElementById("workspaceSubtitle");
const workspaceContextEl = document.getElementById("workspaceContext");
const recommendedActionTitleEl = document.getElementById("recommendedActionTitle");
const recommendedActionBodyEl = document.getElementById("recommendedActionBody");
const recommendedActionMetaEl = document.getElementById("recommendedActionMeta");
const taskNameValueEl = document.getElementById("taskNameValue");
const runIdValueEl = document.getElementById("runIdValue");
const runStatusValueEl = document.getElementById("runStatusValue");
const lastStageValueEl = document.getElementById("lastStageValue");
const createdAtValueEl = document.getElementById("createdAtValue");
const updatedAtValueEl = document.getElementById("updatedAtValue");
const labelSummaryValueEl = document.getElementById("labelSummaryValue");
const taskCountEl = document.getElementById("taskCount");
const runCountEl = document.getElementById("runCount");
const reviewerInputEl = document.getElementById("reviewerInput");
const taskSpecOverviewEl = document.getElementById("taskSpecOverview");
const taskSpecLabelsEl = document.getElementById("taskSpecLabels");
const taskSpecRulesEl = document.getElementById("taskSpecRules");
const taskSpecExportsEl = document.getElementById("taskSpecExports");
const taskSpecReadViewEl = document.getElementById("taskSpecReadView");
const taskSpecEditViewEl = document.getElementById("taskSpecEditView");
const taskDossierHeroEl = document.getElementById("taskDossierHero");
const taskRuntimeGridEl = document.getElementById("taskRuntimeGrid");
const taskScenarioGridEl = document.getElementById("taskScenarioGrid");
const taskPromptMetaEl = document.getElementById("taskPromptMeta");
const taskPromptPreviewEl = document.getElementById("taskPromptPreview");
const promptViewSwitchEl = document.getElementById("promptViewSwitch");
const taskConfigSummaryEl = document.getElementById("taskConfigSummary");
const taskConfigImpactEl = document.getElementById("taskConfigImpact");
const taskConfigStatusEl = document.getElementById("taskConfigStatus");
const taskConfigAdviceEl = document.getElementById("taskConfigAdvice");
const taskMetaFormEl = document.getElementById("taskMetaForm");
const taskRuntimeEditorEl = document.getElementById("taskRuntimeEditor");
const taskRulesEditorEl = document.getElementById("taskRulesEditor");
const taskExportsEditorEl = document.getElementById("taskExportsEditor");
const taskLabelsEditorEl = document.getElementById("taskLabelsEditor");
const taskScenarioSummaryEl = document.getElementById("taskScenarioSummary");
const taskScenarioEditorEl = document.getElementById("taskScenarioEditor");
const taskPromptEditorEl = document.getElementById("taskPromptEditor");
const pipelineOverviewEl = document.getElementById("pipelineOverview");
const stageTimelineEl = document.getElementById("stageTimeline");
const runChecklistEl = document.getElementById("runChecklist");

const taskActionButtons = Array.from(document.querySelectorAll('[data-command-scope="task"]'));
const runCommandButtons = Array.from(document.querySelectorAll('[data-command-scope="run"]'));
const allCommandButtons = [...taskActionButtons, ...runCommandButtons];
const refreshAllButton = document.getElementById("refreshAllButton");
const reloadArtifactButton = document.getElementById("reloadArtifactButton");
const reloadReviewButton = document.getElementById("reloadReviewButton");
const saveReviewButton = document.getElementById("saveReviewButton");
const reloadTaskConfigButton = document.getElementById("reloadTaskConfigButton");
const editTaskConfigButton = document.getElementById("editTaskConfigButton");
const resetTaskConfigButton = document.getElementById("resetTaskConfigButton");
const saveTaskConfigButton = document.getElementById("saveTaskConfigButton");
const addScenarioButton = document.getElementById("addScenarioButton");
const workbenchTabButtons = Array.from(document.querySelectorAll("[data-workbench-tab]"));
const workbenchPanels = Array.from(document.querySelectorAll("[data-workbench-panel]"));

const ARTIFACT_EXPLANATIONS = {
  raw_candidates: {
    stage: "generate",
    role: "生成阶段产出的原始候选样本，用来检查场景覆盖、生成意图分布和话术自然度。",
    usage: "先看这里判断 generator prompt 和 scenario matrix 是否生成了你真正想要的数据；其中 label_hint 只是生成时的弱标签提示。",
    readingHint: "优先看 user_text、label_hint、difficulty、has_visible_report。注意 label_hint 不是正式标签，后续还要经过 teacher_labeled 重新判定。",
  },
  teacher_labeled: {
    stage: "classify",
    role: "教师模型对候选样本的正式打标结果，同时保留了解析状态、错误码和教师原始输出。",
    usage: "用来把 generate 阶段的 label_hint 转成更可信的 teacher_label，并判断 teacher prompt 是否稳定、标签是否合理。",
    readingHint: "重点关注 parse_fail、teacher_label、error_code；这里的 teacher_label 才是 filter-export 的直接输入。",
  },
  filtered_train: {
    stage: "filter-export",
    role: "经过去重和规则过滤后，可以直接进入训练的数据子集。",
    usage: "这是最终可训练样本池，适合看数据纯度和标签分布是否符合预期。",
    readingHint: "如果这里数量偏少，回头检查 teacher_labeled、过滤规则和 rejected_samples。",
  },
  train_export: {
    stage: "filter-export",
    role: "按 `exports.train_format` 渲染出来的训练导出文件，用于下游 student 或外部训练器消费。",
    usage: "这里反映的是配置化导出格式，不一定和内部 `filtered_train` 的原始样本结构相同。",
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
    role: "按 `exports.eval_format` 渲染出来的评测导出文件，用于外部评测器或离线分析程序消费。",
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
    readingHint: "先看 metrics、quality、promptfoo 三段，再决定是否继续追 `eval_predictions` 或 `confusion_analysis`。",
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
  generate_manifest: {
    stage: "generate",
    role: "生成阶段 manifest，记录输入输出路径、运行时间和统计信息。",
    usage: "主要用于审计和排查，不是用户主阅读产物。",
    readingHint: "通常只在查问题时看；默认列表里已隐藏 manifest。",
  },
  classify_manifest: {
    stage: "classify",
    role: "分类阶段 manifest，记录 teacher 标注运行摘要。",
    usage: "用于审计与问题排查。",
    readingHint: "默认隐藏，仅在需要排查 stage 执行细节时查看。",
  },
  filter_manifest: {
    stage: "filter-export",
    role: "过滤阶段 manifest，记录保留、拒绝、复核池数量等统计。",
    usage: "适合快速核对过滤是否符合预期。",
    readingHint: "默认隐藏；若训练集数量异常，优先看这里的统计。",
  },
  review_export_manifest: {
    stage: "review-export",
    role: "复核导出阶段 manifest，记录 review pool 导出的输入输出摘要。",
    usage: "用于确认 review candidates 是否成功生成。",
    readingHint: "默认隐藏，仅排查 review-export 时查看。",
  },
  review_validate_manifest: {
    stage: "validate-review",
    role: "复核校验阶段 manifest，记录 review 校验执行摘要。",
    usage: "用于审计 review 校验流程。",
    readingHint: "默认隐藏。",
  },
  build_gold_manifest: {
    stage: "build-gold",
    role: "gold 构建阶段 manifest，记录冻结样本数量和输出路径。",
    usage: "用于核对 gold 和 hard cases 的构建结果。",
    readingHint: "默认隐藏。",
  },
  eval_manifest: {
    stage: "eval",
    role: "评测阶段 manifest，记录 eval 输入输出和统计摘要。",
    usage: "用于审计评测执行过程。",
    readingHint: "默认隐藏。",
  },
};

const ARTIFACT_CATEGORY_META = {
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
};

const RECOMMENDED_ARTIFACTS_BY_STAGE = {
  generate: ["raw_candidates"],
  classify: ["teacher_labeled"],
  "filter-export": ["rejected_samples", "filtered_train", "train_export"],
  "review-export": ["review_candidates"],
  "validate-review": ["review_results", "review_validation_report"],
  "build-gold": ["gold_eval", "hard_cases"],
  eval: ["eval_export", "eval_result", "eval_summary", "confusion_analysis", "eval_predictions"],
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return response.json();
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function setMessage(text, type = "neutral") {
  messageBarEl.textContent = text;
  messageBarEl.classList.remove("is-error", "is-success");
  if (type === "error") {
    messageBarEl.classList.add("is-error");
  }
  if (type === "success") {
    messageBarEl.classList.add("is-success");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatArtifactValue(value) {
  if (value == null || value === "") {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(", ") || "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function getRejectionReasonLabel(reason) {
  const labels = {
    empty_user_text: "用户文本为空",
    parse_failed: "教师输出解析失败",
    label_not_allowed: "标签不在允许范围",
    text_too_short: "文本过短",
    text_too_long: "文本过长",
    rewrite_without_visible_report: "无可见报告却判为 rewrite_report",
    historical_leakage: "与历史 gold/eval/hard_cases 冲突",
  };
  return labels[reason] || reason || "-";
}

function getReviewDecisionDetail(decision) {
  return REVIEW_DECISION_DETAILS[decision] || REVIEW_DECISION_DETAILS.pending;
}

function renderReviewDecisionOptions(selectedDecision) {
  return Object.values(REVIEW_DECISION_DETAILS)
    .map(
      (detail) => `
        <option value="${escapeHtml(detail.label)}" ${selectedDecision === detail.label ? "selected" : ""}>
          ${escapeHtml(`${detail.label} | ${detail.display}`)}
        </option>
      `
    )
    .join("");
}

function renderReviewDecisionGuide(selectedDecision) {
  const active = getReviewDecisionDetail(selectedDecision);
  return `
    <div class="review-decision-active-note">
      <div class="review-decision-item-head">
        <strong>当前选择：${escapeHtml(`${active.label} | ${active.display}`)}</strong>
      </div>
      <p>${escapeHtml(active.description)}</p>
      <span class="review-decision-item-note">${escapeHtml(active.requirement)}</span>
    </div>
  `;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function syncConfigDirty() {
  state.configDirty =
    !!state.taskConfig && !!state.originalTaskConfig && JSON.stringify(state.taskConfig) !== JSON.stringify(state.originalTaskConfig);
}

function setConfigStatus(text, type = "neutral") {
  taskConfigStatusEl.textContent = text;
  taskConfigStatusEl.classList.remove("is-error", "is-success", "is-warning");
  if (type === "error") {
    taskConfigStatusEl.classList.add("is-error");
  }
  if (type === "success") {
    taskConfigStatusEl.classList.add("is-success");
  }
  if (type === "warning") {
    taskConfigStatusEl.classList.add("is-warning");
  }
}

function estimateScenarioSamples(scenario) {
  const count = Number(scenario?.generation_count || 0);
  if (Number.isInteger(count) && count > 0) {
    return count;
  }
  return (scenario?.templates || []).filter(Boolean).length;
}

function totalEstimatedSamples(scenarios = []) {
  return scenarios.reduce((sum, scenario) => sum + estimateScenarioSamples(scenario), 0);
}

function configInputValue(value) {
  return value == null ? "" : String(value);
}

function getRecordSearchText(record) {
  const parts = [
    record.id,
    record.sample_id,
    record.user_text,
    record.input?.user_text,
    record.rejection_reason,
    record.annotation?.teacher_label,
    record.annotation?.final_label,
    record.predicted_label,
    record.expected_label,
    record.review_decision,
    record.reviewer_label,
    record.metadata?.label_hint,
    record.metadata?.difficulty,
    ...(record.metadata?.tags || []),
    ...(record.tags || []),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function buildSummaryChips(items) {
  return items
    .filter(([, value]) => value != null)
    .map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</span>`)
    .join("");
}

function getCompletedStageKeys(run) {
  return new Set(Object.keys(run?.stages || {}).filter((key) => run?.stages?.[key]));
}

function getStageByCommand(command) {
  return PIPELINE_STAGES.find((stage) => stage.command === command) || null;
}

function getNextStage(run) {
  const completed = getCompletedStageKeys(run);
  return PIPELINE_STAGES.find((stage) => !completed.has(stage.stageKey)) || null;
}

function getProgressText(run) {
  const completedCount = getCompletedStageKeys(run).size;
  return `${completedCount}/${PIPELINE_STAGES.length} stages`;
}

function getStageState(run, command) {
  const stage = getStageByCommand(command);
  if (!stage) {
    return "idle";
  }
  const completed = getCompletedStageKeys(run);
  if (completed.has(stage.stageKey)) {
    return "complete";
  }
  if (state.loadingCommand === command) {
    return "running";
  }
  if (getNextStage(run)?.command === command) {
    return "next";
  }
  return "idle";
}

function getCommandAvailability(command, run) {
  if (!state.selectedTask) {
    return { disabled: true, reason: "no-task" };
  }
  if (state.loadingCommand) {
    return { disabled: true, reason: "busy" };
  }
  if (NEW_RUN_COMMANDS.has(command)) {
    return { disabled: false, reason: null };
  }
  if (!run) {
    return { disabled: true, reason: "no-run" };
  }
  const stage = getStageByCommand(command);
  if (stage && getCompletedStageKeys(run).has(stage.stageKey)) {
    return { disabled: true, reason: "completed" };
  }
  return { disabled: false, reason: null };
}

function getTaskActionState(command) {
  if (state.loadingCommand === command) {
    return "running";
  }
  if (command === "run-all") {
    return "batch";
  }
  return "idle";
}

function getStageStatsPreview(run, stageKey) {
  if (stageKey === "eval" && run?.evaluation) {
    const summary = run.evaluation;
    return `acc: ${formatArtifactValue(summary.overall_accuracy)} / f1: ${formatArtifactValue(summary.macro_f1)}`;
  }
  const stats = run?.stages?.[stageKey]?.stats;
  if (!stats || typeof stats !== "object") {
    return null;
  }
  const [key, value] = Object.entries(stats)[0] || [];
  if (key == null || value == null) {
    return null;
  }
  return `${key}: ${formatArtifactValue(value)}`;
}

function buildRecommendedAction(task, run) {
  if (!task) {
    return {
      title: "先选择一个 task",
      body: "左侧选中任务后，工作台会自动加载任务定义、运行历史、产物和 review 入口。",
      meta: [
        ["模式", "探索工作台"],
        ["建议", "先看任务定义，再决定是否启动新 run"],
      ],
    };
  }

  if (state.activeTab === "task-spec") {
    if (state.isEditingTaskConfig) {
      return {
        title: "先完成这份任务卷宗",
        body: "当前在编辑 task 配置。优先校对 scenario、runtime、prompts 与 exports，确认无误后保存，再从本页发起新 run。",
        meta: [
          ["模式", "任务定义 / 编辑"],
          ["labels", String(task.labels?.length || 0)],
        ],
      };
    }
    return {
      title: "任务定义是唯一的新建入口",
      body: "先在本页确认 task 的主题、标签体系、scenario matrix 与 prompts，然后再用 generate 或 run-all 发起新的 run。",
      meta: [
        ["模式", "任务定义 / 只读"],
        ["runs", String(task.run_count || 0)],
      ],
    };
  }

  if (!run) {
    return {
      title: "先去任务定义页新建 run",
      body: "“任务定义”页提供 task 级的新建 run 入口；首次验证整条链路优先用 run-all，只看生成质量再单独用 generate。",
      meta: [
        ["推荐入口", "任务定义 / run-all"],
        ["当前状态", "尚未选择 run"],
      ],
    };
  }

  const nextStage = getNextStage(run);
  if (nextStage?.command === "generate") {
    return {
      title: "当前 run 尚未真正启动",
      body: "generate 已移到“任务定义”页；如果这是空 run，建议直接删除它，再到“任务定义”页重新新建。",
      meta: [
        ["当前进度", getProgressText(run)],
        ["建议入口", "任务定义 / generate"],
      ],
    };
  }
  if (!nextStage) {
    return {
      title: "当前 run 已完成闭环",
      body: "优先切到“运行产物”，查看 eval_summary、confusion_analysis 和 eval_predictions，确认这次 run 是否值得保留为基线。",
      meta: [
        ["当前进度", getProgressText(run)],
        ["建议入口", "运行产物 / 评测报告"],
      ],
    };
  }

  const specialNote =
    nextStage.command === "validate-review" || nextStage.command === "build-gold"
      ? "继续前先确认 review_results 已由人工补齐。"
      : nextStage.command === "eval"
        ? "评测前优先确认 gold_eval 是否已生成且样本量符合预期。"
        : nextStage.actionHint;

  return {
    title: `下一步：${nextStage.shortLabel}`,
    body: `${nextStage.description} ${specialNote}`,
    meta: [
      ["当前进度", getProgressText(run)],
      ["last_stage", run.last_stage || "created"],
    ],
  };
}

function renderOperationalNarrative() {
  const task = state.selectedTask;
  const run = state.selectedRun;
  const recommendation = buildRecommendedAction(task, run);
  const taskScopedView = state.activeTab === "task-spec";

  workspaceContextEl.innerHTML = buildSummaryChips([
    ["theme", task?.theme || "-"],
    ["type", task?.task_type || "-"],
    ["language", task?.language || "-"],
    ["labels", String(task?.labels?.length || 0)],
    ["runs", String(task?.run_count || 0)],
    [taskScopedView ? "mode" : "progress", taskScopedView ? "任务卷宗" : run ? getProgressText(run) : "0/7 stages"],
  ]);

  recommendedActionTitleEl.textContent = recommendation.title;
  recommendedActionBodyEl.textContent = recommendation.body;
  recommendedActionMetaEl.innerHTML = buildSummaryChips(recommendation.meta);

  pipelineOverviewEl.innerHTML = PIPELINE_STAGES.map((stage, index) => {
    const visualState = getStageState(run, stage.command);
    const stats = getStageStatsPreview(run, stage.stageKey);
    const stateLabel =
      visualState === "complete"
        ? "completed"
        : visualState === "running"
          ? "running"
          : visualState === "next"
            ? "next"
            : "waiting";
    return `
      <article class="pipeline-stage-card is-${visualState}">
        <div class="pipeline-stage-head">
          <span class="pipeline-stage-index">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
          <span class="pipeline-stage-state">${escapeHtml(stateLabel)}</span>
        </div>
        <h3>${escapeHtml(stage.shortLabel)}</h3>
        <p>${escapeHtml(stage.description)}</p>
        <span class="pipeline-stage-foot">${escapeHtml(stats || stage.label)}</span>
      </article>
    `;
  }).join("");

  taskActionButtons.forEach((button) => {
    const command = button.dataset.command;
    const availability = getCommandAvailability(command, run);
    const stageState = getTaskActionState(command);
    button.classList.toggle("is-complete", stageState === "complete");
    button.classList.toggle("is-next", stageState === "next");
    button.classList.toggle("is-shortcut", stageState === "batch");
    button.dataset.stageState = stageState;
    button.disabled = availability.disabled;
    const stateEl = button.querySelector(".command-state");
    if (stateEl) {
      let stateText = "available";
      if (stageState === "complete") {
        stateText = "completed";
      } else if (stageState === "running") {
        stateText = "running";
      } else if (availability.reason === "no-task") {
        stateText = "select task";
      } else if (availability.reason === "no-run") {
        stateText = "select run";
      } else if (stageState === "next") {
        stateText = "recommended";
      } else if (command === "run-all") {
        stateText = "first pass";
      }
      stateEl.textContent = stateText;
    }
  });

  runCommandButtons.forEach((button) => {
    const command = button.dataset.command;
    const availability = getCommandAvailability(command, run);
    const stageState = getStageState(run, command);
    button.classList.toggle("is-complete", stageState === "complete");
    button.classList.toggle("is-next", stageState === "next");
    button.classList.toggle("is-shortcut", false);
    button.dataset.stageState = stageState;
    button.disabled = availability.disabled;
    const stateEl = button.querySelector(".command-state");
    if (stateEl) {
      let stateText = "available";
      if (stageState === "complete") {
        stateText = "completed";
      } else if (stageState === "running") {
        stateText = "running";
      } else if (availability.reason === "no-task") {
        stateText = "select task";
      } else if (availability.reason === "no-run") {
        stateText = "select run";
      } else if (stageState === "next") {
        stateText = "recommended";
      }
      stateEl.textContent = stateText;
    }
  });

  if (!run) {
    stageTimelineEl.innerHTML = '<div class="empty-state">选择 run 后显示阶段完成顺序与统计。</div>';
    runChecklistEl.innerHTML = `
      <article class="operator-note-card">
        <strong>先确认任务定义</strong>
        <span>进入“任务定义”页检查 labels、runtime、scenario matrix 和 prompts 是否符合当前目标。</span>
      </article>
      <article class="operator-note-card">
        <strong>首次执行建议</strong>
        <span>当前页只负责推进已有 run；要新建 run，请切到“任务定义”页，首次跑通优先用 run-all。</span>
      </article>
    `;
    return;
  }

  const completedStages = PIPELINE_STAGES.filter((stage) => getCompletedStageKeys(run).has(stage.stageKey));
  stageTimelineEl.innerHTML = completedStages.length
    ? completedStages
        .map((stage) => {
          const stageMeta = run.stages?.[stage.stageKey];
          return `
            <article class="timeline-entry">
              <div class="timeline-bullet"></div>
              <div class="timeline-copy">
                <strong>${escapeHtml(stage.shortLabel)}</strong>
                <span>${escapeHtml(formatDate(stageMeta?.completed_at || run.updated_at))}</span>
                <em>${escapeHtml(getStageStatsPreview(run, stage.stageKey) || stage.actionHint)}</em>
              </div>
            </article>
          `;
        })
        .join("")
    : '<div class="empty-state">当前 run 还没有完成任何阶段。</div>';

  const nextStage = getNextStage(run);
  runChecklistEl.innerHTML = [
    {
      title: "推荐动作",
      body: nextStage?.command === "generate"
        ? "这是一条尚未启动的空 run。generate 已在“任务定义”页提供，通常应删除这条空 run 后重新新建。"
        : nextStage
        ? `继续执行 ${nextStage.command}，避免 run 停留在 ${run.last_stage || "created"}。`
        : "这条 run 已完成全部阶段，建议转去产物页做评测结论确认。",
    },
    {
      title: "优先查看",
      body:
        !run.last_stage
          ? "当前 run 还没有进入任何阶段；如果这是误创建的空 run，直接删除并到“任务定义”页重新新建。"
          : run.last_stage === "generate"
          ? "先看 raw_candidates，确认场景覆盖和 user_text 质量，但别把 label_hint 当成正式标签。"
          : run.last_stage === "classify"
            ? "先看 teacher_labeled，确认 parse_fail 是否可接受，并核对 teacher_label 是否符合真实分类边界。"
            : run.last_stage === "filter-export"
              ? "先看 rejected_samples 和 filtered_train，确认过滤策略是否过严。"
              : run.last_stage === "review-export"
                ? "review_candidates 已准备好，下一步应补齐 review_results。"
                : run.last_stage === "eval"
                  ? "优先看 eval_result、eval_summary、confusion_analysis 与 eval_predictions。"
                  : "根据当前阶段选择最相关的 artifact 查看细节。",
    },
    {
      title: "评测快照",
      body: run.evaluation
        ? `samples=${run.evaluation.sample_count}，accuracy=${run.evaluation.overall_accuracy}，macro_f1=${run.evaluation.macro_f1}，promptfoo=${run.evaluation.promptfoo_status || "unknown"}。`
        : "当前 run 还没有结构化 eval 摘要；完成 eval 后这里会直接显示关键指标。",
    },
    {
      title: "风险提示",
      body:
        nextStage?.command === "validate-review" || nextStage?.command === "build-gold"
          ? "当前已进入人工复核门槛，缺失或不完整的 review_results 会阻断后续阶段。"
          : nextStage?.command === "eval"
            ? "gold 样本量过小会让评测结果失真，先确认 gold_eval 内容。"
            : "如果修改了 task 配置，这些变更只会影响后续新 run，不会回写已有产物。",
    },
  ]
    .map(
      (item) => `
        <article class="operator-note-card">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.body)}</span>
        </article>
      `
    )
    .join("");
}

function renderKeyGrid(target, items) {
  target.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="task-spec-key">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(formatArtifactValue(value))}</span>
        </div>
      `
    )
    .join("");
}

function renderPromptSwitch() {
  promptViewSwitchEl.querySelectorAll("[data-prompt-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.promptView === state.promptView);
  });
}

function renderWorkbenchTabs() {
  workbenchTabButtons.forEach((button) => {
    const active = button.dataset.workbenchTab === state.activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  workbenchPanels.forEach((panel) => {
    panel.hidden = panel.dataset.workbenchPanel !== state.activeTab;
  });
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  renderWorkbenchTabs();
  renderSummary();
}

function renderTaskSpecMode() {
  const hasTask = !!state.taskSpec;
  const editing = hasTask && state.isEditingTaskConfig;

  taskSpecReadViewEl.hidden = editing;
  taskSpecEditViewEl.hidden = !hasTask || !editing;
  promptViewSwitchEl.hidden = !hasTask || editing;
  editTaskConfigButton.hidden = !hasTask || editing;
  resetTaskConfigButton.hidden = !editing;
  saveTaskConfigButton.hidden = !editing;
  reloadTaskConfigButton.hidden = !hasTask;
  reloadTaskConfigButton.textContent = editing ? "从磁盘重载" : "重载配置";

  if (!hasTask) {
    taskConfigAdviceEl.textContent = "选择 task 后显示任务定义与配置入口。";
    return;
  }

  taskConfigAdviceEl.textContent = editing
    ? "你正在编辑真实配置文件。保存后只影响后续新 run，不会回写已有运行产物。"
    : "当前为只读任务定义。点击“编辑配置”后进入独立编辑页面。";
}

function renderConfigStatusActions() {
  const disabled = !state.taskConfig || state.configSaving;
  renderTaskSpecMode();
  reloadTaskConfigButton.disabled = !state.selectedTask || state.configSaving;
  editTaskConfigButton.disabled = disabled;
  resetTaskConfigButton.disabled = disabled;
  saveTaskConfigButton.disabled = disabled || !state.configDirty;
  addScenarioButton.disabled = disabled || !state.isEditingTaskConfig;
}

function renderConfigSummary() {
  if (!state.taskConfig) {
    taskConfigSummaryEl.innerHTML = "";
    taskConfigImpactEl.innerHTML = "";
    return;
  }

  renderKeyGrid(taskConfigSummaryEl, [
    ["estimated_samples", totalEstimatedSamples(state.taskConfig.scenarios || [])],
    ["labels", (state.taskConfig.labels || []).length],
    ["scenarios", (state.taskConfig.scenarios || []).length],
    ["generator_provider", state.taskConfig.runtime?.generator?.provider || "-"],
    ["teacher_provider", state.taskConfig.runtime?.teacher?.provider || "-"],
  ]);
  renderKeyGrid(taskConfigImpactEl, [
    ["generate", "受 scenario matrix 和 generator prompt 影响"],
    ["classify", "受 labels、teacher prompt、teacher runtime 影响"],
    ["filter-export", "受 rules 和 labels 影响"],
    ["eval", "受 labels、eval runtime 与 gold 构建结果影响"],
  ]);
}

function renderTaskMetaForm() {
  if (!state.taskConfig) {
    taskMetaFormEl.innerHTML = "";
    return;
  }
  const task = state.taskConfig.task || {};
  const fields = [
    ["name", "Task Name", task.name],
    ["theme", "Theme", task.theme],
    ["language", "Language", task.language],
    ["task_type", "Task Type", task.task_type],
    ["entry_schema", "Entry Schema", task.entry_schema],
  ];
  taskMetaFormEl.innerHTML = fields
    .map(
      ([field, label, value]) => `
        <label class="config-field">
          <span>${escapeHtml(label)}</span>
          <input data-config-section="task" data-config-key="${escapeHtml(field)}" type="text" value="${escapeHtml(
            configInputValue(value)
          )}" />
        </label>
      `
    )
    .join("");
}

function renderPrimitiveEditor(target, sectionName, payload) {
  target.innerHTML = Object.entries(payload || {})
    .map(
      ([key, value]) => `
        <label class="config-field">
          <span>${escapeHtml(`${sectionName}.${key}`)}</span>
          <input data-config-section="${escapeHtml(sectionName)}" data-config-key="${escapeHtml(key)}" type="text" value="${escapeHtml(
            configInputValue(value)
          )}" />
        </label>
      `
    )
    .join("");
}

function renderTaskRuntimeEditor() {
  if (!state.taskConfig) {
    taskRuntimeEditorEl.innerHTML = "";
    return;
  }
  taskRuntimeEditorEl.innerHTML = Object.entries(state.taskConfig.runtime || {})
    .map(
      ([stage, config]) => `
        <article class="config-runtime-card">
          <h4>${escapeHtml(stage)}</h4>
          <div class="config-form-grid">
            ${Object.entries(config || {})
              .map(
                ([key, value]) => `
                  <label class="config-field">
                    <span>${escapeHtml(key)}</span>
                    <input
                      data-runtime-stage="${escapeHtml(stage)}"
                      data-runtime-key="${escapeHtml(key)}"
                      type="text"
                      value="${escapeHtml(configInputValue(value))}"
                    />
                  </label>
                `
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");
}

function renderTaskLabelsEditor() {
  if (!state.taskConfig) {
    taskLabelsEditorEl.innerHTML = "";
    return;
  }
  const labels = state.taskConfig.labels || [];
  taskLabelsEditorEl.innerHTML = `
    <div class="config-chip-list">
      ${labels
        .map(
          (label, index) => `
            <span class="config-chip">
              ${escapeHtml(label)}
              <button class="config-chip-remove" data-label-index="${index}" type="button">移除</button>
            </span>
          `
        )
        .join("")}
    </div>
    <div class="config-inline-input">
      <input id="newLabelInput" type="text" placeholder="新增 label，例如 summarize_report" />
      <button class="ghost-button" id="addLabelButton" type="button">添加 Label</button>
    </div>
  `;
}

function renderTaskScenarioSummary() {
  if (!state.taskConfig) {
    taskScenarioSummaryEl.innerHTML = "";
    return;
  }
  taskScenarioSummaryEl.innerHTML = buildSummaryChips([
    ["scenarios", String((state.taskConfig.scenarios || []).length)],
    ["estimated_samples", String(totalEstimatedSamples(state.taskConfig.scenarios || []))],
    [
      "high_risk",
      String((state.taskConfig.scenarios || []).filter((scenario) => scenario.difficulty === "hard").length),
    ],
  ]);
}

function renderTaskScenarioEditor() {
  if (!state.taskConfig) {
    taskScenarioEditorEl.innerHTML = "";
    return;
  }
  taskScenarioEditorEl.innerHTML = (state.taskConfig.scenarios || [])
    .map((scenario, index) => {
      const templates = (scenario.templates || []).join("\n");
      const tags = (scenario.tags || []).join(", ");
      return `
        <article class="config-scenario-card" data-scenario-index="${index}">
          <div class="config-section-head">
            <div>
              <h4>${escapeHtml(`Scenario ${index + 1}`)}</h4>
              <p>预计生成 ${escapeHtml(String(estimateScenarioSamples(scenario)))} 条样本</p>
            </div>
            <button class="ghost-button" data-remove-scenario="${index}" type="button">删除</button>
          </div>
          <div class="config-form-grid">
            <label class="config-field">
              <span>intent</span>
              <input data-scenario-field="intent" data-scenario-index="${index}" type="text" value="${escapeHtml(
                configInputValue(scenario.intent)
              )}" />
            </label>
            <label class="config-field">
              <span>difficulty</span>
              <input data-scenario-field="difficulty" data-scenario-index="${index}" type="text" value="${escapeHtml(
                configInputValue(scenario.difficulty)
              )}" />
            </label>
            <label class="config-field">
              <span>generation_count</span>
              <input data-scenario-field="generation_count" data-scenario-index="${index}" type="number" min="1" placeholder="留空则使用 templates 条数" value="${escapeHtml(
                configInputValue(scenario.generation_count)
              )}" />
            </label>
            <label class="config-field">
              <span>tags</span>
              <input data-scenario-field="tags" data-scenario-index="${index}" type="text" placeholder="逗号分隔" value="${escapeHtml(
                configInputValue(tags)
              )}" />
            </label>
            <label class="config-field">
              <span>dialogue_stage</span>
              <input data-scenario-context="dialogue_stage" data-scenario-index="${index}" type="text" value="${escapeHtml(
                configInputValue(scenario.context?.dialogue_stage)
              )}" />
            </label>
            <label class="config-field">
              <span>language</span>
              <input data-scenario-context="language" data-scenario-index="${index}" type="text" value="${escapeHtml(
                configInputValue(scenario.context?.language)
              )}" />
            </label>
            <label class="config-field config-field-toggle">
              <span>has_visible_report</span>
              <select data-scenario-context="has_visible_report" data-scenario-index="${index}">
                <option value="true" ${scenario.context?.has_visible_report ? "selected" : ""}>true</option>
                <option value="false" ${scenario.context?.has_visible_report ? "" : "selected"}>false</option>
              </select>
            </label>
            <label class="config-field config-field-full">
              <span>previous_report_summary</span>
              <textarea data-scenario-context="previous_report_summary" data-scenario-index="${index}" rows="2">${escapeHtml(
                configInputValue(scenario.context?.previous_report_summary)
              )}</textarea>
            </label>
            <label class="config-field config-field-full">
              <span>templates</span>
              <textarea data-scenario-field="templates" data-scenario-index="${index}" rows="4" placeholder="每行一条模板">${escapeHtml(
                templates
              )}</textarea>
            </label>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTaskPromptEditor() {
  if (!state.taskConfig) {
    taskPromptEditorEl.innerHTML = "";
    return;
  }
  taskPromptEditorEl.innerHTML = `
    <label class="config-field config-field-full">
      <span>Generator Prompt</span>
      <textarea data-prompt-field="generator_prompt" rows="10">${escapeHtml(
        state.taskConfig.generator_prompt || ""
      )}</textarea>
    </label>
    <label class="config-field config-field-full">
      <span>Teacher Prompt</span>
      <textarea data-prompt-field="teacher_prompt" rows="10">${escapeHtml(
        state.taskConfig.teacher_prompt || ""
      )}</textarea>
    </label>
  `;
}

function buildTaskSpecView() {
  if (!state.taskSpec) {
    return null;
  }
  if (!state.taskConfig) {
    return state.taskSpec;
  }
  return {
    ...state.taskSpec,
    ...state.taskConfig.task,
    runtime: state.taskConfig.runtime,
    rules: state.taskConfig.rules,
    exports: state.taskConfig.exports,
    labels: state.taskConfig.labels,
    scenarios: state.taskConfig.scenarios,
    generator_prompt: state.taskConfig.generator_prompt,
    teacher_prompt: state.taskConfig.teacher_prompt,
  };
}

function renderTaskSpecReadOnly(view) {
  const runCount = state.selectedTask?.run_count || 0;
  const estimatedSamples = totalEstimatedSamples(state.taskConfig?.scenarios || view.scenarios || []);
  taskDossierHeroEl.innerHTML = `
    <div class="task-dossier-ribbon">Task Dossier</div>
    <div class="task-dossier-grid">
      <div>
        <p class="task-dossier-eyebrow">${escapeHtml(view.task_type || "task")}</p>
        <h3 class="task-dossier-title">${escapeHtml(view.name)}</h3>
        <p class="task-dossier-copy">
          这页只负责定义任务边界、样本空间与运行规范。run 是执行实例，不在这里混入状态推进。
        </p>
      </div>
      <div class="task-dossier-matrix">
        <span><strong>theme</strong>${escapeHtml(view.theme || "-")}</span>
        <span><strong>language</strong>${escapeHtml(view.language || "-")}</span>
        <span><strong>labels</strong>${escapeHtml(String((view.labels || []).length))}</span>
        <span><strong>runs</strong>${escapeHtml(String(runCount))}</span>
      </div>
    </div>
    <div class="task-dossier-foot">
      <span>${escapeHtml(runCount ? `${runCount} 条运行记录可追溯` : "还没有 run，适合先校对定义后启动首轮")}</span>
      <span>${escapeHtml(`estimated samples: ${estimatedSamples}`)}</span>
    </div>
  `;

  renderKeyGrid(taskSpecOverviewEl, [
    ["name", view.name],
    ["theme", view.theme],
    ["language", view.language],
    ["task_type", view.task_type],
    ["entry_schema", view.entry_schema],
  ]);

  taskSpecLabelsEl.innerHTML = (view.labels || [])
    .map((label) => `<span class="task-spec-chip">${escapeHtml(label)}</span>`)
    .join("");
  renderKeyGrid(taskSpecRulesEl, Object.entries(view.rules || {}));
  renderKeyGrid(taskSpecExportsEl, Object.entries(view.exports || {}));

  taskRuntimeGridEl.innerHTML = Object.entries(view.runtime || {})
    .map(
      ([stage, config]) => `
        <article class="task-runtime-card">
          <h3>${escapeHtml(stage)}</h3>
          <div class="task-runtime-meta">
            ${Object.entries(config || {})
              .map(
                ([key, value]) =>
                  `<span><strong>${escapeHtml(key)}</strong>: ${escapeHtml(formatArtifactValue(value))}</span>`
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");

  taskScenarioGridEl.innerHTML = (view.scenarios || [])
    .map(
      (scenario, index) => `
        <article class="task-scenario-card">
          <h3>${escapeHtml(`${index + 1}. ${scenario.intent}`)}</h3>
          <div class="task-spec-chip-group">
            <span class="task-spec-chip">${escapeHtml(scenario.difficulty || "-")}</span>
            ${(scenario.tags || []).map((tag) => `<span class="task-spec-chip">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <p>${escapeHtml((scenario.templates || []).join(" / "))}</p>
          <div class="task-spec-key-grid">
            <div class="task-spec-key">
              <strong>has_visible_report</strong>
              <span>${escapeHtml(formatArtifactValue(scenario.context?.has_visible_report))}</span>
            </div>
            <div class="task-spec-key">
              <strong>dialogue_stage</strong>
              <span>${escapeHtml(formatArtifactValue(scenario.context?.dialogue_stage))}</span>
            </div>
            <div class="task-spec-key">
              <strong>previous_report_summary</strong>
              <span>${escapeHtml(formatArtifactValue(scenario.context?.previous_report_summary))}</span>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  const promptText = state.promptView === "generator" ? view.generator_prompt : view.teacher_prompt;
  const runtimeConfig = state.promptView === "generator" ? view.runtime?.generator : view.runtime?.teacher;
  taskPromptMetaEl.innerHTML = buildSummaryChips([
    ["view", `${state.promptView}_prompt`],
    ["provider", runtimeConfig?.provider || "-"],
    ["model", runtimeConfig?.model || "-"],
  ]);
  taskPromptPreviewEl.textContent = promptText || "暂无 prompt";
}

function renderTaskSpec() {
  if (!state.taskSpec) {
    taskDossierHeroEl.innerHTML = '<div class="empty-state">选择 task 后显示任务卷宗。</div>';
    taskSpecOverviewEl.innerHTML = '<div class="empty-state">选择 task 后显示任务定义。</div>';
    taskSpecLabelsEl.innerHTML = "";
    taskSpecRulesEl.innerHTML = "";
    taskSpecExportsEl.innerHTML = "";
    taskRuntimeGridEl.innerHTML = "";
    taskScenarioGridEl.innerHTML = '<div class="empty-state">暂无 scenario。</div>';
    taskPromptMetaEl.innerHTML = "";
    taskPromptPreviewEl.textContent = "选择 task 后显示 prompt";
    taskConfigSummaryEl.innerHTML = "";
    taskConfigImpactEl.innerHTML = "";
    taskMetaFormEl.innerHTML = "";
    taskRuntimeEditorEl.innerHTML = "";
    taskRulesEditorEl.innerHTML = "";
    taskExportsEditorEl.innerHTML = "";
    taskLabelsEditorEl.innerHTML = "";
    taskScenarioSummaryEl.innerHTML = "";
    taskScenarioEditorEl.innerHTML = "";
    taskPromptEditorEl.innerHTML = "";
    setConfigStatus("选择 task 后显示可编辑配置");
    renderConfigStatusActions();
    renderPromptSwitch();
    return;
  }
  renderTaskSpecReadOnly(buildTaskSpecView());
  renderConfigSummary();
  renderTaskMetaForm();
  renderTaskRuntimeEditor();
  renderPrimitiveEditor(taskRulesEditorEl, "rules", state.taskConfig?.rules || {});
  renderPrimitiveEditor(taskExportsEditorEl, "exports", state.taskConfig?.exports || {});
  renderTaskLabelsEditor();
  renderTaskScenarioSummary();
  renderTaskScenarioEditor();
  renderTaskPromptEditor();
  renderConfigStatusActions();
  renderPromptSwitch();
}

function renderArtifactSummary(payload, records) {
  if (!payload) {
    artifactSummaryBarEl.innerHTML = "";
    return;
  }

  const total = Array.isArray(payload.content) ? payload.content.length : null;
  const visible = Array.isArray(payload.content) ? records.length : null;
  const summary = [["visible", visible], ["total", total]];

  if (payload.key === "teacher_labeled") {
    const parseFailures = records.filter((record) => record.annotation?.parse_ok === false).length;
    summary.push(["parse_fail", parseFailures]);
  }
  if (payload.key === "review_candidates" || payload.key === "review_results") {
    summary.push(["accepted", records.filter((record) => record.review_decision === "accepted").length]);
    summary.push(["corrected", records.filter((record) => record.review_decision === "corrected").length]);
    summary.push(["rejected", records.filter((record) => record.review_decision === "rejected").length]);
  }
  if (payload.key === "eval_predictions") {
    const mismatches = records.filter((record) => record.expected_label !== record.predicted_label).length;
    const parseFailures = records.filter((record) => record.parse_ok === false).length;
    summary.push(["mismatch", mismatches]);
    summary.push(["parse_fail", parseFailures]);
  }
  if (payload.key === "eval_result") {
    const metrics = payload.content?.metrics || {};
    const quality = payload.content?.quality || {};
    const promptfoo = payload.content?.promptfoo?.summary || {};
    summary.push(["accuracy", metrics.overall_accuracy]);
    summary.push(["macro_f1", metrics.macro_f1]);
    summary.push(["parse_fail", quality.parse_failure_count]);
    if (promptfoo.pass_rate != null) {
      summary.push(["promptfoo_pass", promptfoo.pass_rate]);
    }
  }
  if (payload.key === "gold_eval") {
    const hardCases = records.filter(
      (record) =>
        record.metadata?.difficulty === "hard" || (record.metadata?.tags || []).includes("ambiguous")
    ).length;
    summary.push(["hard", hardCases]);
  }
  if (payload.key === "rejected_samples") {
    const reasonCounts = new Map();
    for (const record of records) {
      const reason = record.rejection_reason || "unknown";
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    Array.from(reasonCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .forEach(([reason, count]) => {
        summary.push([getRejectionReasonLabel(reason), count]);
      });
  }

  artifactSummaryBarEl.innerHTML = buildSummaryChips(summary);
}

function renderArtifactExplanation(payload) {
  if (!payload) {
    artifactExplainerEl.innerHTML =
      '<div class="empty-state">选择左侧产物后显示该文件在流程中的作用、用途和阅读建议。</div>';
    return;
  }

  const explanation = ARTIFACT_EXPLANATIONS[payload.key] || {
    stage: payload.category || "-",
    role: "该文件是当前 run 的中间产物或报告文件。",
    usage: "用于理解当前阶段的输出结果。",
    readingHint: "结合文件内容和顶部摘要一起阅读。",
  };

  artifactExplainerEl.innerHTML = `
    <article class="artifact-explainer-card">
      <div class="artifact-record-header">
        <div>
          <h3>${escapeHtml(payload.key)}</h3>
          <p>${escapeHtml(explanation.role)}</p>
        </div>
        <span class="artifact-chip">${escapeHtml(explanation.stage)}</span>
      </div>
      <div class="artifact-explainer-grid">
        <div class="artifact-detail-block">
          <strong>作用</strong>
          <span>${escapeHtml(explanation.role)}</span>
        </div>
        <div class="artifact-detail-block">
          <strong>典型用途</strong>
          <span>${escapeHtml(explanation.usage)}</span>
        </div>
        <div class="artifact-detail-block artifact-detail-block-wide">
          <strong>阅读建议</strong>
          <span>${escapeHtml(explanation.readingHint)}</span>
        </div>
      </div>
    </article>
  `;
}

function getArtifactFilterOptions(payload) {
  const key = payload?.key;
  if (key === "raw_candidates") {
    const records = Array.isArray(payload?.content) ? payload.content : [];
    const labelHints = Array.from(
      new Set(records.map((record) => record.metadata?.label_hint).filter(Boolean))
    ).sort();
    return [
      { value: "all", label: "全部" },
      { value: "with_report", label: "仅有报告" },
      { value: "without_report", label: "仅无报告" },
      ...labelHints.map((label) => ({ value: `label:${label}`, label: `label: ${label}` })),
    ];
  }
  if (key === "teacher_labeled") {
    return [
      { value: "all", label: "全部" },
      { value: "parse_failures", label: "仅解析失败" },
      { value: "parse_ok", label: "仅解析成功" },
    ];
  }
  if (key === "review_candidates" || key === "review_results") {
    return [
      { value: "all", label: "全部" },
      { value: "pending", label: "仅 pending" },
      { value: "accepted", label: "仅 accepted" },
      { value: "corrected", label: "仅 corrected" },
      { value: "rejected", label: "仅 rejected" },
    ];
  }
  if (key === "eval_predictions") {
    return [
      { value: "all", label: "全部" },
      { value: "mismatch", label: "仅预测错误" },
      { value: "parse_failures", label: "仅解析失败" },
    ];
  }
  if (key === "gold_eval") {
    return [
      { value: "all", label: "全部" },
      { value: "hard", label: "仅 hard" },
    ];
  }
  if (key === "rejected_samples") {
    const records = Array.isArray(payload?.content) ? payload.content : [];
    const reasons = Array.from(new Set(records.map((record) => record.rejection_reason).filter(Boolean))).sort();
    return [
      { value: "all", label: "全部" },
      ...reasons.map((reason) => ({ value: `reason:${reason}`, label: getRejectionReasonLabel(reason) })),
    ];
  }
  return [{ value: "all", label: "全部" }];
}

function recordPassesFilter(record, payload) {
  const filter = state.artifactFilter;
  if (!filter || filter === "all") {
    return true;
  }
  const key = payload.key;
  if (key === "raw_candidates") {
    if (filter === "with_report") {
      return record.context?.has_visible_report === true;
    }
    if (filter === "without_report") {
      return record.context?.has_visible_report === false;
    }
    if (filter.startsWith("label:")) {
      return record.metadata?.label_hint === filter.slice("label:".length);
    }
  }
  if (key === "teacher_labeled") {
    if (filter === "parse_failures") {
      return record.annotation?.parse_ok === false;
    }
    if (filter === "parse_ok") {
      return record.annotation?.parse_ok === true;
    }
  }
  if (key === "review_candidates" || key === "review_results") {
    return record.review_decision === filter;
  }
  if (key === "eval_predictions") {
    if (filter === "mismatch") {
      return record.expected_label !== record.predicted_label;
    }
    if (filter === "parse_failures") {
      return record.parse_ok === false;
    }
  }
  if (key === "gold_eval" && filter === "hard") {
    return record.metadata?.difficulty === "hard" || (record.metadata?.tags || []).includes("ambiguous");
  }
  if (key === "rejected_samples" && filter.startsWith("reason:")) {
    return record.rejection_reason === filter.slice("reason:".length);
  }
  return true;
}

function getFilteredArtifactRecords(payload) {
  const records = Array.isArray(payload?.content) ? payload.content : [];
  const query = state.artifactSearch.trim().toLowerCase();
  return records.filter((record) => {
    if (!recordPassesFilter(record, payload)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return getRecordSearchText(record).includes(query);
  });
}

function renderArtifactFilterOptions(payload) {
  const options = getArtifactFilterOptions(payload);
  if (!options.some((item) => item.value === state.artifactFilter)) {
    state.artifactFilter = "all";
  }
  artifactFilterSelectEl.innerHTML = options
    .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
    .join("");
  artifactFilterSelectEl.value = state.artifactFilter;
}

function renderRawCandidateControls(payload) {
  const enabled = payload?.key === "raw_candidates" && state.artifactViewMode === "structured";
  const categoryMode = enabled && state.rawCandidateViewMode === "category";
  rawCandidateViewSwitchEl.hidden = !enabled;
  rawCandidateGroupByFieldEl.hidden = !categoryMode;
  if (!enabled) {
    return;
  }
  rawCandidateViewSwitchEl.querySelectorAll("[data-raw-candidate-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.rawCandidateView === state.rawCandidateViewMode);
  });
  rawCandidateGroupBySelectEl.value = state.rawCandidateGroupBy;
}

function renderArtifactViewSwitch() {
  artifactViewSwitchEl.querySelectorAll("[data-artifact-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.artifactView === state.artifactViewMode);
  });
  const rawMode = state.artifactViewMode === "raw";
  artifactPreviewEl.hidden = !rawMode;
  artifactStructuredViewEl.hidden = rawMode;
  renderRawCandidateControls(state.artifactPayload);
}

function getVisibleArtifacts(run) {
  return (run?.artifacts || []).filter(
    (artifact) => artifact.exists && !artifact.key.endsWith("_manifest")
  );
}

function getArtifactCategoryInfo(category) {
  return ARTIFACT_CATEGORY_META[category] || {
    label: category || "Artifacts",
    description: "当前阶段产物。",
  };
}

function getRecommendedArtifactKeys(run) {
  if (!run?.last_stage) {
    return ["raw_candidates"];
  }
  return RECOMMENDED_ARTIFACTS_BY_STAGE[run.last_stage] || [];
}

function shortenText(value, limit = 72) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function getArtifactListHint(artifact) {
  const explanation = ARTIFACT_EXPLANATIONS[artifact.key];
  if (!explanation) {
    return shortenText(artifact.relative_path, 54);
  }
  return shortenText(explanation.readingHint || explanation.usage || explanation.role, 72);
}

function groupArtifactsByCategory(artifacts) {
  const groups = new Map();
  for (const artifact of artifacts) {
    const category = artifact.category || "other";
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(artifact);
  }
  const order = ["raw", "processed", "gold", "exports", "reports", "other"];
  return Array.from(groups.entries()).sort((left, right) => order.indexOf(left[0]) - order.indexOf(right[0]));
}

function buildDetailBlocks(items) {
  const visibleItems = items.filter(([, value]) => value != null && value !== "");
  if (!visibleItems.length) {
    return "";
  }
  return `
    <div class="artifact-detail-grid">
      ${visibleItems
        .map(
          ([label, value]) => `
            <div class="artifact-detail-block">
              <strong>${escapeHtml(label)}</strong>
              <span>${escapeHtml(formatArtifactValue(value))}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function summarizeEvalPredictions(records) {
  const confusion = new Map();
  for (const record of records) {
    const expected = record.expected_label || "-";
    const predicted = record.predicted_label || "-";
    const key = `${expected}→${predicted}`;
    confusion.set(key, (confusion.get(key) || 0) + 1);
  }
  return Array.from(confusion.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

function getRawCandidateUserText(record) {
  return record.user_text || record.input?.user_text || "-";
}

function getRawCandidateGroupValue(record, groupBy) {
  if (groupBy === "difficulty") {
    return record.metadata?.difficulty || "unknown";
  }
  if (groupBy === "has_visible_report") {
    return record.context?.has_visible_report ? "has_report" : "no_report";
  }
  if (groupBy === "dialogue_stage") {
    return record.context?.dialogue_stage || "unknown";
  }
  return record.metadata?.label_hint || "unknown";
}

function renderRawCandidatesStructured(payload) {
  const records = getFilteredArtifactRecords(payload);
  renderArtifactSummary(payload, records);
  if (!records.length) {
    artifactStructuredViewEl.innerHTML = '<div class="empty-state">没有匹配当前搜索或筛选条件的记录。</div>';
    return;
  }

  if (state.rawCandidateViewMode === "category") {
    const grouped = new Map();
    for (const record of records) {
      const key = getRawCandidateGroupValue(record, state.rawCandidateGroupBy);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(record);
    }
    const groups = Array.from(grouped.entries()).sort((left, right) => right[1].length - left[1].length);
    artifactStructuredViewEl.innerHTML = `
      <div class="artifact-diagnostic-panel">
        <div class="artifact-summary-grid">
          ${groups
            .map(
              ([group, items]) => `
                <article class="artifact-summary-card">
                  <h3>${escapeHtml(group)}</h3>
                  <strong>${escapeHtml(items.length)}</strong>
                  <span>${escapeHtml(state.rawCandidateGroupBy)}</span>
                </article>
              `
            )
            .join("")}
        </div>
        <div class="artifact-category-grid">
          ${groups
            .map(
              ([group, items]) => `
                <article class="artifact-category-card">
                  <div class="artifact-record-header">
                    <h3>${escapeHtml(group)}</h3>
                    <span class="artifact-chip">${escapeHtml(`${items.length} 条`)}</span>
                  </div>
                  <div class="artifact-table-wrap">
                    <table class="artifact-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>User Text</th>
                          <th>difficulty</th>
                          <th>has_report</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${items
                          .map(
                            (record) => `
                              <tr>
                                <td><code>${escapeHtml(record.id || "-")}</code></td>
                                <td><code>${escapeHtml(getRawCandidateUserText(record))}</code></td>
                                <td>${escapeHtml(record.metadata?.difficulty || "-")}</td>
                                <td>${escapeHtml(record.context?.has_visible_report ? "true" : "false")}</td>
                              </tr>
                            `
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    `;
    return;
  }

  artifactStructuredViewEl.innerHTML = `
    <div class="artifact-diagnostic-panel">
      <div class="artifact-table-wrap">
        <h3>Raw Candidate Rows</h3>
        <table class="artifact-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>User Text</th>
              <th>label_hint</th>
              <th>difficulty</th>
              <th>has_report</th>
              <th>dialogue_stage</th>
              <th>tags</th>
            </tr>
          </thead>
          <tbody>
            ${records
              .map(
                (record) => `
                  <tr>
                    <td><code>${escapeHtml(record.id || "-")}</code></td>
                    <td><code>${escapeHtml(getRawCandidateUserText(record))}</code></td>
                    <td>${escapeHtml(record.metadata?.label_hint || "-")}</td>
                    <td>${escapeHtml(record.metadata?.difficulty || "-")}</td>
                    <td>${escapeHtml(record.context?.has_visible_report ? "true" : "false")}</td>
                    <td>${escapeHtml(record.context?.dialogue_stage || "-")}</td>
                    <td>${escapeHtml((record.metadata?.tags || []).join(", ") || "-")}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRejectedSamplesStructured(payload) {
  const records = getFilteredArtifactRecords(payload);
  renderArtifactSummary(payload, records);
  if (!records.length) {
    artifactStructuredViewEl.innerHTML = '<div class="empty-state">没有匹配当前搜索或筛选条件的记录。</div>';
    return;
  }

  const grouped = new Map();
  for (const record of records) {
    const reason = record.rejection_reason || "unknown";
    if (!grouped.has(reason)) {
      grouped.set(reason, []);
    }
    grouped.get(reason).push(record);
  }
  const groups = Array.from(grouped.entries()).sort((left, right) => right[1].length - left[1].length);

  artifactStructuredViewEl.innerHTML = `
    <div class="artifact-diagnostic-panel">
      <div class="artifact-summary-grid">
        ${groups
          .map(
            ([reason, items]) => `
              <article class="artifact-summary-card">
                <h3>${escapeHtml(getRejectionReasonLabel(reason))}</h3>
                <strong>${escapeHtml(items.length)}</strong>
                <span>rejection_reason</span>
              </article>
            `
          )
          .join("")}
      </div>
      <div class="artifact-table-wrap">
        <h3>Rejected Rows</h3>
        <table class="artifact-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>User Text</th>
              <th>Reason</th>
              <th>teacher_label</th>
              <th>parse</th>
              <th>has_report</th>
            </tr>
          </thead>
          <tbody>
            ${records
              .map(
                (record) => `
                  <tr class="is-alert">
                    <td><code>${escapeHtml(record.id || "-")}</code></td>
                    <td><code>${escapeHtml(record.user_text || record.input?.user_text || "-")}</code></td>
                    <td>${escapeHtml(getRejectionReasonLabel(record.rejection_reason))}</td>
                    <td>${escapeHtml(record.annotation?.teacher_label || "-")}</td>
                    <td>${escapeHtml(record.annotation?.parse_ok ? "ok" : "fail")}</td>
                    <td>${escapeHtml(record.context?.has_visible_report ? "true" : "false")}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="artifact-card-grid">
        ${records.map((record) => buildArtifactRecordCard(record, payload)).join("")}
      </div>
    </div>
  `;
}

function renderEvalPredictionsStructured(payload) {
  const records = getFilteredArtifactRecords(payload);
  renderArtifactSummary(payload, records);
  if (!records.length) {
    artifactStructuredViewEl.innerHTML = '<div class="empty-state">没有匹配当前搜索或筛选条件的记录。</div>';
    return;
  }

  const sorted = [...records].sort((left, right) => {
    const leftBad = left.expected_label !== left.predicted_label || left.parse_ok === false ? 1 : 0;
    const rightBad = right.expected_label !== right.predicted_label || right.parse_ok === false ? 1 : 0;
    return rightBad - leftBad;
  });
  const confusion = summarizeEvalPredictions(sorted);
  const mismatches = sorted.filter((item) => item.expected_label !== item.predicted_label);
  const parseFailures = sorted.filter((item) => item.parse_ok === false);

  artifactStructuredViewEl.innerHTML = `
    <div class="artifact-diagnostic-panel">
      <div class="artifact-confusion-grid">
        <article class="artifact-confusion-card">
          <h3>Confusion Topline</h3>
          <div class="artifact-confusion-list">
            ${confusion
              .map(
                ([pair, count]) => `
                  <div class="artifact-confusion-item">
                    <span>${escapeHtml(pair)}</span>
                    <strong>${escapeHtml(count)}</strong>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
        <article class="artifact-confusion-card">
          <h3>Error Focus</h3>
          <div class="artifact-confusion-list">
            <div class="artifact-confusion-item"><span>mismatch</span><strong>${escapeHtml(mismatches.length)}</strong></div>
            <div class="artifact-confusion-item"><span>parse_fail</span><strong>${escapeHtml(parseFailures.length)}</strong></div>
            <div class="artifact-confusion-item"><span>visible rows</span><strong>${escapeHtml(sorted.length)}</strong></div>
          </div>
        </article>
      </div>
      <div class="artifact-table-wrap">
        <h3>Prediction Rows</h3>
        <table class="artifact-table">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Expected</th>
              <th>Predicted</th>
              <th>Parse</th>
              <th>User Text</th>
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map((record) => {
                const isAlert = record.expected_label !== record.predicted_label || record.parse_ok === false;
                return `
                  <tr class="${isAlert ? "is-alert" : "is-good"}">
                    <td><code>${escapeHtml(record.id || "-")}</code></td>
                    <td>${escapeHtml(record.expected_label || "-")}</td>
                    <td>${escapeHtml(record.predicted_label || "-")}</td>
                    <td>${escapeHtml(record.parse_ok ? "ok" : "fail")}</td>
                    <td><code>${escapeHtml(record.user_text || "-")}</code></td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="artifact-card-grid">
        ${sorted.map((record) => buildArtifactRecordCard(record, payload)).join("")}
      </div>
    </div>
  `;
}

function buildArtifactRecordCard(record, payload) {
  const key = payload.key;
  const title = record.sample_id || record.id || record.run_id || payload.key;
  let summary = record.user_text || record.input?.user_text || record.raw_output || record.review_comment || "";
  const chips = [];
  const metrics = [];
  const details = [];
  let cardClassName = "artifact-record";

  if (key === "raw_candidates") {
    chips.push(record.context?.has_visible_report ? "has report" : "no report");
    chips.push(record.metadata?.difficulty || "-");
    metrics.push(["label_hint", record.metadata?.label_hint]);
    metrics.push(["tags", formatArtifactValue(record.metadata?.tags || [])]);
    details.push(["previous_report_summary", record.context?.previous_report_summary]);
    details.push(["dialogue_stage", record.context?.dialogue_stage]);
  } else if (key === "rejected_samples") {
    chips.push("rejected");
    metrics.push(["rejection_reason", getRejectionReasonLabel(record.rejection_reason)]);
    metrics.push(["teacher_label", record.annotation?.teacher_label]);
    metrics.push(["parse_ok", record.annotation?.parse_ok]);
    details.push(["user_text", record.input?.user_text]);
    details.push(["difficulty", record.metadata?.difficulty]);
    details.push(["has_visible_report", record.context?.has_visible_report]);
    cardClassName += " is-alert";
  } else if (key === "teacher_labeled") {
    const parseOk = record.annotation?.parse_ok;
    chips.push(parseOk ? "parse_ok" : "parse_fail");
    metrics.push(["teacher_label", record.annotation?.teacher_label]);
    metrics.push(["error_code", record.annotation?.error_code]);
    metrics.push(["review_status", record.annotation?.review_status]);
    details.push(["raw_output", record.annotation?.teacher_raw_output]);
    details.push(["difficulty", record.metadata?.difficulty]);
    if (parseOk === false) {
      cardClassName += " is-alert";
    }
  } else if (key === "review_candidates" || key === "review_results") {
    chips.push(record.review_decision || "pending");
    metrics.push(["teacher_label", record.teacher_label]);
    metrics.push(["reviewer_label", record.reviewer_label]);
    metrics.push(["reviewed_by", record.reviewed_by]);
    details.push(["review_comment", record.review_comment]);
    details.push(["reviewed_at", record.reviewed_at]);
  } else if (key === "gold_eval") {
    chips.push(record.annotation?.review_status || "gold");
    metrics.push(["final_label", record.annotation?.final_label]);
    metrics.push(["teacher_label", record.annotation?.teacher_label]);
    metrics.push(["difficulty", record.metadata?.difficulty]);
    details.push(["tags", formatArtifactValue(record.metadata?.tags || [])]);
    details.push(["human_label", record.annotation?.human_label]);
  } else if (key === "eval_predictions") {
    const match = record.expected_label === record.predicted_label;
    chips.push(match ? "matched" : "mismatch");
    chips.push(record.parse_ok ? "parse_ok" : "parse_fail");
    metrics.push(["expected", record.expected_label]);
    metrics.push(["predicted", record.predicted_label]);
    metrics.push(["error_code", record.error_code]);
    details.push(["raw_output", record.raw_output]);
    details.push(["difficulty", record.difficulty]);
    details.push(["tags", formatArtifactValue(record.tags || [])]);
    if (!match || record.parse_ok === false) {
      cardClassName += " is-alert";
    } else {
      cardClassName += " is-good";
    }
  } else {
    metrics.push(...Object.entries(record).slice(0, 4));
  }

  const chipMarkup = chips
    .filter(Boolean)
    .map((chip) => {
      let className = "artifact-chip";
      if (chip === "parse_fail" || chip === "mismatch" || chip === "rejected") {
        className += " is-alert";
      } else if (chip === "parse_ok" || chip === "matched" || chip === "accepted") {
        className += " is-good";
      }
      return `<span class="${className}">${escapeHtml(chip)}</span>`;
    })
    .join("");

  const metricMarkup = metrics
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong>: ${escapeHtml(formatArtifactValue(value))}</span>`)
    .join("");

  return `
    <article class="${cardClassName}">
      <div class="artifact-record-header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
      ${chipMarkup ? `<div class="artifact-chip-row">${chipMarkup}</div>` : ""}
      ${metricMarkup ? `<div class="artifact-card-metrics">${metricMarkup}</div>` : ""}
      ${buildDetailBlocks(details)}
    </article>
  `;
}

function renderArtifactJsonlStructured(payload) {
  if (payload.key === "raw_candidates") {
    renderRawCandidatesStructured(payload);
    return;
  }
  if (payload.key === "rejected_samples") {
    renderRejectedSamplesStructured(payload);
    return;
  }
  if (payload.key === "eval_predictions") {
    renderEvalPredictionsStructured(payload);
    return;
  }
  const records = getFilteredArtifactRecords(payload);
  renderArtifactSummary(payload, records);
  if (!records.length) {
    artifactStructuredViewEl.innerHTML = '<div class="empty-state">没有匹配当前搜索或筛选条件的记录。</div>';
    return;
  }
  artifactStructuredViewEl.innerHTML = `<div class="artifact-card-grid">${records
    .map((record) => buildArtifactRecordCard(record, payload))
    .join("")}</div>`;
}

function renderArtifactJsonStructured(payload) {
  const object = payload.content;
  renderArtifactSummary(payload, []);
  if (object == null) {
    artifactStructuredViewEl.innerHTML = '<div class="empty-state">文件不存在。</div>';
    return;
  }
  if (payload.key === "eval_result") {
    const topConfusions = (object.quality?.top_confusions || [])
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.expected)}</td><td>${escapeHtml(item.predicted)}</td><td>${escapeHtml(
            String(item.count)
          )}</td></tr>`
      )
      .join("");
    const promptfooSummary = object.promptfoo?.summary || {};
    artifactStructuredViewEl.innerHTML = `
      <section class="artifact-object-block">
        <h3>Dataset</h3>
        <div class="artifact-key-grid">
          <div class="artifact-key-value"><div><strong>sample_count</strong><span>${escapeHtml(
            formatArtifactValue(object.dataset?.sample_count)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>hard_case_sample_count</strong><span>${escapeHtml(
            formatArtifactValue(object.dataset?.hard_case_sample_count)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>no_visible_report_sample_count</strong><span>${escapeHtml(
            formatArtifactValue(object.dataset?.no_visible_report_sample_count)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>label_distribution</strong><span>${escapeHtml(
            formatArtifactValue(object.dataset?.label_distribution)
          )}</span></div></div>
        </div>
      </section>
      <section class="artifact-object-block">
        <h3>Metrics</h3>
        <div class="artifact-key-grid">
          <div class="artifact-key-value"><div><strong>overall_accuracy</strong><span>${escapeHtml(
            formatArtifactValue(object.metrics?.overall_accuracy)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>macro_f1</strong><span>${escapeHtml(
            formatArtifactValue(object.metrics?.macro_f1)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>json_valid_rate</strong><span>${escapeHtml(
            formatArtifactValue(object.metrics?.json_valid_rate)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>hard_cases_accuracy</strong><span>${escapeHtml(
            formatArtifactValue(object.metrics?.hard_cases_accuracy)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>has_visible_report_false_accuracy</strong><span>${escapeHtml(
            formatArtifactValue(object.metrics?.has_visible_report_false_accuracy)
          )}</span></div></div>
        </div>
      </section>
      <section class="artifact-object-block">
        <h3>Quality</h3>
        <div class="artifact-key-grid">
          <div class="artifact-key-value"><div><strong>mismatch_count</strong><span>${escapeHtml(
            formatArtifactValue(object.quality?.mismatch_count)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>parse_failure_count</strong><span>${escapeHtml(
            formatArtifactValue(object.quality?.parse_failure_count)
          )}</span></div></div>
        </div>
        ${
          topConfusions
            ? `
              <div class="artifact-table-wrapper">
                <table class="artifact-table">
                  <thead>
                    <tr><th>expected</th><th>predicted</th><th>count</th></tr>
                  </thead>
                  <tbody>${topConfusions}</tbody>
                </table>
              </div>
            `
            : '<div class="empty-state">当前没有非对角混淆样本。</div>'
        }
      </section>
      <section class="artifact-object-block">
        <h3>Promptfoo</h3>
        <div class="artifact-key-grid">
          <div class="artifact-key-value"><div><strong>status</strong><span>${escapeHtml(
            formatArtifactValue(object.promptfoo?.status)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>pass_rate</strong><span>${escapeHtml(
            formatArtifactValue(promptfooSummary.pass_rate)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>total_tests</strong><span>${escapeHtml(
            formatArtifactValue(promptfooSummary.total_tests)
          )}</span></div></div>
          <div class="artifact-key-value"><div><strong>results_path</strong><span>${escapeHtml(
            formatArtifactValue(object.promptfoo?.results_path)
          )}</span></div></div>
        </div>
      </section>
    `;
    return;
  }
  const entries = Object.entries(object);
  artifactStructuredViewEl.innerHTML = `
    <div class="artifact-object-block">
      <h3>${escapeHtml(payload.key)}</h3>
      <div class="artifact-key-grid">
        ${entries
          .map(
            ([label, value]) => `
              <div class="artifact-key-value">
                <div>
                  <strong>${escapeHtml(label)}</strong>
                  <span>${escapeHtml(formatArtifactValue(value))}</span>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderArtifactTextStructured(payload) {
  renderArtifactSummary(payload, []);
  artifactStructuredViewEl.innerHTML = `
    <article class="artifact-text-block">
      <h3>${escapeHtml(payload.key)}</h3>
      <pre>${escapeHtml(payload.content || "文件不存在")}</pre>
    </article>
  `;
}

function renderArtifactStructured(payload) {
  renderRawCandidateControls(payload);
  renderArtifactExplanation(payload);
  if (!payload) {
    artifactSummaryBarEl.innerHTML = "";
    artifactStructuredViewEl.innerHTML = '<div class="empty-state">暂无内容</div>';
    return;
  }
  if (payload.kind === "jsonl") {
    renderArtifactJsonlStructured(payload);
    return;
  }
  if (payload.kind === "json") {
    renderArtifactJsonStructured(payload);
    return;
  }
  renderArtifactTextStructured(payload);
}

function renderTasks() {
  taskCountEl.textContent = String(state.tasks.length);

  if (!state.tasks.length) {
    taskListEl.innerHTML = '<div class="empty-state">没有发现 task。</div>';
    return;
  }

  taskListEl.innerHTML = state.tasks
    .map(
      (task) => `
        <button class="task-item ${task.name === state.selectedTask?.name ? "is-active" : ""}" type="button" data-task="${task.name}">
          <strong>${escapeHtml(task.name)}</strong>
          <span>${escapeHtml(task.theme || "未设置主题")}</span>
          <div class="task-item-meta">
            <span>${escapeHtml(task.task_type || "task")}</span>
            <span>${escapeHtml(task.language || "zh")}</span>
          </div>
          <div class="task-item-foot">
            <span>${escapeHtml(`${task.labels?.length || 0} labels`)}</span>
            <span>${escapeHtml(`${task.run_count || 0} runs`)}</span>
          </div>
        </button>
      `
    )
    .join("");

  taskListEl.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectTask(button.dataset.task);
    });
  });
}

function renderRuns() {
  runCountEl.textContent = String(state.runs.length);

  if (!state.selectedTask) {
    runListEl.innerHTML = '<div class="empty-state">先选择 task。</div>';
    return;
  }

  if (!state.runs.length) {
    runListEl.innerHTML = '<div class="empty-state">当前 task 还没有 run。切到“任务定义”页执行 generate 或 run-all。</div>';
    return;
  }

  runListEl.innerHTML = state.runs
    .map(
      (run) => `
        <article class="run-item-row ${run.run_id === state.selectedRunId ? "is-active" : ""}">
          <button class="run-item ${run.run_id === state.selectedRunId ? "is-active" : ""}" type="button" data-run="${run.run_id}">
            <strong>${escapeHtml(run.run_id)}</strong>
            <span>${escapeHtml(getProgressText(run))}</span>
            <div class="run-item-meta">
              <span>${escapeHtml(run.status || "created")}</span>
              <span>${escapeHtml(run.last_stage || "no stage")}</span>
            </div>
            <div class="run-item-foot">
              <span>${escapeHtml(formatDate(run.updated_at))}</span>
            </div>
          </button>
          <button
            class="run-delete-button"
            type="button"
            data-delete-run="${run.run_id}"
            ${state.deletingRunId || state.loadingCommand ? "disabled" : ""}
          >
            删除
          </button>
        </article>
      `
    )
    .join("");

  runListEl.querySelectorAll("[data-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectRun(button.dataset.run);
    });
  });
  runListEl.querySelectorAll("[data-delete-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteRun(button.dataset.deleteRun);
    });
  });
}

function renderSummary() {
  const taskScopedView = state.activeTab === "task-spec";
  if (!state.selectedTask) {
    workspaceTitleEl.textContent = "选择 task";
    workspaceSubtitleEl.textContent = "左侧选择一个 task，工作台会自动加载运行历史、关键产物与人工复核入口。";
    taskNameValueEl.textContent = "-";
    runIdValueEl.textContent = "-";
    runStatusValueEl.textContent = "-";
    lastStageValueEl.textContent = "-";
    createdAtValueEl.textContent = "-";
    updatedAtValueEl.textContent = "-";
    labelSummaryValueEl.textContent = "-";
    renderOperationalNarrative();
    return;
  }

  workspaceTitleEl.textContent = state.selectedTask.name;
  workspaceSubtitleEl.textContent =
    taskScopedView
      ? "这是 task 的卷宗页，用来定义标签体系、scenario、prompts 与导出规则，并从这里启动新 run。"
      : "这是 run 的执行页，只负责推进当前运行实例、检查阶段进度与处理后续动作。";
  taskNameValueEl.textContent = state.selectedTask.name;
  labelSummaryValueEl.textContent = state.selectedTask.labels.join(" / ") || "-";

  if (!state.selectedRun || taskScopedView) {
    runIdValueEl.textContent = taskScopedView ? "任务上下文" : "未选择";
    runStatusValueEl.textContent = taskScopedView ? "任务视图" : "未选择 run";
    lastStageValueEl.textContent = "-";
    createdAtValueEl.textContent = "-";
    updatedAtValueEl.textContent = "-";
    renderOperationalNarrative();
    return;
  }

  runIdValueEl.textContent = state.selectedRun.run_id;
  runStatusValueEl.textContent = state.selectedRun.status || "-";
  lastStageValueEl.textContent = state.selectedRun.last_stage || "-";
  createdAtValueEl.textContent = formatDate(state.selectedRun.created_at);
  updatedAtValueEl.textContent = formatDate(state.selectedRun.updated_at);
  renderOperationalNarrative();
}

function renderArtifacts() {
  if (!state.selectedRun) {
    artifactListEl.innerHTML = '<div class="empty-state">选择 run 后可查看产物。</div>';
    artifactMetaEl.textContent = "暂无选中 run";
    state.artifactPayload = null;
    artifactPreviewEl.textContent = "暂无内容";
    renderArtifactStructured(null);
    return;
  }

  const artifacts = getVisibleArtifacts(state.selectedRun);
  if (!artifacts.length) {
    artifactListEl.innerHTML = '<div class="empty-state">当前 run 还没有可展示的产物。</div>';
    artifactMetaEl.textContent = "当前 run 暂无产物";
    artifactPreviewEl.textContent = "暂无内容";
    renderArtifactStructured(null);
    return;
  }

  const recommendedKeys = new Set(getRecommendedArtifactKeys(state.selectedRun));
  const recommendedArtifacts = artifacts.filter((artifact) => recommendedKeys.has(artifact.key));
  const groupedArtifacts = groupArtifactsByCategory(artifacts);

  artifactListEl.innerHTML = `
    <article class="artifact-nav-overview">
      <div class="artifact-nav-head">
        <div>
          <h3>诊断导航</h3>
          <p>按阶段浏览产物，并优先打开当前最值得检查的文件。</p>
        </div>
        <span class="artifact-nav-count">${escapeHtml(String(artifacts.length))}</span>
      </div>
      <div class="artifact-nav-chip-row">
        <span>${escapeHtml(`last_stage: ${state.selectedRun.last_stage || "created"}`)}</span>
        <span>${escapeHtml(`status: ${state.selectedRun.status || "-"}`)}</span>
        <span>${escapeHtml(getProgressText(state.selectedRun))}</span>
      </div>
      ${
        recommendedArtifacts.length
          ? `
            <div class="artifact-spotlight">
              <strong>建议先看</strong>
              <div class="artifact-spotlight-row">
                ${recommendedArtifacts
                  .map(
                    (artifact) => `
                      <button
                        class="artifact-spotlight-button ${artifact.key === state.selectedArtifactKey ? "is-active" : ""}"
                        type="button"
                        data-artifact="${artifact.key}"
                      >
                        ${escapeHtml(artifact.key)}
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }
    </article>
    ${groupedArtifacts
      .map(([category, items]) => {
        const categoryInfo = getArtifactCategoryInfo(category);
        return `
          <section class="artifact-nav-group">
            <div class="artifact-nav-group-head">
              <div>
                <h3>${escapeHtml(categoryInfo.label)}</h3>
                <p>${escapeHtml(categoryInfo.description)}</p>
              </div>
              <span class="artifact-nav-count">${escapeHtml(String(items.length))}</span>
            </div>
            <div class="artifact-nav-group-list">
              ${items
                .map((artifact) => {
                  const explanation = ARTIFACT_EXPLANATIONS[artifact.key];
                  const recommended = recommendedKeys.has(artifact.key);
                  return `
                    <button
                      class="artifact-item artifact-item-diagnostic ${artifact.key === state.selectedArtifactKey ? "is-active" : ""} ${recommended ? "is-recommended" : ""}"
                      type="button"
                      data-artifact="${artifact.key}"
                    >
                      <div class="artifact-item-head">
                        <strong>${escapeHtml(artifact.key)}</strong>
                        <span class="artifact-item-kind">${escapeHtml(artifact.kind)}</span>
                      </div>
                      <span class="artifact-item-role">${escapeHtml(
                        explanation?.stage ? `${explanation.stage} / ${category}` : category
                      )}</span>
                      <span>${escapeHtml(getArtifactListHint(artifact))}</span>
                      <div class="artifact-item-meta">
                        <span>${escapeHtml(artifact.relative_path)}</span>
                        ${recommended ? `<span class="artifact-item-badge">recommended</span>` : ""}
                      </div>
                    </button>
                  `;
                })
                .join("")}
            </div>
          </section>
        `;
      })
      .join("")}
  `;

  artifactListEl.querySelectorAll("[data-artifact]").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadArtifact(button.dataset.artifact);
    });
  });
}

function renderReviewSummary(summary = {}) {
  const normalizedSummary = {
    total: summary.total ?? state.reviewRecords.length,
    pending:
      summary.pending ??
      state.reviewRecords.filter((record) => (record.review_decision || "pending") === "pending").length,
    accepted: summary.accepted ?? state.reviewRecords.filter((record) => record.review_decision === "accepted").length,
    corrected:
      summary.corrected ?? state.reviewRecords.filter((record) => record.review_decision === "corrected").length,
    rejected: summary.rejected ?? state.reviewRecords.filter((record) => record.review_decision === "rejected").length,
  };
  const chips = [
    ["all", "总数", normalizedSummary.total],
    ["pending", "待处理", normalizedSummary.pending],
    ["accepted", "接受", normalizedSummary.accepted],
    ["corrected", "纠正", normalizedSummary.corrected],
    ["rejected", "拒绝", normalizedSummary.rejected],
  ];
  reviewSummaryEl.innerHTML = chips
    .map(
      ([filter, label, value]) => `
        <button
          class="review-summary-chip ${state.reviewFilter === filter ? "is-active" : ""}"
          type="button"
          data-review-filter="${escapeHtml(filter)}"
          aria-pressed="${state.reviewFilter === filter ? "true" : "false"}"
        >
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </button>
      `
    )
    .join("");

  reviewSummaryEl.querySelectorAll("[data-review-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewFilter = button.dataset.reviewFilter || "all";
      renderReviewSummary();
      renderReviews();
    });
  });
}

function reviewRecordMatchesFilter(record) {
  if (state.reviewFilter === "all") {
    return true;
  }
  return (record.review_decision || "pending") === state.reviewFilter;
}

function renderReviews() {
  if (!state.selectedRun) {
    reviewListEl.innerHTML = '<div class="empty-state">选择 run 后可查看 review 记录。</div>';
    renderReviewSummary();
    return;
  }

  if (!state.reviewRecords.length) {
    reviewListEl.innerHTML =
      '<div class="empty-state">当前 run 还没有 review_candidates 或 review_results。先执行 review-export。</div>';
    renderReviewSummary();
    return;
  }

  const filteredRecords = state.reviewRecords
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => reviewRecordMatchesFilter(record));
  if (!filteredRecords.length) {
    const activeFilterLabel =
      state.reviewFilter === "all"
        ? "全部记录"
        : REVIEW_DECISION_DETAILS[state.reviewFilter]?.display || state.reviewFilter;
    reviewListEl.innerHTML = `<div class="empty-state">当前筛选“${escapeHtml(activeFilterLabel)}”下没有 review 记录。</div>`;
    return;
  }

  const reviewCards = filteredRecords
    .map(({ record, index }) => {
      const selectedDecision = record.review_decision || "pending";
      const labelOptions = state.reviewLabels
        .map(
          (label) =>
            `<option value="${escapeHtml(label)}" ${record.reviewer_label === label ? "selected" : ""}>${escapeHtml(label)}</option>`
        )
        .join("");

      return `
        <article class="review-record" data-review-index="${index}">
          <h3>${escapeHtml(record.sample_id)}</h3>
          <p>${escapeHtml(record.user_text)}</p>
          <div class="review-meta">
            <span>teacher: ${escapeHtml(record.teacher_label || "-")}</span>
            <span>decision: ${escapeHtml(selectedDecision)}</span>
            <span>tags: ${escapeHtml((record.tags || []).join(", ") || "-")}</span>
          </div>
          <div class="review-grid">
            <div class="review-field review-field-full">
              <div class="review-field-head">
                <label>Decision</label>
                <span class="review-field-hint">决定这条样本是否改标、拒绝，或进入后续 gold。</span>
              </div>
              <select data-field="review_decision">
                ${renderReviewDecisionOptions(selectedDecision)}
              </select>
              ${renderReviewDecisionGuide(selectedDecision)}
            </div>
            <div class="review-field">
              <label>Reviewer Label</label>
              <select data-field="reviewer_label">
                <option value="">未设置</option>
                ${labelOptions}
              </select>
              <p class="review-field-hint"><code>accepted</code> 会自动回填 teacher_label；<code>corrected</code> 时这里必填。</p>
            </div>
            <div class="review-field">
              <label>Reviewed By</label>
              <input data-field="reviewed_by" type="text" value="${escapeHtml(record.reviewed_by || "")}" />
              <p class="review-field-hint">留空时，保存会优先使用页面顶部的 Reviewer 名称。</p>
            </div>
            <div class="review-field">
              <label>Reviewed At</label>
              <input data-field="reviewed_at" type="text" value="${escapeHtml(record.reviewed_at || "")}" />
              <p class="review-field-hint">留空时，保存会自动补当前时间。</p>
            </div>
            <div class="review-field review-field-full">
              <label>Comment</label>
              <textarea data-field="review_comment" rows="3">${escapeHtml(record.review_comment || "")}</textarea>
              <p class="review-field-hint"><code>rejected</code> 时必填，建议写清样本问题或拒绝原因。</p>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  reviewListEl.innerHTML = reviewCards;

  reviewListEl.querySelectorAll("[data-review-index]").forEach((container) => {
    const index = Number(container.dataset.reviewIndex);
    container.querySelectorAll("[data-field]").forEach((field) => {
      field.addEventListener("input", () => {
        state.reviewRecords[index][field.dataset.field] = field.value;
      });
      field.addEventListener("change", () => {
        state.reviewRecords[index][field.dataset.field] = field.value;
        if (field.dataset.field === "review_decision") {
          renderReviewSummary();
          renderReviews();
        }
      });
    });
  });
}

async function loadTasks() {
  const payload = await api("/api/tasks");
  state.tasks = payload.items || [];
  if (!state.selectedTask && state.tasks.length) {
    state.selectedTask = state.tasks[0];
  } else if (state.selectedTask) {
    state.selectedTask = state.tasks.find((item) => item.name === state.selectedTask.name) || state.tasks[0] || null;
  }
  renderTasks();
  renderSummary();
}

async function loadTaskSpec(options = {}) {
  const { preserveEditing = false } = options;
  if (!state.selectedTask) {
    state.taskSpec = null;
    state.taskConfig = null;
    state.originalTaskConfig = null;
    state.isEditingTaskConfig = false;
    syncConfigDirty();
    renderTaskSpec();
    return;
  }
  const [specPayload, configPayload] = await Promise.all([
    api(`/api/tasks/${state.selectedTask.name}/spec`),
    api(`/api/tasks/${state.selectedTask.name}/config-files`),
  ]);
  state.taskSpec = specPayload;
  state.taskConfig = cloneData(configPayload);
  state.originalTaskConfig = cloneData(configPayload);
  state.isEditingTaskConfig = preserveEditing ? state.isEditingTaskConfig : false;
  syncConfigDirty();
  setConfigStatus("配置已加载");
  renderTaskSpec();
}

function coercePrimitiveInput(value) {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (!Number.isNaN(Number(trimmed)) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.includes(".") ? Number.parseFloat(trimmed) : Number.parseInt(trimmed, 10);
  }
  return trimmed;
}

function updateTaskConfig(mutator, options = {}) {
  if (!state.taskConfig) {
    return;
  }
  const { rerenderEditors = true } = options;
  mutator(state.taskConfig);
  syncConfigDirty();
  setConfigStatus(state.configDirty ? "存在未保存修改" : "配置已同步", state.configDirty ? "warning" : "neutral");
  renderTaskSpecReadOnly(buildTaskSpecView());
  renderConfigSummary();
  renderTaskScenarioSummary();
  renderConfigStatusActions();
  renderPromptSwitch();
  if (rerenderEditors) {
    renderTaskMetaForm();
    renderTaskRuntimeEditor();
    renderPrimitiveEditor(taskRulesEditorEl, "rules", state.taskConfig?.rules || {});
    renderPrimitiveEditor(taskExportsEditorEl, "exports", state.taskConfig?.exports || {});
    renderTaskLabelsEditor();
    renderTaskScenarioEditor();
    renderTaskPromptEditor();
  }
}

async function saveTaskConfig() {
  if (!state.selectedTask || !state.taskConfig) {
    setMessage("当前没有可保存的 task 配置。", "error");
    return;
  }

  state.configSaving = true;
  renderConfigStatusActions();
  setConfigStatus("正在保存配置...");
  setMessage("正在保存 task 配置...");

  try {
    const payload = await api(`/api/tasks/${state.selectedTask.name}/config-files`, {
      method: "PUT",
      body: JSON.stringify({
        task: state.taskConfig.task,
        runtime: state.taskConfig.runtime,
        rules: state.taskConfig.rules,
        exports: state.taskConfig.exports,
        labels: state.taskConfig.labels,
        scenarios: state.taskConfig.scenarios,
        generator_prompt: state.taskConfig.generator_prompt,
        teacher_prompt: state.taskConfig.teacher_prompt,
      }),
    });
    state.taskConfig = cloneData(payload.config);
    state.originalTaskConfig = cloneData(payload.config);
    state.taskSpec = payload.spec;
    state.isEditingTaskConfig = false;
    syncConfigDirty();
    await loadTasks();
    state.selectedTask = state.tasks.find((item) => item.name === state.selectedTask?.name) || state.selectedTask;
    setConfigStatus("配置保存成功", "success");
    setMessage("task 配置已保存", "success");
    renderTaskSpec();
    renderTasks();
    renderSummary();
  } catch (error) {
    setConfigStatus(error.message, "error");
    setMessage(error.message, "error");
  } finally {
    state.configSaving = false;
    renderConfigStatusActions();
  }
}

async function loadRuns() {
  if (!state.selectedTask) {
    state.runs = [];
    renderRuns();
    renderSummary();
    return;
  }

  const payload = await api(`/api/tasks/${state.selectedTask.name}/runs`);
  state.runs = payload.items || [];
  state.selectedRunId =
    state.selectedRunId && state.runs.some((run) => run.run_id === state.selectedRunId)
      ? state.selectedRunId
      : null;
  renderRuns();

  if (state.selectedRunId) {
    await loadRunDetails(state.selectedRunId);
  } else {
    state.selectedRun = null;
    renderSummary();
    renderArtifacts();
    renderReviews();
  }
}

async function loadRunDetails(runId) {
  state.selectedRunId = runId;
  const run = await api(`/api/tasks/${state.selectedTask.name}/runs/${runId}`);
  state.selectedRun = run;
  renderRuns();
  renderSummary();

  const visibleArtifacts = getVisibleArtifacts(run);
  renderArtifacts();
  state.selectedArtifactKey =
    state.selectedArtifactKey && visibleArtifacts.some((artifact) => artifact.key === state.selectedArtifactKey)
      ? state.selectedArtifactKey
      : visibleArtifacts[0]?.key || null;

  if (state.selectedArtifactKey) {
    await loadArtifact(state.selectedArtifactKey);
  } else {
    artifactMetaEl.textContent = "当前 run 暂无产物";
    artifactPreviewEl.textContent = "暂无内容";
  }

  await loadReviewRecords();
}

async function selectTask(taskName, options = {}) {
  const { preserveRunSelection = false, activateTaskTab = true } = options;
  const previousRunId = preserveRunSelection ? state.selectedRunId : null;
  state.selectedTask = state.tasks.find((item) => item.name === taskName) || null;
  state.taskSpec = null;
  state.taskConfig = null;
  state.originalTaskConfig = null;
  state.isEditingTaskConfig = false;
  syncConfigDirty();
  state.selectedRunId = previousRunId;
  state.selectedRun = null;
  state.selectedArtifactKey = null;
  state.reviewRecords = [];
  if (activateTaskTab) {
    setActiveTab("task-spec");
  }
  renderTasks();
  renderSummary();
  renderTaskSpec();
  await loadTaskSpec();
  await loadRuns();
}

async function selectRun(runId) {
  if (!runId) {
    return;
  }
  await loadRunDetails(runId);
  setActiveTab("run-control");
}

async function loadArtifact(artifactKey) {
  if (!state.selectedTask || !state.selectedRun) {
    return;
  }
  state.selectedArtifactKey = artifactKey;
  renderArtifacts();
  state.artifactPayload = null;
  renderArtifactViewSwitch();
  artifactMetaEl.textContent = "读取中...";
  artifactPreviewEl.textContent = "";
  artifactStructuredViewEl.innerHTML = '<div class="empty-state">正在读取产物...</div>';

  try {
    const payload = await api(
      `/api/tasks/${state.selectedTask.name}/runs/${state.selectedRun.run_id}/artifacts/${artifactKey}`
    );
    state.artifactPayload = payload;
    state.artifactSearch = "";
    state.artifactFilter = "all";
    artifactSearchInputEl.value = "";
    renderArtifactFilterOptions(payload);
    renderArtifactViewSwitch();
    artifactMetaEl.textContent = `${payload.relative_path} · ${payload.kind} · ${
      payload.exists ? "exists" : "missing"
    }`;
    artifactPreviewEl.textContent =
      payload.content == null
        ? "文件不存在"
        : typeof payload.content === "string"
          ? payload.content
          : JSON.stringify(payload.content, null, 2);
    renderArtifactStructured(payload);
  } catch (error) {
    state.artifactPayload = null;
    artifactMetaEl.textContent = "读取失败";
    artifactPreviewEl.textContent = error.message;
    artifactStructuredViewEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setMessage(error.message, "error");
  }
}

async function loadReviewRecords() {
  if (!state.selectedTask || !state.selectedRun) {
    state.reviewRecords = [];
    state.reviewLabels = [];
    renderReviews();
    return;
  }

  try {
    const payload = await api(
      `/api/tasks/${state.selectedTask.name}/runs/${state.selectedRun.run_id}/review-records`
    );
    state.reviewRecords = payload.records || [];
    state.reviewLabels = payload.labels || [];
    renderReviews();
    renderReviewSummary(payload.summary || {});
  } catch (error) {
    state.reviewRecords = [];
    state.reviewLabels = [];
    renderReviews();
    renderReviewSummary();
    setMessage(error.message, "error");
  }
}

function setCommandLoading(command, isLoading) {
  allCommandButtons.forEach((button) => {
    const active = button.dataset.command === command && isLoading;
    button.classList.toggle("is-running", active);
    button.disabled = isLoading;
  });
  refreshAllButton.disabled = isLoading;
  reloadArtifactButton.disabled = isLoading;
  reloadReviewButton.disabled = isLoading;
  saveReviewButton.disabled = isLoading;
  renderRuns();
  renderOperationalNarrative();
}

async function runCommand(command) {
  if (!state.selectedTask) {
    setMessage("请先选择 task。", "error");
    return;
  }

  state.loadingCommand = command;
  setCommandLoading(command, true);
  setMessage(`正在执行 ${command} ...`);

  try {
    const payload = await api(`/api/tasks/${state.selectedTask.name}/commands/${command}`, {
      method: "POST",
      body: JSON.stringify({
        run_id: command === "generate" || command === "run-all" ? null : state.selectedRunId,
      }),
    });

    await loadTasks();
    await selectTask(state.selectedTask.name, { activateTaskTab: false });
    if (payload.run_id) {
      await selectRun(payload.run_id);
    }
    setMessage(`${command} 执行完成`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    state.loadingCommand = null;
    setCommandLoading(command, false);
  }
}

async function saveReviewRecords() {
  if (!state.selectedTask || !state.selectedRun) {
    setMessage("当前没有可保存的 run。", "error");
    return;
  }

  setCommandLoading("save-review", true);
  setMessage("正在保存 review_results ...");

  try {
    const payload = await api(
      `/api/tasks/${state.selectedTask.name}/runs/${state.selectedRun.run_id}/review-records`,
      {
        method: "PUT",
        body: JSON.stringify({
          reviewer: reviewerInputEl.value.trim() || null,
          records: state.reviewRecords,
        }),
      }
    );
    state.reviewRecords = payload.records || [];
    renderReviews();
    renderReviewSummary(payload.summary || {});
    await loadRunDetails(state.selectedRun.run_id);
    setMessage("review_results 已保存", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    setCommandLoading("save-review", false);
  }
}

async function deleteRun(runId) {
  if (!state.selectedTask || !runId || state.deletingRunId) {
    return;
  }
  const confirmed = window.confirm(`确认删除 run ${runId}？这会移除该 run 目录及其产物。`);
  if (!confirmed) {
    return;
  }

  state.deletingRunId = runId;
  renderRuns();
  setMessage(`正在删除 ${runId} ...`);

  try {
    await api(`/api/tasks/${state.selectedTask.name}/runs/${runId}`, {
      method: "DELETE",
    });
    if (state.selectedRunId === runId) {
      state.selectedRunId = null;
      state.selectedRun = null;
      state.selectedArtifactKey = null;
      state.artifactPayload = null;
      state.reviewRecords = [];
      state.reviewLabels = [];
    }
    await loadTasks();
    await loadRuns();
    if (!state.selectedRunId) {
      setActiveTab("task-spec");
    }
    setMessage(`已删除 ${runId}`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    state.deletingRunId = null;
    renderRuns();
  }
}

function createEmptyScenario() {
  return {
    intent: "rewrite_report",
    difficulty: "medium",
    tags: [],
    context: {
      has_visible_report: false,
      previous_report_summary: "",
      dialogue_stage: "standalone",
      language: "zh",
    },
    templates: [""],
  };
}

function enterTaskConfigEditMode() {
  if (!state.taskConfig || state.configSaving) {
    return;
  }
  state.isEditingTaskConfig = true;
  if (!state.configDirty) {
    setConfigStatus("已进入编辑模式");
  }
  renderTaskSpec();
}

function cancelTaskConfigEditMode() {
  if (!state.originalTaskConfig || state.configSaving) {
    return;
  }
  state.taskConfig = cloneData(state.originalTaskConfig);
  state.isEditingTaskConfig = false;
  syncConfigDirty();
  setConfigStatus("已取消编辑");
  renderTaskSpec();
}

async function refreshAll() {
  setMessage("正在刷新工作台...");
  try {
    const preserveRunSelection = !!state.selectedRunId;
    await loadTasks();
    if (state.selectedTask) {
      await selectTask(state.selectedTask.name, { preserveRunSelection, activateTaskTab: false });
    }
    setMessage("已刷新", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

taskMetaFormEl.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.configSection) {
    return;
  }
  updateTaskConfig((draft) => {
    draft[target.dataset.configSection][target.dataset.configKey] = target.value;
  }, { rerenderEditors: false });
});

taskRuntimeEditorEl.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.runtimeStage) {
    return;
  }
  updateTaskConfig((draft) => {
    draft.runtime[target.dataset.runtimeStage][target.dataset.runtimeKey] = coercePrimitiveInput(target.value);
  }, { rerenderEditors: false });
});

function bindPrimitiveEditor(container, sectionName) {
  container.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.configSection !== sectionName) {
      return;
    }
    updateTaskConfig((draft) => {
      draft[sectionName][target.dataset.configKey] = coercePrimitiveInput(target.value);
    }, { rerenderEditors: false });
  });
}

bindPrimitiveEditor(taskRulesEditorEl, "rules");
bindPrimitiveEditor(taskExportsEditorEl, "exports");

taskLabelsEditorEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target.matches("[data-label-index]")) {
    const index = Number(target.dataset.labelIndex);
    updateTaskConfig((draft) => {
      draft.labels.splice(index, 1);
    });
    return;
  }
  if (target.id === "addLabelButton") {
    const input = document.getElementById("newLabelInput");
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const value = input.value.trim();
    if (!value) {
      setConfigStatus("新增 label 不能为空", "error");
      return;
    }
    updateTaskConfig((draft) => {
      if (!draft.labels.includes(value)) {
        draft.labels.push(value);
      }
    });
  }
});

taskScenarioEditorEl.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }
  const index = Number(target.dataset.scenarioIndex);
  if (!Number.isInteger(index) || !state.taskConfig?.scenarios?.[index]) {
    return;
  }
  updateTaskConfig((draft) => {
    const scenario = draft.scenarios[index];
    if (target.dataset.scenarioField) {
      const field = target.dataset.scenarioField;
      if (field === "tags") {
        scenario.tags = target.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (field === "templates") {
        scenario.templates = target.value
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (field === "generation_count") {
        const value = target.value.trim();
        if (!value) {
          delete scenario.generation_count;
        } else {
          scenario.generation_count = Number.parseInt(value, 10);
        }
      } else {
        scenario[field] = target.value;
      }
    }
    if (target.dataset.scenarioContext) {
      const field = target.dataset.scenarioContext;
      if (field === "has_visible_report") {
        scenario.context[field] = target.value === "true";
      } else {
        scenario.context[field] = target.value;
      }
    }
  }, { rerenderEditors: false });
});

taskScenarioEditorEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches("[data-remove-scenario]")) {
    return;
  }
  const index = Number(target.dataset.removeScenario);
  updateTaskConfig((draft) => {
    draft.scenarios.splice(index, 1);
  });
});

taskPromptEditorEl.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || !target.dataset.promptField) {
    return;
  }
  updateTaskConfig((draft) => {
    draft[target.dataset.promptField] = target.value;
  }, { rerenderEditors: false });
});

allCommandButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await runCommand(button.dataset.command);
  });
});

workbenchTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.workbenchTab);
  });
});

refreshAllButton.addEventListener("click", refreshAll);
reloadArtifactButton.addEventListener("click", async () => {
  if (state.selectedArtifactKey) {
    await loadArtifact(state.selectedArtifactKey);
  }
});
editTaskConfigButton.addEventListener("click", enterTaskConfigEditMode);
reloadTaskConfigButton.addEventListener("click", async () => {
  if (!state.selectedTask) {
    return;
  }
  await loadTaskSpec({ preserveEditing: state.isEditingTaskConfig });
  setConfigStatus("配置已从磁盘重载", "success");
});
resetTaskConfigButton.addEventListener("click", cancelTaskConfigEditMode);
saveTaskConfigButton.addEventListener("click", saveTaskConfig);
addScenarioButton.addEventListener("click", () => {
  updateTaskConfig((draft) => {
    draft.scenarios.push(createEmptyScenario());
  });
});
promptViewSwitchEl.querySelectorAll("[data-prompt-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.promptView = button.dataset.promptView;
    renderTaskSpec();
  });
});
artifactSearchInputEl.addEventListener("input", () => {
  state.artifactSearch = artifactSearchInputEl.value;
  renderArtifactStructured(state.artifactPayload);
});
artifactFilterSelectEl.addEventListener("change", () => {
  state.artifactFilter = artifactFilterSelectEl.value;
  renderArtifactStructured(state.artifactPayload);
});
artifactViewSwitchEl.querySelectorAll("[data-artifact-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.artifactViewMode = button.dataset.artifactView;
    renderArtifactViewSwitch();
  });
});
rawCandidateViewSwitchEl.querySelectorAll("[data-raw-candidate-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.rawCandidateViewMode = button.dataset.rawCandidateView;
    renderRawCandidateControls(state.artifactPayload);
    renderArtifactStructured(state.artifactPayload);
  });
});
rawCandidateGroupBySelectEl.addEventListener("change", () => {
  state.rawCandidateGroupBy = rawCandidateGroupBySelectEl.value;
  renderArtifactStructured(state.artifactPayload);
});
reloadReviewButton.addEventListener("click", loadReviewRecords);
saveReviewButton.addEventListener("click", saveReviewRecords);

renderWorkbenchTabs();

refreshAll().catch((error) => {
  setMessage(error.message, "error");
});
