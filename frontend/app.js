import { NEW_RUN_COMMANDS, PIPELINE_STAGES } from "./js/core/constants.js";
import { api, escapeHtml, formatArtifactValue, formatDate } from "./js/core/platform.js";
import { createDefaultTaskConfig, hasTaskConfigChanges } from "./js/core/task-config.js";
import { createTaskSpecModule } from "./js/modules/task-spec.js";
import { createReviewModule } from "./js/modules/review.js";
import { createArtifactsModule } from "./js/modules/artifacts.js";

const state = {
  tasks: [],
  runs: [],
  selectedTask: null,
  taskSpec: null,
  taskConfig: null,
  originalTaskConfig: null,
  runtimeCatalog: null,
  runtimeAdvancedOpen: {},
  llmSettings: null,
  originalLlmSettings: null,
  llmSettingsDirty: false,
  llmSettingsSaving: false,
  llmTestingProvider: null,
  llmTestResults: {},
  configDirty: false,
  configSaving: false,
  isEditingTaskConfig: false,
  activeTab: "run-control",
  promptView: "generator",
  runtimeManualModelOpen: {},
  scenarioAdvancedOpen: {},
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
  deletingTaskName: null,
  deletingRunId: null,
  creatingTask: false,
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
const createTaskButton = document.getElementById("createTaskButton");
const sidebarSettingsButton = document.getElementById("sidebarSettingsButton");
const sidebarSettingsPillEl = document.getElementById("sidebarSettingsPill");
const sidebarSettingsSummaryEl = document.getElementById("sidebarSettingsSummary");
const sidebarSettingsMetricsEl = document.getElementById("sidebarSettingsMetrics");
const sidebarRailFootEl = document.getElementById("sidebarRailFoot");
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
const llmProviderGridEl = document.getElementById("llmProviderGrid");
const llmDeckStatusEl = document.getElementById("llmDeckStatus");
const llmDeckMetaEl = document.getElementById("llmDeckMeta");
const addLlmProviderButton = document.getElementById("addLlmProviderButton");
const reloadLlmSettingsButton = document.getElementById("reloadLlmSettingsButton");
const saveLlmSettingsButton = document.getElementById("saveLlmSettingsButton");
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

const taskSpecModule = createTaskSpecModule({
  state,
  api,
  elements: {
    taskSpecReadViewEl,
    taskSpecEditViewEl,
    promptViewSwitchEl,
    editTaskConfigButton,
    resetTaskConfigButton,
    saveTaskConfigButton,
    reloadTaskConfigButton,
    taskConfigAdviceEl,
    addScenarioButton,
    taskConfigStatusEl,
    taskConfigSummaryEl,
    taskConfigImpactEl,
    llmProviderGridEl,
    llmDeckStatusEl,
    llmDeckMetaEl,
    addLlmProviderButton,
    reloadLlmSettingsButton,
    saveLlmSettingsButton,
    taskMetaFormEl,
    taskRuntimeEditorEl,
    taskRulesEditorEl,
    taskExportsEditorEl,
    taskLabelsEditorEl,
    taskScenarioSummaryEl,
    taskScenarioEditorEl,
    taskPromptEditorEl,
    taskDossierHeroEl,
    taskSpecOverviewEl,
    taskSpecLabelsEl,
    taskSpecRulesEl,
    taskSpecExportsEl,
    taskRuntimeGridEl,
    taskScenarioGridEl,
    taskPromptMetaEl,
    taskPromptPreviewEl,
  },
  callbacks: {
    syncConfigDirty,
    setConfigStatus,
    setMessage,
    loadTasks,
    renderTasks,
    renderSummary,
    renderSidebarSettings,
  },
});

const reviewModule = createReviewModule({
  state,
  api,
  elements: {
    reviewListEl,
    reviewSummaryEl,
    reviewerInputEl,
    reloadReviewButton,
    saveReviewButton,
  },
  callbacks: {
    setMessage,
    setCommandLoading,
    loadRunDetails,
  },
});

let artifactsModule;

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

function normalizeStageName(value) {
  return String(value || "").replace(/_/g, "-");
}

artifactsModule = createArtifactsModule({
  state,
  api,
  elements: {
    artifactListEl,
    artifactMetaEl,
    artifactPreviewEl,
    artifactStructuredViewEl,
    artifactSummaryBarEl,
    artifactExplainerEl,
    artifactSearchInputEl,
    artifactFilterSelectEl,
    artifactViewSwitchEl,
    rawCandidateViewSwitchEl,
    rawCandidateGroupByFieldEl,
    rawCandidateGroupBySelectEl,
    reloadArtifactButton,
  },
  callbacks: {
    setMessage,
    getRecordSearchText,
    buildSummaryChips,
  },
  dictionaries: {
    artifactExplanations: ARTIFACT_EXPLANATIONS,
    artifactCategoryMeta: ARTIFACT_CATEGORY_META,
    recommendedArtifactsByStage: RECOMMENDED_ARTIFACTS_BY_STAGE,
  },
});

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

function syncConfigDirty() {
  state.configDirty = hasTaskConfigChanges(state.taskConfig, state.originalTaskConfig);
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
  if (state.activeTab === "settings") {
    return {
      title: "先校对 workspace 级模型入口",
      body: "这里负责维护全局 provider、端点、密钥和默认模型。先做连通性测试，再回到 task runtime 里套用全局配置。",
      meta: [
        ["模式", "全局设置"],
        ["建议", "保存后逐个做 probe"],
      ],
    };
  }

  if (!task) {
    return {
      title: "先选择一个 task",
      body: "左侧选中任务后，工作台会自动加载任务配置、运行历史、产物和 review 入口。",
      meta: [
        ["模式", "探索工作台"],
        ["建议", "先看任务配置，再决定是否启动新 run"],
      ],
    };
  }

  if (state.activeTab === "task-spec") {
    if (state.isEditingTaskConfig) {
      return {
        title: "先完成这份任务配置",
        body: "当前在编辑 task 配置。优先校对场景、模型、提示词和导出规则，确认无误后保存，再发起新的 run。",
        meta: [
          ["模式", "任务配置 / 编辑"],
          ["labels", String(task.labels?.length || 0)],
        ],
      };
    }
    return {
      title: "任务配置负责新建前准备",
      body: "先确认标签、场景、模型和提示词，再用 generate 或 run-all 发起新的 run。",
      meta: [
        ["模式", "任务配置 / 只读"],
        ["runs", String(task.run_count || 0)],
      ],
    };
  }

  if (!run) {
    return {
      title: "先去任务配置页新建 run",
      body: "“任务配置”页提供 task 级的新建 run 入口；首次验证整条链路优先用 run-all，只看生成质量再单独用 generate。",
      meta: [
        ["推荐入口", "任务配置 / run-all"],
        ["当前状态", "尚未选择 run"],
      ],
    };
  }

  const nextStage = getNextStage(run);
  if (nextStage?.command === "generate") {
    return {
      title: "当前 run 尚未真正启动",
      body: "generate 已移到“任务配置”页；如果这是空 run，建议直接删除它，再到“任务配置”页重新新建。",
      meta: [
        ["当前进度", getProgressText(run)],
        ["建议入口", "任务配置 / generate"],
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
  const taskScopedView = state.activeTab === "task-spec" || state.activeTab === "settings";
  const contextMode = state.activeTab === "settings" ? "全局设置" : taskScopedView ? "任务配置" : run ? getProgressText(run) : "0/7 stages";
  const providers = Array.isArray(state.llmSettings?.providers) ? state.llmSettings.providers : [];
  const readyProviders = providers.filter((provider) => {
    const config = provider?.config || {};
    return provider?.name === "mock" || config.has_api_key || Boolean(String(config.api_key || "").trim());
  }).length;

  workspaceContextEl.innerHTML = state.activeTab === "settings"
    ? buildSummaryChips([
        ["providers", String(providers.length)],
        ["ready", String(readyProviders)],
        ["mode", contextMode],
      ])
    : buildSummaryChips([
        ["theme", task?.theme || "-"],
        ["type", task?.task_type || "-"],
        ["language", task?.language || "-"],
        ["labels", String(task?.labels?.length || 0)],
        ["runs", String(task?.run_count || 0)],
        [taskScopedView ? "mode" : "progress", contextMode],
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
        <strong>先确认任务配置</strong>
        <span>进入“任务配置”页检查 labels、runtime、scenario matrix 和 prompts 是否符合当前目标。</span>
      </article>
      <article class="operator-note-card">
        <strong>首次执行建议</strong>
        <span>当前页只负责推进已有 run；要新建 run，请切到“任务配置”页，首次跑通优先用 run-all。</span>
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
        ? "这是一条尚未启动的空 run。generate 已在“任务配置”页提供，通常应删除这条空 run 后重新新建。"
        : nextStage
        ? `继续执行 ${nextStage.command}，避免 run 停留在 ${run.last_stage || "created"}。`
        : "这条 run 已完成全部阶段，建议转去产物页做评测结论确认。",
    },
    {
      title: "优先查看",
      body:
        !run.last_stage
          ? "当前 run 还没有进入任何阶段；如果这是误创建的空 run，直接删除并到“任务配置”页重新新建。"
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

function renderPromptSwitch() {
  return taskSpecModule.renderPromptSwitch();
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

function renderSidebarSettings() {
  const providers = Array.isArray(state.llmSettings?.providers) ? state.llmSettings.providers : [];
  const readyCount = providers.filter((provider) => {
    const config = provider?.config || {};
    return provider?.name === "mock" || config.has_api_key || Boolean(String(config.api_key || "").trim());
  }).length;
  const probeResults = Object.values(state.llmTestResults || {}).filter((result) => result && typeof result === "object");
  const lastProbe = probeResults[probeResults.length - 1];
  const dirtyLabel = state.llmSettingsDirty ? "unsaved" : "clean";

  sidebarSettingsButton.classList.toggle("is-active", state.activeTab === "settings");
  sidebarSettingsPillEl.textContent = state.llmSettingsDirty ? "Dirty" : "Rail";
  sidebarSettingsSummaryEl.textContent = providers.length
    ? `${readyCount}/${providers.length} 个 provider 已具备可用凭据`
    : "正在读取 provider 状态";
  sidebarSettingsMetricsEl.innerHTML = `
    <span><strong>providers</strong>${escapeHtml(providers.length ? String(providers.length) : "--")}</span>
    <span><strong>ready</strong>${escapeHtml(providers.length ? String(readyCount) : "--")}</span>
    <span><strong>probe</strong>${escapeHtml(
      lastProbe ? (lastProbe.ok ? "最近一次通过" : "最近一次失败") : "未测试"
    )}</span>
  `;
  sidebarRailFootEl.innerHTML = `
    <span><strong>route</strong>${escapeHtml(state.activeTab === "settings" ? "settings" : "task workspace")}</span>
    <span><strong>draft</strong>${escapeHtml(dirtyLabel)}</span>
    <span><strong>focus</strong>${escapeHtml(
      lastProbe ? `${lastProbe.provider || "llm"} ${lastProbe.ok ? "ok" : "error"}` : "workspace llm"
    )}</span>
  `;
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  renderWorkbenchTabs();
  renderSidebarSettings();
  renderSummary();
}

function renderConfigStatusActions() {
  return taskSpecModule.renderConfigStatusActions();
}

function renderTaskSpec() {
  return taskSpecModule.renderTaskSpec();
}

function renderArtifactViewSwitch() {
  artifactsModule.renderArtifactViewSwitch();
}

function getVisibleArtifacts(run) {
  return artifactsModule.getVisibleArtifacts(run);
}

function renderArtifactStructured(payload) {
  artifactsModule.renderArtifactStructured(payload);
}

function renderArtifacts() {
  artifactsModule.renderArtifacts();
}

function renderReviewSummary(summary = {}) {
  reviewModule.renderReviewSummary(summary);
}

function renderReviews() {
  reviewModule.renderReviews();
}

function renderTasks() {
  taskCountEl.textContent = String(state.tasks.length);
  createTaskButton.disabled = state.creatingTask || !!state.loadingCommand || !!state.deletingTaskName;

  if (!state.tasks.length) {
    taskListEl.innerHTML = '<div class="empty-state">没有发现 task。</div>';
    return;
  }

  taskListEl.innerHTML = state.tasks
    .map(
      (task) => `
        <article class="task-item-row ${task.name === state.selectedTask?.name ? "is-active" : ""}">
          <button
            class="task-item ${task.name === state.selectedTask?.name ? "is-active" : ""}"
            type="button"
            data-task="${task.name}"
            ${state.deletingTaskName || state.loadingCommand || state.creatingTask ? "disabled" : ""}
          >
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
          <button
            class="task-delete-button"
            type="button"
            data-delete-task="${task.name}"
            ${state.deletingTaskName || state.loadingCommand || state.creatingTask ? "disabled" : ""}
          >
            删除
          </button>
        </article>
      `
    )
    .join("");

  taskListEl.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      await selectTask(button.dataset.task);
    });
  });
  taskListEl.querySelectorAll("[data-delete-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteTask(button.dataset.deleteTask);
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
    runListEl.innerHTML = '<div class="empty-state">当前 task 还没有 run。切到“任务配置”页执行 generate 或 run-all。</div>';
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
  const taskScopedView = state.activeTab === "task-spec" || state.activeTab === "settings";
  const settingsView = state.activeTab === "settings";
  if (!state.selectedTask) {
    workspaceTitleEl.textContent = settingsView ? "全局设置" : "选择 task";
    workspaceSubtitleEl.textContent = settingsView
      ? "这里管理 workspace 级大模型入口、默认模型和连通性探活，不依赖具体 task。"
      : "左侧选择一个 task，工作台会自动加载运行历史、关键产物与人工复核入口。";
    taskNameValueEl.textContent = "-";
    runIdValueEl.textContent = settingsView ? "workspace" : "-";
    runStatusValueEl.textContent = settingsView ? "global config" : "-";
    lastStageValueEl.textContent = "-";
    createdAtValueEl.textContent = "-";
    updatedAtValueEl.textContent = "-";
    labelSummaryValueEl.textContent = "-";
    renderOperationalNarrative();
    return;
  }

  workspaceTitleEl.textContent = settingsView ? "全局设置" : state.selectedTask.name;
  workspaceSubtitleEl.textContent = settingsView
    ? "这是 workspace 级设置页，用来统一维护大模型 provider、默认模型与连通性。task runtime 只负责引用这些全局约定。"
    : taskScopedView
      ? "这是 task 的配置页，用来维护标签体系、场景、提示词与导出规则，并从这里启动新 run。"
      : "这是 run 的执行页，只负责推进当前运行实例、检查阶段进度与处理后续动作。";
  taskNameValueEl.textContent = settingsView ? "workspace" : state.selectedTask.name;
  labelSummaryValueEl.textContent = settingsView ? "-" : state.selectedTask.labels.join(" / ") || "-";

  if (!state.selectedRun || taskScopedView) {
    runIdValueEl.textContent = settingsView ? "workspace" : taskScopedView ? "任务上下文" : "未选择";
    runStatusValueEl.textContent = settingsView ? "global config" : taskScopedView ? "任务视图" : "未选择 run";
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
  return taskSpecModule.loadTaskSpec(options);
}

async function loadGlobalLlmSettings() {
  return taskSpecModule.loadLlmSettings();
}

function updateTaskConfig(mutator, options = {}) {
  return taskSpecModule.updateTaskConfig(mutator, options);
}

async function saveTaskConfig() {
  return taskSpecModule.saveTaskConfig();
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
      : state.runs[0]?.run_id || null;
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

function clearTaskWorkspaceState() {
  state.selectedTask = null;
  state.taskSpec = null;
  state.taskConfig = null;
  state.originalTaskConfig = null;
  state.runtimeCatalog = null;
  state.isEditingTaskConfig = false;
  state.runtimeManualModelOpen = {};
  state.scenarioAdvancedOpen = {};
  state.selectedRunId = null;
  state.selectedRun = null;
  state.runs = [];
  state.selectedArtifactKey = null;
  state.artifactPayload = null;
  state.reviewRecords = [];
  state.reviewLabels = [];
  syncConfigDirty();
}

async function loadRunDetails(runId) {
  state.selectedRunId = runId;
  const run = await api(`/api/tasks/${state.selectedTask.name}/runs/${runId}`);
  state.selectedRun = run;
  renderRuns();
  renderSummary();

  const visibleArtifacts = getVisibleArtifacts(run);
  renderArtifacts();
  const recommendedArtifactKeys = RECOMMENDED_ARTIFACTS_BY_STAGE[normalizeStageName(run.last_stage)] || [];
  const recommendedArtifactKey = recommendedArtifactKeys.find((key) =>
    visibleArtifacts.some((artifact) => artifact.key === key)
  );
  state.selectedArtifactKey =
    state.selectedArtifactKey && visibleArtifacts.some((artifact) => artifact.key === state.selectedArtifactKey)
      ? state.selectedArtifactKey
      : recommendedArtifactKey || visibleArtifacts[0]?.key || null;

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
  state.runtimeManualModelOpen = {};
  state.scenarioAdvancedOpen = {};
  syncConfigDirty();
  state.selectedRunId = previousRunId;
  state.selectedRun = null;
  state.selectedArtifactKey = null;
  state.reviewRecords = [];
  renderTasks();
  renderSummary();
  renderTaskSpec();
  await loadTaskSpec();
  await loadRuns();
  if (activateTaskTab) {
    setActiveTab(state.selectedRunId ? "run-control" : "task-spec");
  } else {
    renderSummary();
  }
}

async function selectRun(runId) {
  if (!runId) {
    return;
  }
  await loadRunDetails(runId);
  setActiveTab("run-control");
}

async function loadArtifact(artifactKey) {
  return artifactsModule.loadArtifact(artifactKey);
}

async function loadReviewRecords() {
  return reviewModule.loadReviewRecords();
}

function setCommandLoading(command, isLoading) {
  allCommandButtons.forEach((button) => {
    const active = button.dataset.command === command && isLoading;
    button.classList.toggle("is-running", active);
    button.disabled = isLoading;
  });
  refreshAllButton.disabled = isLoading;
  createTaskButton.disabled = isLoading || state.creatingTask;
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
  return reviewModule.saveReviewRecords();
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

async function deleteTask(taskName) {
  if (!taskName || state.deletingTaskName || state.creatingTask || state.loadingCommand) {
    return;
  }

  const confirmed = window.confirm(`确认删除 task ${taskName}？这会移除该任务的配置、runs 和全部产物。`);
  if (!confirmed) {
    return;
  }

  const deletingSelectedTask = state.selectedTask?.name === taskName;
  state.deletingTaskName = taskName;
  renderTasks();
  setMessage(`正在删除 task ${taskName} ...`);

  try {
    await api(`/api/tasks/${taskName}`, {
      method: "DELETE",
    });

    if (deletingSelectedTask) {
      clearTaskWorkspaceState();
    }

    await loadTasks();

    if (!state.selectedTask) {
      renderTasks();
      renderRuns();
      renderSummary();
      renderTaskSpec();
      renderArtifacts();
      renderReviews();
    } else if (deletingSelectedTask) {
      await selectTask(state.selectedTask.name, { activateTaskTab: true });
    } else {
      renderTasks();
      renderSummary();
    }

    setMessage(`已删除 task ${taskName}`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    state.deletingTaskName = null;
    renderTasks();
  }
}

async function createTask() {
  if (state.creatingTask || state.loadingCommand) {
    return;
  }

  const taskName = window.prompt("输入新 task 名称（建议使用小写字母、数字、-、_）");
  if (taskName == null) {
    return;
  }

  const normalizedName = taskName.trim();
  if (!normalizedName) {
    setMessage("task 名称不能为空。", "error");
    return;
  }

  state.creatingTask = true;
  renderTasks();
  setMessage(`正在创建 task ${normalizedName} ...`);

  try {
    const payload = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify(createDefaultTaskConfig(normalizedName)),
    });
    await loadTasks();
    await selectTask(payload.task.name, { activateTaskTab: true });
    enterTaskConfigEditMode();
    setMessage(`已创建 task ${payload.task.name}，请继续完善配置。`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    state.creatingTask = false;
    renderTasks();
  }
}

function enterTaskConfigEditMode() {
  return taskSpecModule.enterTaskConfigEditMode();
}

function cancelTaskConfigEditMode() {
  return taskSpecModule.cancelTaskConfigEditMode();
}

async function refreshAll() {
  setMessage("正在刷新工作台...");
  try {
    const preserveRunSelection = !!state.selectedRunId;
    await loadGlobalLlmSettings();
    await loadTasks();
    if (state.selectedTask) {
      await selectTask(state.selectedTask.name, { preserveRunSelection, activateTaskTab: false });
    } else {
      renderTaskSpec();
    }
    setMessage("已刷新", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

taskSpecModule.bindEvents();

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
createTaskButton.addEventListener("click", createTask);
artifactsModule.bindEvents();
reviewModule.bindEvents();

renderWorkbenchTabs();

refreshAll().catch((error) => {
  setMessage(error.message, "error");
});
