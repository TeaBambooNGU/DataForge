import React from "react";

import { PIPELINE_STAGE_META, STAGE_ACTIONS } from "../../constants/app.js";
import { classNames, formatDate } from "../../lib/utils.js";

const RUN_ALL_STAGE_COMMANDS = ["generate", "classify", "filter-export", "review-export"];

function buildChecklistItems(selectedRun, selectedRunCompletedStages, nextRecommendedCommand) {
  const orderedActions = STAGE_ACTIONS.filter((action) => action.command !== "run-all");
  return orderedActions.map((action) => {
    const stageKey = action.command.replaceAll("-", "_");
    const stagePayload = selectedRun?.stages?.[stageKey] || null;
    let status = "upcoming";

    if (action.command === "generate") {
      status = selectedRun?.run_id ? "done" : "current";
    } else if (!selectedRun?.run_id) {
      status = "blocked";
    } else if (selectedRunCompletedStages.has(stageKey)) {
      status = "done";
    } else if (nextRecommendedCommand === action.command) {
      status = "current";
    }

    return {
      ...action,
      stageKey,
      stagePayload,
      completedAt:
        stagePayload?.completed_at || (action.command === "generate" ? selectedRun?.created_at : null),
      status,
      summary:
        status === "done"
          ? "这一阶段已经完成，可以回看推荐 artifact。"
          : status === "current"
            ? PIPELINE_STAGE_META[action.command]?.actionHint || "这是当前最值得推进的一步。"
            : status === "blocked"
              ? "需要先创建 run，后续阶段才有上下文和产物。"
              : "先完成前置阶段，再推进这里，避免下游诊断失真。",
    };
  });
}

