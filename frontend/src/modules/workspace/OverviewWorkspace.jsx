import React from "react";

import { PIPELINE_STAGE_META, STAGE_ACTIONS } from "../../constants/app.js";
import { classNames, formatDate } from "../../lib/utils.js";

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
}) {
  const checklistItems = buildChecklistItems(
    selectedRun,
    selectedRunCompletedStages,
    nextRecommendedCommand
  );
  const checklistByCommand = Object.fromEntries(
    checklistItems.map((item) => [item.command, item])
  );
  return (
    <div className="panel-grid">
      <section className="panel panel-wide">
        <div className="section-head">
          <div>
            <span className="eyebrow">Pipeline</span>
            <h2>推进当前 Run</h2>
          </div>
          <span className="muted-text">{selectedRun?.run_id || "先创建 run"}</span>
        </div>
        {nextRecommendedCommand ? (
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
              执行推荐下一步
            </button>
          </div>
        ) : null}
        <div className="command-grid">
          {STAGE_ACTIONS.map((action) => {
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
                  {isComplete ? "Done" : isLocked ? "Locked" : "Continue"}
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
