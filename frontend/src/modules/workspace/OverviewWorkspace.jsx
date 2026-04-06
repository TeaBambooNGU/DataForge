import React from "react";

import { PIPELINE_STAGE_META, STAGE_ACTIONS } from "../../constants/app.js";
import { classNames, formatDate, formatMetricValue } from "../../lib/utils.js";

function buildChecklistItems(selectedRun, selectedRunCompletedStages, nextRecommendedCommand) {
  const orderedActions = STAGE_ACTIONS.filter((action) => action.command !== "run-all");
  return orderedActions.map((action) => {
    const stageKey = action.command.replaceAll("-", "_");
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

function summarizeStageStats(stats) {
  if (!stats || typeof stats !== "object" || !Object.keys(stats).length) {
    return ["无结构化统计，建议直接查看该阶段推荐 artifact。"];
  }
  return Object.entries(stats).map(
    ([label, value]) => `${label}: ${formatMetricValue(label, value)}`
  );
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
            const stageKey = action.command.replaceAll("-", "_");
            const disabled =
              busyCommand === action.command ||
              (action.requiresRun && !selectedRun?.run_id) ||
              selectedRunCompletedStages.has(stageKey);
            return (
              <button
                key={action.command}
                className={classNames("command-card", disabled && "is-disabled")}
                type="button"
                disabled={disabled}
                onClick={() => onRunCommand(action.command)}
              >
                <span>{action.eyebrow}</span>
                <strong>{action.label}</strong>
                <p>{action.description}</p>
                <small className="field-hint">
                  {PIPELINE_STAGE_META[action.command]?.actionHint || "推进这一阶段并观察产物反馈。"}
                </small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Run Signal</span>
            <h2>当前状态</h2>
          </div>
        </div>
        <div className="run-checklist">
          {checklistItems.map((item) => (
            <article
              key={item.command}
              className={classNames("checklist-item", `is-${item.status}`)}
            >
              <div className="artifact-record-head">
                <div>
                  <strong>{item.label}</strong>
                  <p>{PIPELINE_STAGE_META[item.command]?.description || item.description}</p>
                </div>
                <span className="micro-chip">{item.status}</span>
              </div>
              <span className="field-hint">{item.summary}</span>
            </article>
          ))}
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

      <section className="panel panel-wide">
        <div className="section-head">
          <div>
            <span className="eyebrow">Stage Trace</span>
            <h2>已完成阶段</h2>
          </div>
        </div>
        <div className="timeline">
          {Object.entries(selectedRun?.stages || {}).length ? (
            Object.entries(selectedRun.stages).map(([stageName, stagePayload]) => (
              <article key={stageName} className="timeline-item">
                <span>{stageName}</span>
                <strong>{formatDate(stagePayload.completed_at)}</strong>
                <p>
                  {PIPELINE_STAGE_META[stageName.replaceAll("_", "-")]?.description || "阶段已完成。"}
                </p>
                <div className="config-bullet-list compact-list">
                  <span>
                    {PIPELINE_STAGE_META[stageName.replaceAll("_", "-")]?.actionHint ||
                      "继续检查该阶段产物。"}
                  </span>
                  {summarizeStageStats(stagePayload.stats).map((item) => (
                    <span key={`${stageName}-${item}`}>{item}</span>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="empty-board compact">
              <strong>还没有完成阶段</strong>
              <p>从 Forge Run 或 Run All 开始。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