export default function OverviewWorkspace({
  selectedRun,
  nextRecommendedCommand,
  busyCommand,
  selectedRunCompletedStages,
  onRunCommand,
  onOpenArtifact,
}) {
  const checklistItems = buildChecklistItems(
    selectedRun,
    selectedRunCompletedStages,
    nextRecommendedCommand
  );
  const checklistByCommand = Object.fromEntries(
    checklistItems.map((item) => [item.command, item])
  );
  const runAllAction = STAGE_ACTIONS.find((action) => action.command === "run-all");
  const runAllCoveredStages = RUN_ALL_STAGE_COMMANDS.map((command) =>
    command === "generate" ? "generate" : command.replaceAll("-", "_")
  );
  const isRunAllComplete =
    !!selectedRun?.run_id &&
    runAllCoveredStages.every((stageKey) => selectedRunCompletedStages.has(stageKey));
  const isRunAllBusy = busyCommand === "run-all";
  const runAllDisabled = isRunAllBusy || isRunAllComplete;
  const runAllStatusLabel = isRunAllBusy ? "执行中" : isRunAllComplete ? "已完成前四阶段" : "批量推进";
  const runAllSummary = isRunAllComplete
    ? "当前 run 已经过了 generate、classify、filter-export、review-export，不需要再执行批量推进。"
    : "一键推进 generate -> classify -> filter-export -> review-export，适合新 run 快速走到人工复核入口。";
  const completedCount = Object.keys(selectedRun?.stages || {}).length;
  const finalTrainingArtifact = (selectedRun?.artifacts || []).find(
    (artifact) => artifact.exists && artifact.artifact_role === "final_sft_dataset"
  );
  const canonicalDatasetArtifact = (selectedRun?.artifacts || []).find(
    (artifact) => artifact.exists && artifact.artifact_role === "canonical_dataset"
  );
  const currentSuggestionLabel = !selectedRun?.run_id
    ? "先创建 Run"
    : STAGE_ACTIONS.find((item) => item.command === nextRecommendedCommand)?.label || "查看当前产物";

  return (
    <div className="panel-grid">
      <section className="panel panel-wide pipeline-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Pipeline</span>
            <h2>推进当前 Run</h2>
          </div>
          <span className="muted-text">{selectedRun?.run_id || "先创建 run"}</span>
        </div>
        <div className="summary-chip-row pipeline-summary-row">
          <article className="summary-chip">
            <span>当前状态</span>
            <strong>{selectedRun?.status || "idle"}</strong>
          </article>
          <article className="summary-chip">
            <span>已完成阶段</span>
            <strong>{completedCount}</strong>
          </article>
          <article className={classNames("summary-chip", nextRecommendedCommand && "is-warning")}>
            <span>当前建议</span>
            <strong>{currentSuggestionLabel}</strong>
          </article>
        </div>
        {!selectedRun?.run_id ? (
          <div className="next-step-banner is-calm">
            <div>
              <strong>先创建一个 Run</strong>
              <p>创建后才会有 artifacts、review pool 和后续诊断上下文。</p>
            </div>
          </div>
        ) : nextRecommendedCommand ? (
          <div className="next-step-banner">
            <div>
              <strong>
                {`推荐下一步: ${
                  STAGE_ACTIONS.find((item) => item.command === nextRecommendedCommand)?.label ||
                  nextRecommendedCommand
                }`}
              </strong>
              <p>{PIPELINE_STAGE_META[nextRecommendedCommand]?.actionHint || "继续推进当前 run。"}</p>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => onRunCommand(nextRecommendedCommand)}
            >
              执行推荐步骤
            </button>
          </div>
        ) : (
          <div className="next-step-banner is-calm">
            <div>
              <strong>当前 Run 已完成主流程</strong>
              <p>当前 run 已具备完整上下文，建议直接查看产物、评测结果或最终训练文件。</p>
            </div>
          </div>
        )}
        {runAllAction ? (
          <div className={classNames("batch-action-card", runAllDisabled && "is-disabled")}>
            <div className="batch-action-copy">
              <div className="command-card-top">
                <span>Batch Action</span>
                <em className="command-card-state">{runAllStatusLabel}</em>
              </div>
              <strong>{runAllAction.label}</strong>
              <p>{runAllAction.description}</p>
              <small className="field-hint">{runAllSummary}</small>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={runAllDisabled}
              onClick={() => onRunCommand(runAllAction.command)}
            >
              {isRunAllComplete ? "前四阶段已完成" : "一键推进到 Review Export"}
            </button>
          </div>
        ) : null}
        <div className="command-grid pipeline-command-grid">
          {STAGE_ACTIONS.filter((action) => action.command !== "run-all").map((action) => {
            const checklistItem = checklistByCommand[action.command];
            const stageKey = action.command.replaceAll("-", "_");
            const isComplete = selectedRunCompletedStages.has(stageKey);
            const isStageDone = checklistItem?.status === "done";
            const isLocked = action.requiresRun && !selectedRun?.run_id;
            const isRecommended = nextRecommendedCommand === action.command;
            const disabled =
              busyCommand === action.command ||
              isLocked ||
              isComplete;
            const statusLabel =
              busyCommand === action.command
                ? "执行中"
                : isComplete
                  ? "已完成"
                  : isRecommended
                    ? "推荐推进"
                    : isLocked
                      ? "需先创建 Run"
                      : action.command === "generate" && !selectedRun?.run_id
                        ? "起点"
                        : "可执行";
            return (
              <button
                key={action.command}
                className={classNames(
                  "command-card",
                  disabled && "is-disabled",
                  isComplete && "is-complete",
                  isLocked && "is-locked",
                  isRecommended && "is-recommended"
                )}
                type="button"
                disabled={disabled}
                onClick={() => onRunCommand(action.command)}
              >
                <div className="command-card-top">
                  <span>{action.eyebrow}</span>
                  <em className="command-card-state">{statusLabel}</em>
                </div>
                <strong>{action.label}</strong>
                <p>{action.description}</p>
                <small className="field-hint">
                  {PIPELINE_STAGE_META[action.command]?.actionHint || "推进这一阶段并观察产物反馈。"}
                </small>
                <div className="command-card-detail">
                  <div className="command-card-meta-row">
                    <span>完成时间</span>
                    <strong>{isStageDone ? formatDate(checklistItem?.completedAt) : "-"}</strong>
                  </div>
                  <span className="field-hint command-card-summary">
                    {checklistItem?.summary || "推进这一阶段并观察产物反馈。"}
                  </span>
                </div>
                <span className="command-card-arrow" aria-hidden="true">
                  {isComplete ? "已完成" : isLocked ? "待前置步骤" : "继续推进"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="stat-stack">
          <div className="stat-row">
            <span>Created</span>
            <strong>{formatDate(selectedRun?.created_at)}</strong>
          </div>
          <div className="stat-row">
            <span>Updated</span>
            <strong>{formatDate(selectedRun?.updated_at)}</strong>
          </div>
          <div className="stat-row">
            <span>Last Stage</span>
            <strong>{selectedRun?.last_stage || "-"}</strong>
          </div>
          <div className="stat-row">
            <span>Completed</span>
            <strong>{Object.keys(selectedRun?.stages || {}).length}</strong>
          </div>
        </div>
        {finalTrainingArtifact ? (
          <div className="next-step-banner is-calm">
            <div>
              <strong>最终微调文件已就绪</strong>
              <p>
                {`当前 run 已产出 ${finalTrainingArtifact.key}。这是默认最终可直接微调的交付物；如需回看训练边界，可同时检查 ${
                  canonicalDatasetArtifact?.key || "filtered_train"
                }。`}
              </p>
            </div>
            <div className="section-inline-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => onOpenArtifact(finalTrainingArtifact.key)}
              >
                打开最终训练文件
              </button>
              {canonicalDatasetArtifact ? (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => onOpenArtifact(canonicalDatasetArtifact.key)}
                >
                  查看 Canonical Dataset
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="config-bullet-list compact-list">
          <span>
            {selectedRun?.run_id
              ? "当前 run 已选定，可直接推进后续阶段。"
              : "先创建 run，之后才会生成 artifacts 与 review。"}
          </span>
          <span>
            {selectedRun?.last_stage
              ? `最近阶段是 ${selectedRun.last_stage}，建议优先看对应推荐 artifact。`
              : "刚创建的 run 还没有任何阶段输出。"}
          </span>
        </div>
      </section>
    </div>
  );
}
