import React from "react";

import {
  DIFFICULTY_OPTIONS,
  DIALOGUE_STAGE_OPTIONS,
  RUNTIME_STAGE_META,
} from "../../constants/app.js";
import {
  coerceRuntimeCustomEntryInput,
  estimateScenarioSamples,
  formatDialogueStageLabel,
  getGlobalProviderSettings,
  getProviderModelOptions,
  getProviderReadyLabel,
  getRuntimeCustomEntries,
  getRuntimeCustomEntryInputValue,
  getRuntimeFieldCatalog,
  getRuntimeProviderMeta,
  getRuntimeProviders,
  totalEstimatedSamples,
} from "../../lib/taskConfig.js";
import { classNames, deepClone, formatMetricValue } from "../../lib/utils.js";

function buildPromptMeta(text) {
  const value = text || "";
  return {
    lines: value.split("\n").length,
    chars: value.length,
    words: value.trim().split(/\s+/).filter(Boolean).length,
  };
}

export default function TaskConfigWorkspace({
  taskConfigDraft,
  isEditingTaskConfig,
  setIsEditingTaskConfig,
  editingTaskConfigCard,
  setEditingTaskConfigCard,
  taskConfigBaseline,
  setTaskConfigDraft,
  setPromptFocus,
  setFlashMessage,
  savingTaskConfigCard,
  onSaveTaskConfig,
  onRevertTaskConfigCard,
  configSummaryCards,
  taskConfigDirty,
  configAdvice,
  runtimeDraft,
  exportsDraft,
  rulesDraft,
  scenariosDraft,
  runtimeCatalog,
  settings,
  llmTests,
  expandedRuntimeStages,
  toggleRuntimeStageExpanded,
  applyRuntimePresetToStage,
  updateRuntimeStage,
  addRuntimeCustomEntry,
  getRuntimeCustomEntryMode,
  getRuntimeCustomEntryResolvedType,
  updateRuntimeCustomEntryMode,
  updateRuntimeCustomEntry,
  updateTaskConfigJsonField,
  promptFocus,
  labelDraftList,
  addScenarioCard,
  updateScenarioAt,
  removeScenarioCard,
}) {
  const generatorPromptMeta = buildPromptMeta(taskConfigDraft.generatorPrompt);
  const teacherPromptMeta = buildPromptMeta(taskConfigDraft.teacherPrompt);
  const promptPanels = {
    generator: {
      label: "Generator Prompt",
      text: taskConfigDraft.generatorPrompt,
      meta: generatorPromptMeta,
    },
    teacher: {
      label: "Teacher Prompt",
      text: taskConfigDraft.teacherPrompt,
      meta: teacherPromptMeta,
    },
  };
  const activePromptPanel = promptPanels[promptFocus] || promptPanels.generator;
  const isCardSaving = (cardKey) => savingTaskConfigCard === cardKey;
  const isCardEditing = (cardKey) => editingTaskConfigCard === cardKey;
  const hasActiveEditingCard = Boolean(editingTaskConfigCard);
  const canEditCard = (cardKey) => !hasActiveEditingCard || isCardEditing(cardKey);
  const isCardLocked = (cardKey) => !isCardEditing(cardKey);

  function renderCardActions(cardKey, saveLabel = "保存本卡片", options = {}) {
    const { onStartEdit } = options;
    if (!isCardEditing(cardKey)) {
      return (
        <div className="section-inline-actions">
          <button
            className="ghost-button card-action-button card-edit-button"
            type="button"
            disabled={hasActiveEditingCard || Boolean(savingTaskConfigCard)}
            onClick={() => {
              setEditingTaskConfigCard(cardKey);
              if (!isEditingTaskConfig) {
                setIsEditingTaskConfig(true);
              }
              onStartEdit?.();
            }}
          >
            编辑
          </button>
        </div>
      );
    }
    return (
      <div className="section-inline-actions">
        <button
          className="ghost-button card-action-button card-revert-button"
          type="button"
          disabled={Boolean(savingTaskConfigCard)}
          onClick={() => {
            onRevertTaskConfigCard(cardKey);
            setEditingTaskConfigCard("");
          }}
        >
          回退本卡片
        </button>
        <button
          className="primary-button card-action-button card-save-button"
          type="button"
          disabled={Boolean(savingTaskConfigCard)}
          onClick={() => onSaveTaskConfig(cardKey)}
        >
          {isCardSaving(cardKey) ? "保存中..." : saveLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="panel-grid">
      <section className="panel panel-wide">
        <div className="section-head">
          <div>
            <span className="eyebrow">Task Definition</span>
            <h2>任务配置</h2>
          </div>
          <div className="section-inline-actions">
            {isEditingTaskConfig ? (
              <>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    if (taskConfigDirty) {
                      setFlashMessage("请先保存或回退当前卡片改动，再退出编辑态", "warning");
                      return;
                    }
                    setEditingTaskConfigCard("");
                    setPromptFocus("generator");
                    setIsEditingTaskConfig(false);
                  }}
                >
                  返回只读
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={Boolean(savingTaskConfigCard)}
                  onClick={() => {
                    setTaskConfigDraft(deepClone(taskConfigBaseline));
                    setEditingTaskConfigCard("");
                    setPromptFocus("generator");
                    setIsEditingTaskConfig(false);
                    setFlashMessage("已放弃全部未保存改动", "warning");
                  }}
                >
                  放弃全部改动
                </button>
              </>
            ) : (
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setEditingTaskConfigCard("");
                  setPromptFocus("generator");
                  setIsEditingTaskConfig(true);
                }}
              >
                编辑配置
              </button>
            )}
          </div>
        </div>

        {!isEditingTaskConfig ? (
          <div className="task-dossier">
            <article className="config-panel-card">
              <div className="artifact-record-head">
                <div>
                  <span className="eyebrow">Task Dossier</span>
                  <h3>{taskConfigDraft.task.name}</h3>
                  <p>先用摘要判断这份 task 定义是否健康，再决定是否进入编辑态。</p>
                </div>
                <span className="micro-chip">{taskConfigDraft.task.language}</span>
              </div>
              <div className="artifact-key-grid">
                {[
                  ["theme", taskConfigDraft.task.theme],
                  ["task_type", taskConfigDraft.task.task_type],
                  ["entry_schema", taskConfigDraft.task.entry_schema],
                  ["estimated_sample_count", totalEstimatedSamples(scenariosDraft)],
                ].map(([label, value]) => (
                  <div key={label} className="artifact-key-card">
                    <strong>{label}</strong>
                    <span>{formatMetricValue(label, value)}</span>
                  </div>
                ))}
              </div>
            </article>

            <div className="summary-chip-row">
              {configSummaryCards.map((item) => (
                <article key={item.label} className="summary-chip">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
              <article className="summary-chip is-success">
                <span>status</span>
                <strong>只读摘要</strong>
              </article>
            </div>

            <article className="config-panel-card prompt-view-card prompt-view-card-readonly">
              <div className="artifact-record-head">
                <div>
                  <span className="eyebrow">Prompt Focus</span>
                  <h3>Prompt View</h3>
                  <p>先确认 generator / teacher prompt 的语气、边界和任务 framing，再决定是否进入编辑态。</p>
                </div>
                <span className="micro-chip">只读主视图</span>
              </div>
              <div className="segmented-control">
                <button
                  className={classNames("ghost-button", promptFocus === "generator" && "is-active")}
                  type="button"
                  aria-pressed={promptFocus === "generator"}
                  onClick={() => setPromptFocus("generator")}
                >
                  Generator Prompt
                </button>
                <button
                  className={classNames("ghost-button", promptFocus === "teacher" && "is-active")}
                  type="button"
                  aria-pressed={promptFocus === "teacher"}
                  onClick={() => setPromptFocus("teacher")}
                >
                  Teacher Prompt
                </button>
              </div>
              <div className="summary-chip-row">
                <article className="summary-chip">
                  <span>lines</span>
                  <strong>{activePromptPanel.meta.lines}</strong>
                </article>
                <article className="summary-chip">
                  <span>chars</span>
                  <strong>{activePromptPanel.meta.chars}</strong>
                </article>
                <article className="summary-chip">
                  <span>words</span>
                  <strong>{activePromptPanel.meta.words}</strong>
                </article>
              </div>
              <div className="prompt-view-shell">
                <div className="prompt-view-shell-head">
                  <span>{activePromptPanel.label}</span>
                  <strong>当前生效文本</strong>
                </div>
                <div className="prompt-view-body" role="textbox" aria-readonly="true">
                  {activePromptPanel.text || "当前没有 prompt 内容。"}
                </div>
              </div>
            </article>

            <div className="config-advice-grid">
              <article className="config-panel-card">
                <div className="artifact-record-head">
                  <h3>Impact</h3>
                  <span className="micro-chip">运行影响</span>
                </div>
                <div className="config-bullet-list">
                  <span>{`generate 预计产出 ${totalEstimatedSamples(scenariosDraft)} 条候选样本`}</span>
                  <span>{`teacher/eval 默认 provider: ${runtimeDraft.teacher?.provider || "-"} / ${runtimeDraft.eval?.provider || "-"}`}</span>
                  <span>{`student format: ${exportsDraft.student_format || "-"}`}</span>
                </div>
              </article>
              <article className="config-panel-card">
                <div className="artifact-record-head">
                  <h3>Advice</h3>
                  <span className="micro-chip">判断辅助</span>
                </div>
                <div className="config-bullet-list">
                  {(configAdvice.length ? configAdvice : ["当前配置没有明显风险项。"]).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </article>
            </div>

            <div className="runtime-stage-stack">
              {Object.entries(RUNTIME_STAGE_META).map(([stage, meta]) => {
                const stageConfig = runtimeDraft?.[stage] || {};
                const providerMeta = getRuntimeProviderMeta(runtimeCatalog, stageConfig.provider);
                const globalProvider = getGlobalProviderSettings(settings, stageConfig.provider);
                return (
                  <article key={stage} className="config-panel-card runtime-stage-card">
                    <div className="artifact-record-head">
                      <div>
                        <span className="eyebrow">{meta.eyebrow}</span>
                        <h3>{meta.title}</h3>
                        <p>{meta.description}</p>
                      </div>
                      <div className="card-head-actions">
                        <span className="micro-chip">{meta.index}</span>
                        {renderCardActions(`runtime-${stage}`, "保存本阶段", {
                          onStartEdit: () => {
                            if (!expandedRuntimeStages[stage]) {
                              toggleRuntimeStageExpanded(stage);
                            }
                          },
                        })}
                      </div>
                    </div>
                    <div className="artifact-key-grid">
                      {[
                        ["provider", stageConfig.provider || "-"],
                        ["model", stageConfig.model || "-"],
                        ["global_status", globalProvider ? getProviderReadyLabel(globalProvider, llmTests[globalProvider.name]) : "无全局映射"],
                        ["advanced_fields", Math.max(0, Object.keys(stageConfig).length - 2)],
                      ].map(([label, value]) => (
                        <div key={`${stage}-${label}`} className="artifact-key-card">
                          <strong>{label}</strong>
                          <span>{formatMetricValue(label, value)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="config-bullet-list compact-list">
                      <span>{providerMeta?.description || "当前 stage 还没有绑定 provider。"}</span>
                      <span>
                        {stageConfig.provider
                          ? "如需改 provider、模型或高级参数，再进入编辑态。"
                          : "当前 stage 未配置 provider，进入编辑态后可用 provider chips 快速补齐。"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="config-advice-grid">
              <article className="config-panel-card">
                <div className="artifact-record-head">
                  <h3>Label Set</h3>
                  <span className="micro-chip">只读摘要</span>
                </div>
                <div className="config-bullet-list">
                  {labelDraftList.length ? (
                    labelDraftList.map((label) => <span key={label}>{label}</span>)
                  ) : (
                    <span>当前没有 labels。</span>
                  )}
                </div>
              </article>

              <article className="config-panel-card">
                <div className="artifact-record-head">
                  <h3>Rules & Exports</h3>
                  <span className="micro-chip">只读摘要</span>
                </div>
                <div className="config-bullet-list">
                  <span>{`disallow_rewrite_without_visible_report: ${formatMetricValue("rule", rulesDraft.disallow_rewrite_without_visible_report)}`}</span>
                  <span>{`train_format: ${exportsDraft.train_format || "-"}`}</span>
                  <span>{`eval_format: ${exportsDraft.eval_format || "-"}`}</span>
                  <span>{`student_format: ${exportsDraft.student_format || "-"}`}</span>
                </div>
              </article>
            </div>

            <article className="config-panel-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Scenario Matrix</span>
                  <h2>Scenario 摘要</h2>
                </div>
                <span className="micro-chip">{`${scenariosDraft.length} scenarios`}</span>
              </div>
              <div className="scenario-card-grid">
                {scenariosDraft.map((scenario, index) => (
                  <article key={`scenario-readonly-${index}`} className="scenario-card">
                    <div className="artifact-record-head">
                      <div>
                        <h3>{scenario.intent || `scenario-${index + 1}`}</h3>
                        <p>{`预计样本数 ${estimateScenarioSamples(scenario)} 条`}</p>
                      </div>
                      <span className="micro-chip">{scenario.difficulty || "medium"}</span>
                    </div>
                    <div className="artifact-key-grid">
                      {[
                        ["dialogue_stage", scenario.context?.dialogue_stage || "-"],
                        ["has_visible_report", scenario.context?.has_visible_report],
                        ["tags", (scenario.tags || []).join(", ") || "-"],
                        ["templates", scenario.templates?.length || 0],
                      ].map(([label, value]) => (
                        <div key={`readonly-${index}-${label}`} className="artifact-key-card">
                          <strong>{label}</strong>
                          <span>{formatMetricValue(label, value)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="config-bullet-list compact-list">
                      <span>{scenario.context?.previous_report_summary || "无 previous_report_summary。"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </article>
          </div>
        ) : (
          <div className="task-dossier">
            <article className="config-panel-card">
              <div className="artifact-record-head">
                <div>
                  <span className="eyebrow">Task Dossier</span>
                  <h3>{taskConfigDraft.task.name}</h3>
                </div>
                <div className="card-head-actions">
                  <span className="micro-chip">{taskConfigDraft.task.language}</span>
                  {renderCardActions("task")}
                </div>
              </div>
              <div className="artifact-key-grid">
                {[
                  ["theme", taskConfigDraft.task.theme],
                  ["task_type", taskConfigDraft.task.task_type],
                  ["entry_schema", taskConfigDraft.task.entry_schema],
                  ["estimated_sample_count", totalEstimatedSamples(scenariosDraft)],
                ].map(([label, value]) => (
                  <div key={label} className="artifact-key-card">
                    <strong>{label}</strong>
                    <span>{formatMetricValue(label, value)}</span>
                  </div>
                ))}
              </div>
              <div className="config-grid">
                <label>
                  <span>Task Name</span>
                  <input
                    type="text"
                    value={taskConfigDraft.task.name}
                    disabled={isCardLocked("task")}
                    onChange={(event) =>
                      setTaskConfigDraft((current) => ({
                        ...current,
                        task: { ...current.task, name: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Theme</span>
                  <input
                    type="text"
                    value={taskConfigDraft.task.theme}
                    disabled={isCardLocked("task")}
                    onChange={(event) =>
                      setTaskConfigDraft((current) => ({
                        ...current,
                        task: { ...current.task, theme: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Language</span>
                  <input
                    type="text"
                    value={taskConfigDraft.task.language}
                    disabled={isCardLocked("task")}
                    onChange={(event) =>
                      setTaskConfigDraft((current) => ({
                        ...current,
                        task: { ...current.task, language: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Task Type</span>
                  <input
                    type="text"
                    value={taskConfigDraft.task.task_type}
                    disabled={isCardLocked("task")}
                    onChange={(event) =>
                      setTaskConfigDraft((current) => ({
                        ...current,
                        task: { ...current.task, task_type: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Entry Schema</span>
                  <input
                    type="text"
                    value={taskConfigDraft.task.entry_schema}
                    disabled={isCardLocked("task")}
                    onChange={(event) =>
                      setTaskConfigDraft((current) => ({
                        ...current,
                        task: { ...current.task, entry_schema: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            </article>

            <div className="summary-chip-row">
              {configSummaryCards.map((item) => (
                <article key={item.label} className="summary-chip">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
              <article
                className={classNames("summary-chip", taskConfigDirty ? "is-warning" : "is-success")}
              >
                <span>status</span>
                <strong>{taskConfigDirty ? "有未保存改动" : "配置已同步"}</strong>
              </article>
            </div>

            <div className="config-advice-grid">
              <article className="config-panel-card">
                <div className="artifact-record-head">
                  <h3>Impact</h3>
                  <span className="micro-chip">运行影响</span>
                </div>
                <div className="config-bullet-list">
                  <span>{`generate 预计产出 ${totalEstimatedSamples(scenariosDraft)} 条候选样本`}</span>
                  <span>{`teacher/eval 默认 provider: ${runtimeDraft.teacher?.provider || "-"} / ${runtimeDraft.eval?.provider || "-"}`}</span>
                  <span>{`student format: ${exportsDraft.student_format || "-"}`}</span>
                </div>
              </article>
              <article className="config-panel-card">
                <div className="artifact-record-head">
                  <h3>Advice</h3>
                  <span className="micro-chip">判断辅助</span>
                </div>
                <div className="config-bullet-list">
                  {(configAdvice.length ? configAdvice : ["当前配置没有明显风险项。"]).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </article>
            </div>

            <div className="runtime-stage-stack">
              {Object.entries(RUNTIME_STAGE_META).map(([stage, meta]) => {
                const stageConfig = runtimeDraft?.[stage] || {};
                const providerOptions = getRuntimeProviders(runtimeCatalog);
                const providerMeta = getRuntimeProviderMeta(runtimeCatalog, stageConfig.provider);
                const modelOptions = getProviderModelOptions(runtimeCatalog, stageConfig.provider, stage);
                const commonFields = getRuntimeFieldCatalog(runtimeCatalog).filter(
                  (field) => field.bucket === "common"
                );
                const providerFields = getRuntimeFieldCatalog(runtimeCatalog).filter((field) =>
                  (providerMeta?.provider_fields || []).includes(field.key)
                );
                const customEntries = getRuntimeCustomEntries(
                  runtimeCatalog,
                  stageConfig.provider,
                  stageConfig
                );
                const globalProvider = getGlobalProviderSettings(settings, stageConfig.provider);
                const stageCardKey = `runtime-${stage}`;
                const stageLocked = isCardLocked(stageCardKey);
                return (
                  <article
                    key={stage}
                    className={classNames(
                      "config-panel-card",
                      "runtime-stage-card",
                      isCardEditing(stageCardKey) && "is-editing"
                    )}
                  >
                    <div className="artifact-record-head">
                      <div>
                        <span className="eyebrow">{meta.eyebrow}</span>
                        <h3>{meta.title}</h3>
                        <p>{meta.description}</p>
                      </div>
                      <div className="card-head-actions">
                        <span className="micro-chip">{meta.index}</span>
                        {renderCardActions(stageCardKey, "保存本阶段", {
                          onStartEdit: () => {
                            if (!expandedRuntimeStages[stage]) {
                              toggleRuntimeStageExpanded(stage);
                            }
                          },
                        })}
                      </div>
                    </div>

                    {isCardEditing(stageCardKey) ? (
                      <div className="runtime-editing-banner">
                        <span className="micro-chip">编辑中</span>
                        <p>当前卡片已解锁，provider、model 和高级参数现在可直接修改并单卡保存。</p>
                      </div>
                    ) : null}

                    <div className="runtime-provider-row">
                      {providerOptions.map((provider) => (
                        <button
                          key={`${stage}-${provider.name}`}
                          className={classNames(
                            "provider-chip",
                            stageConfig.provider === provider.name && "is-active"
                          )}
                          type="button"
                          aria-pressed={stageConfig.provider === provider.name}
                          disabled={!canEditCard(stageCardKey) || stageLocked}
                          onClick={() => applyRuntimePresetToStage(stage, provider.name, "recommended")}
                        >
                          <strong>{provider.label}</strong>
                          <span>{provider.badge}</span>
                        </button>
                      ))}
                    </div>

                    <div className="runtime-status-row">
                      <span className="micro-chip">{providerMeta?.description || "未选择 provider"}</span>
                      <span className="micro-chip">
                        {globalProvider
                          ? `global: ${getProviderReadyLabel(globalProvider, llmTests[globalProvider.name])}`
                          : "无全局映射"}
                      </span>
                    </div>

                    <div className="runtime-action-row">
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!stageConfig.provider || stageLocked}
                        onClick={() => applyRuntimePresetToStage(stage, stageConfig.provider, "global")}
                      >
                        套用全局配置
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!stageConfig.provider || stageLocked}
                        onClick={() => applyRuntimePresetToStage(stage, stageConfig.provider, "recommended")}
                      >
                        套用推荐配置
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={stageLocked}
                        onClick={() => toggleRuntimeStageExpanded(stage)}
                      >
                        {expandedRuntimeStages[stage] ? "收起高级参数" : "展开高级参数"}
                      </button>
                    </div>

                    <div className="runtime-model-row">
                      {modelOptions.length ? (
                        modelOptions.map((model) => (
                          <button
                            key={`${stage}-${model.value}`}
                            className={classNames(
                              "model-chip",
                              stageConfig.model === model.value && "is-active",
                              model.recommended && "is-recommended"
                            )}
                            type="button"
                            aria-pressed={stageConfig.model === model.value}
                            disabled={stageLocked}
                            onClick={() =>
                              updateRuntimeStage(stage, (current) => ({
                                ...current,
                                model: model.value,
                              }))
                            }
                          >
                            <strong>{model.label || model.value}</strong>
                            <span>{model.recommended ? "recommended" : "available"}</span>
                          </button>
                        ))
                      ) : (
                        <span className="muted-text">当前 provider 没有可用模型目录</span>
                      )}
                    </div>

                    {expandedRuntimeStages[stage] ? (
                      <>
                        <div className="config-grid">
                          {[...commonFields, ...providerFields].map((field) => (
                            <label key={`${stage}-${field.key}`}>
                              <span>{field.label}</span>
                              {field.type === "boolean" ? (
                                <select
                                  value={
                                    stageConfig[field.key] === true
                                      ? "true"
                                      : stageConfig[field.key] === false
                                        ? "false"
                                        : ""
                                  }
                                  disabled={stageLocked}
                                  onChange={(event) =>
                                    updateRuntimeStage(stage, (current) => ({
                                      ...current,
                                      [field.key]:
                                        event.target.value === ""
                                          ? ""
                                          : event.target.value === "true",
                                    }))
                                  }
                                >
                                  <option value="">未设置</option>
                                  <option value="true">true</option>
                                  <option value="false">false</option>
                                </select>
                              ) : field.type === "env-select" ? (
                                <>
                                  <select
                                    value={stageConfig[field.key] ?? ""}
                                    disabled={stageLocked}
                                    onChange={(event) =>
                                      updateRuntimeStage(stage, (current) => ({
                                        ...current,
                                        [field.key]: event.target.value,
                                      }))
                                    }
                                  >
                                    <option value="">未设置</option>
                                    {Array.from(
                                      new Set([
                                        ...(providerMeta?.env_options?.[field.key] || []),
                                        stageConfig[field.key],
                                      ].filter(Boolean))
                                    ).map((option) => (
                                      <option key={`${stage}-${field.key}-${option}`} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                  <small className="field-hint">
                                    {providerMeta?.env_options?.[field.key]?.length
                                      ? `推荐 env key: ${providerMeta.env_options[field.key].join(" / ")}`
                                      : "可通过“套用全局配置”直接回填 env key。"}
                                  </small>
                                </>
                              ) : (
                                <input
                                  type={field.type === "number" ? "number" : "text"}
                                  step={field.step || (field.type === "number" ? "1" : undefined)}
                                  min={field.min}
                                  max={field.max}
                                  value={stageConfig[field.key] ?? ""}
                                  disabled={stageLocked}
                                  onChange={(event) =>
                                    updateRuntimeStage(stage, (current) => ({
                                      ...current,
                                      [field.key]:
                                        field.type === "number"
                                          ? event.target.value === ""
                                            ? ""
                                            : Number(event.target.value)
                                          : event.target.value,
                                    }))
                                  }
                                />
                              )}
                            </label>
                          ))}
                        </div>

                        <article className="config-panel-card nested-card">
                          <div className="artifact-record-head">
                            <div>
                              <h3>Custom Runtime Entries</h3>
                              <p>
                                保留 catalog 之外的自定义字段。Auto 模式会把 `true` / `false` /
                                数字自动识别成真实类型。
                              </p>
                            </div>
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={stageLocked}
                              onClick={() => addRuntimeCustomEntry(stage)}
                            >
                              新增字段
                            </button>
                          </div>
                          {customEntries.length ? (
                            <div className="runtime-custom-list">
                              {customEntries.map(([key, value]) => {
                                const customMode = getRuntimeCustomEntryMode(stage, key);
                                const resolvedType = getRuntimeCustomEntryResolvedType(stage, key, value);
                                const complexValue = resolvedType === "json";
                                return (
                                  <div key={`${stage}-${key}`} className="runtime-custom-item">
                                    <div className="runtime-custom-row">
                                      <label className="runtime-custom-field">
                                        <span>Key</span>
                                        <input
                                          type="text"
                                          value={key}
                                          disabled={stageLocked}
                                          onChange={(event) =>
                                            updateRuntimeCustomEntry(stage, key, event.target.value, value)
                                          }
                                        />
                                      </label>
                                      <label className="runtime-custom-field runtime-custom-mode">
                                        <span>Value Mode</span>
                                        {complexValue ? (
                                          <input
                                            type="text"
                                            value="json only"
                                            readOnly
                                            disabled={stageLocked}
                                          />
                                        ) : (
                                          <select
                                            value={customMode}
                                            disabled={stageLocked}
                                            onChange={(event) =>
                                              updateRuntimeCustomEntryMode(
                                                stage,
                                                key,
                                                event.target.value,
                                                value
                                              )
                                            }
                                          >
                                            <option value="auto">Auto Detect</option>
                                            <option value="text">Text</option>
                                            <option value="number">Number</option>
                                            <option value="boolean">Boolean</option>
                                          </select>
                                        )}
                                      </label>
                                      <label className="runtime-custom-field runtime-custom-value-field">
                                        <span>Value</span>
                                        {complexValue ? (
                                          <textarea
                                            rows="3"
                                            value={getRuntimeCustomEntryInputValue(value, "json")}
                                            readOnly
                                            disabled={stageLocked}
                                          />
                                        ) : resolvedType === "boolean" ? (
                                          <select
                                            value={getRuntimeCustomEntryInputValue(value, "boolean")}
                                            disabled={stageLocked}
                                            onChange={(event) =>
                                              updateRuntimeCustomEntry(
                                                stage,
                                                key,
                                                key,
                                                coerceRuntimeCustomEntryInput(
                                                  event.target.value,
                                                  "boolean"
                                                )
                                              )
                                            }
                                          >
                                            <option value="">未设置</option>
                                            <option value="true">true</option>
                                            <option value="false">false</option>
                                          </select>
                                        ) : (
                                          <input
                                            type={customMode === "number" ? "number" : "text"}
                                            value={getRuntimeCustomEntryInputValue(value, resolvedType)}
                                            disabled={stageLocked}
                                            onChange={(event) =>
                                              updateRuntimeCustomEntry(
                                                stage,
                                                key,
                                                key,
                                                coerceRuntimeCustomEntryInput(
                                                  event.target.value,
                                                  customMode
                                                )
                                              )
                                            }
                                          />
                                        )}
                                      </label>
                                      <button
                                        className="danger-link"
                                        type="button"
                                        disabled={stageLocked}
                                        onClick={() => updateRuntimeCustomEntry(stage, key, "", "")}
                                      >
                                        删除
                                      </button>
                                    </div>
                                    <div className="runtime-custom-meta">
                                      <span className="micro-chip">
                                        {customMode === "auto"
                                          ? `auto -> ${resolvedType}`
                                          : `stored as ${resolvedType}`}
                                      </span>
                                      <span className="muted-text">
                                        {complexValue
                                          ? "复杂对象建议切到 Raw Fallback 统一编辑，避免半结构化改坏。"
                                          : customMode === "auto"
                                            ? "数字和布尔值会按真实类型写入 runtime，而不是只当字符串保存。"
                                            : "已按显式类型写入，适合保留编号、阈值或布尔开关的语义。"}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="empty-board compact">
                              <strong>当前没有额外 runtime 字段</strong>
                              <p>如需 catalog 之外的参数，可以先在这里补充；复杂对象再切到 Raw Fallback。</p>
                            </div>
                          )}
                        </article>
                      </>
                      ) : null}
                  </article>
                );
              })}
            </div>

            <div className="config-advice-grid config-advice-grid-priority">
              <article className="config-panel-card">
                <div className="artifact-record-head">
                  <div>
                    <h3>Rules & Exports</h3>
                    <span className="micro-chip">运行规则</span>
                  </div>
                  {renderCardActions("rules-exports")}
                </div>
                <div className="config-grid">
                  <label>
                    <span>Disallow Rewrite Without Report</span>
                    <select
                      value={rulesDraft.disallow_rewrite_without_visible_report ? "true" : "false"}
                      disabled={isCardLocked("rules-exports")}
                      onChange={(event) =>
                        updateTaskConfigJsonField(
                          "rulesText",
                          (rules) => ({
                            ...rules,
                            disallow_rewrite_without_visible_report: event.target.value === "true",
                          }),
                          {}
                        )
                      }
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>
                  <label>
                    <span>Train Format</span>
                    <input
                      type="text"
                      value={exportsDraft.train_format || ""}
                      disabled={isCardLocked("rules-exports")}
                      onChange={(event) =>
                        updateTaskConfigJsonField(
                          "exportsText",
                          (exportsConfig) => ({ ...exportsConfig, train_format: event.target.value }),
                          {}
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Eval Format</span>
                    <input
                      type="text"
                      value={exportsDraft.eval_format || ""}
                      disabled={isCardLocked("rules-exports")}
                      onChange={(event) =>
                        updateTaskConfigJsonField(
                          "exportsText",
                          (exportsConfig) => ({ ...exportsConfig, eval_format: event.target.value }),
                          {}
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Student Format</span>
                    <input
                      type="text"
                      value={exportsDraft.student_format || ""}
                      disabled={isCardLocked("rules-exports")}
                      onChange={(event) =>
                        updateTaskConfigJsonField(
                          "exportsText",
                          (exportsConfig) => ({ ...exportsConfig, student_format: event.target.value }),
                          {}
                        )
                      }
                    />
                  </label>
                </div>
                <label className="config-textarea-block">
                  <span>Labels</span>
                  <textarea
                    className="config-textarea config-textarea-compact"
                    rows="5"
                    value={taskConfigDraft.labelsText}
                    disabled={isCardLocked("rules-exports")}
                    onChange={(event) =>
                      setTaskConfigDraft((current) => ({ ...current, labelsText: event.target.value }))
                    }
                  />
                </label>
              </article>

              <article className="config-panel-card prompt-view-card">
                <div className="artifact-record-head">
                  <div>
                    <h3>Prompt View</h3>
                    <span className="micro-chip">双视图</span>
                  </div>
                  {renderCardActions("prompt-view")}
                </div>
                <div className="segmented-control">
                  <button
                    className={classNames("ghost-button", promptFocus === "generator" && "is-active")}
                    type="button"
                    aria-pressed={promptFocus === "generator"}
                    disabled={!canEditCard("prompt-view")}
                    onClick={() => setPromptFocus("generator")}
                  >
                    Generator Prompt
                  </button>
                  <button
                    className={classNames("ghost-button", promptFocus === "teacher" && "is-active")}
                    type="button"
                    aria-pressed={promptFocus === "teacher"}
                    disabled={!canEditCard("prompt-view")}
                    onClick={() => setPromptFocus("teacher")}
                  >
                    Teacher Prompt
                  </button>
                </div>
                <div className="summary-chip-row">
                  <article className="summary-chip">
                    <span>lines</span>
                    <strong>{activePromptPanel.meta.lines}</strong>
                  </article>
                  <article className="summary-chip">
                    <span>chars</span>
                    <strong>{activePromptPanel.meta.chars}</strong>
                  </article>
                  <article className="summary-chip">
                    <span>words</span>
                    <strong>{activePromptPanel.meta.words}</strong>
                  </article>
                </div>
                <label className="config-textarea-block">
                  <span>{activePromptPanel.label}</span>
                  <textarea
                    className="config-textarea config-textarea-prompt"
                    rows="14"
                    value={activePromptPanel.text}
                    disabled={isCardLocked("prompt-view")}
                    onChange={(event) =>
                      setTaskConfigDraft((current) => ({
                        ...current,
                        [promptFocus === "generator" ? "generatorPrompt" : "teacherPrompt"]:
                          event.target.value,
                      }))
                    }
                  />
                </label>
              </article>
            </div>

            <article className="config-panel-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Scenario Matrix</span>
                  <h2>Scenario Cards</h2>
                </div>
                <div className="section-inline-actions">
                  {isCardEditing("scenarios") ? (
                    <>
                      <button className="ghost-button" type="button" onClick={addScenarioCard}>
                        新增 Scenario
                      </button>
                      <button
                        className="ghost-button card-action-button card-revert-button"
                        type="button"
                        disabled={Boolean(savingTaskConfigCard)}
                        onClick={() => {
                          onRevertTaskConfigCard("scenarios");
                          setEditingTaskConfigCard("");
                        }}
                      >
                        回退本卡片
                      </button>
                      <button
                        className="primary-button card-action-button card-save-button"
                        type="button"
                        disabled={Boolean(savingTaskConfigCard)}
                        onClick={() => onSaveTaskConfig("scenarios")}
                      >
                        {isCardSaving("scenarios") ? "保存中..." : "保存本卡片"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="ghost-button card-action-button card-edit-button"
                      type="button"
                      disabled={hasActiveEditingCard || Boolean(savingTaskConfigCard)}
                      onClick={() => setEditingTaskConfigCard("scenarios")}
                    >
                      编辑
                    </button>
                  )}
                </div>
              </div>
              <div className="scenario-card-grid">
                {scenariosDraft.map((scenario, index) => (
                  <article key={`scenario-${index}`} className="scenario-card">
                    <div className="artifact-record-head">
                      <div>
                        <h3>{scenario.intent || `scenario-${index + 1}`}</h3>
                        <p>{`预计样本数 ${estimateScenarioSamples(scenario)} 条`}</p>
                      </div>
                      {scenariosDraft.length > 1 ? (
                        <button
                          className="danger-link"
                          type="button"
                          disabled={isCardLocked("scenarios")}
                          onClick={() => removeScenarioCard(index)}
                        >
                          删除
                        </button>
                      ) : (
                        <span className="micro-chip">{`#${index + 1}`}</span>
                      )}
                    </div>
                    <div className="config-grid scenario-compact-grid">
                      <label>
                        <span>Intent</span>
                        <input
                          type="text"
                          value={scenario.intent || ""}
                          list={`scenario-labels-${index}`}
                          disabled={isCardLocked("scenarios")}
                          onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              intent: event.target.value,
                            }))
                          }
                        />
                        <datalist id={`scenario-labels-${index}`}>
                          {labelDraftList.map((label) => (
                            <option key={label} value={label} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        <span>Difficulty</span>
                          <select
                            value={scenario.difficulty || "medium"}
                            disabled={isCardLocked("scenarios")}
                            onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              difficulty: event.target.value,
                            }))
                          }
                        >
                          {DIFFICULTY_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Generation Count</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={scenario.generation_count || estimateScenarioSamples(scenario)}
                            disabled={isCardLocked("scenarios")}
                            onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              generation_count: Number(event.target.value || 1),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Dialogue Stage</span>
                          <select
                            value={scenario.context?.dialogue_stage || "standalone"}
                            disabled={isCardLocked("scenarios")}
                            onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              context: {
                                ...(current.context || {}),
                                dialogue_stage: event.target.value,
                              },
                            }))
                          }
                        >
                          {DIALOGUE_STAGE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {formatDialogueStageLabel(option)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Has Visible Report</span>
                          <select
                            value={scenario.context?.has_visible_report ? "true" : "false"}
                            disabled={isCardLocked("scenarios")}
                            onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              context: {
                                ...(current.context || {}),
                                has_visible_report: event.target.value === "true",
                              },
                            }))
                          }
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </label>
                      <label>
                        <span>Language</span>
                          <input
                            type="text"
                            value={scenario.context?.language || taskConfigDraft.task.language || "zh"}
                            disabled={isCardLocked("scenarios")}
                            onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              context: {
                                ...(current.context || {}),
                                language: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="scenario-editor-fields">
                      <label className="config-textarea-block scenario-field-block">
                        <span>Tags</span>
                        <input
                          className="scenario-text-input"
                          type="text"
                          value={(scenario.tags || []).join(", ")}
                          disabled={isCardLocked("scenarios")}
                          onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              tags: event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            }))
                          }
                        />
                      </label>
                      <label className="config-textarea-block scenario-field-block">
                        <span>Previous Report Summary</span>
                        <textarea
                          className="config-textarea scenario-textarea scenario-textarea-summary"
                          rows="3"
                          value={scenario.context?.previous_report_summary || ""}
                          disabled={isCardLocked("scenarios")}
                          onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              context: {
                                ...(current.context || {}),
                                previous_report_summary: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="config-textarea-block scenario-field-block">
                        <span>Templates</span>
                        <textarea
                          className="config-textarea scenario-textarea scenario-textarea-templates"
                          rows="5"
                          value={(scenario.templates || []).join("\n")}
                          disabled={isCardLocked("scenarios")}
                          onChange={(event) =>
                            updateScenarioAt(index, (current) => ({
                              ...current,
                              templates: event.target.value
                                .split("\n")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </article>
          </div>
        )}
      </section>
    </div>
  );
}
