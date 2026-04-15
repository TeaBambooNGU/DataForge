import React from "react";

import { classNames, formatMetricValue } from "../../lib/utils.js";
import {
  getRawCandidateGroupValue,
  getRawCandidateUserText,
  getRejectionReasonLabel,
  summarizeEvalPredictions,
} from "../../lib/artifacts.js";

export function ArtifactRecordCard({ record, artifactKey }) {
  const title = record.sample_id || record.id || record.run_id || artifactKey;
  const summary =
    record.user_text || record.input?.user_text || record.raw_output || record.review_comment || "";
  const chips = [];
  const metrics = [];
  const details = [];
  let toneClass = "";

  if (artifactKey === "raw_candidates") {
    chips.push(record.context?.has_visible_report ? "has report" : "no report");
    chips.push(record.metadata?.difficulty || "-");
    metrics.push(["label_hint", record.metadata?.label_hint]);
    metrics.push(["tags", formatMetricValue("tags", record.metadata?.tags || [])]);
    details.push(["dialogue_stage", record.context?.dialogue_stage]);
    details.push(["previous_report_summary", record.context?.previous_report_summary]);
  } else if (artifactKey === "rejected_samples") {
    chips.push("rejected");
    metrics.push(["rejection_reason", getRejectionReasonLabel(record.rejection_reason)]);
    metrics.push(["teacher_label", record.annotation?.teacher_label]);
    metrics.push(["parse_ok", record.annotation?.parse_ok]);
    details.push(["difficulty", record.metadata?.difficulty]);
    details.push(["has_visible_report", record.context?.has_visible_report]);
    toneClass = "is-danger";
  } else if (artifactKey === "teacher_labeled") {
    const parseOk = record.annotation?.parse_ok;
    chips.push(parseOk ? "parse_ok" : "parse_fail");
    metrics.push(["teacher_label", record.annotation?.teacher_label]);
    metrics.push(["error_code", record.annotation?.error_code]);
    metrics.push(["review_status", record.annotation?.review_status]);
    details.push(["raw_output", record.annotation?.teacher_raw_output]);
    details.push(["difficulty", record.metadata?.difficulty]);
    toneClass = parseOk === false ? "is-danger" : "";
  } else if (artifactKey === "review_candidates" || artifactKey === "review_results") {
    chips.push(record.review_decision || "pending");
    metrics.push(["teacher_label", record.teacher_label]);
    metrics.push(["reviewer_label", record.reviewer_label]);
    metrics.push(["reviewed_by", record.reviewed_by]);
    details.push(["review_comment", record.review_comment]);
    details.push(["reviewed_at", record.reviewed_at]);
  } else if (artifactKey === "gold_eval" || artifactKey === "hard_cases") {
    chips.push(record.annotation?.review_status || "gold");
    metrics.push(["final_label", record.annotation?.final_label]);
    metrics.push(["teacher_label", record.annotation?.teacher_label]);
    metrics.push(["difficulty", record.metadata?.difficulty]);
    details.push(["tags", formatMetricValue("tags", record.metadata?.tags || [])]);
    details.push(["human_label", record.annotation?.human_label]);
  } else if (artifactKey === "eval_predictions") {
    const matched = record.expected_label === record.predicted_label;
    chips.push(matched ? "matched" : "mismatch");
    chips.push(record.parse_ok ? "parse_ok" : "parse_fail");
    metrics.push(["expected", record.expected_label]);
    metrics.push(["predicted", record.predicted_label]);
    metrics.push(["error_code", record.error_code]);
    details.push(["difficulty", record.difficulty]);
    details.push(["tags", formatMetricValue("tags", record.tags || [])]);
    details.push(["raw_output", record.raw_output]);
    toneClass = matched && record.parse_ok ? "is-success" : "is-danger";
  } else if (artifactKey === "student_train") {
    const messages = Array.isArray(record.messages) ? record.messages : [];
    const roles = messages.map((message) => message?.role || "unknown");
    const userMessage = messages.find((message) => message?.role === "user");
    const systemMessage = messages.find((message) => message?.role === "system");
    const assistantMessage = [...messages].reverse().find((message) => message?.role === "assistant");
    chips.push(systemMessage ? "has_system" : "no_system");
    chips.push(`messages:${messages.length}`);
    metrics.push(["roles", roles.join(" -> ") || "-"]);
    metrics.push(["assistant_json", assistantMessage?.content || "-"]);
    details.push(["user", userMessage?.content]);
    details.push(["system", systemMessage?.content]);
    toneClass = systemMessage ? "is-success" : "is-warning";
  } else if (artifactKey === "train_export") {
    const messages = Array.isArray(record.messages) ? record.messages : [];
    const roles = messages.map((message) => message?.role || "unknown");
    const userMessage = messages.find((message) => message?.role === "user");
    const systemMessage = messages.find((message) => message?.role === "system");
    const assistantMessage = [...messages].reverse().find((message) => message?.role === "assistant");
    chips.push("audit_export");
    chips.push(systemMessage ? "has_system" : "no_system");
    metrics.push(["roles", roles.join(" -> ") || "-"]);
    metrics.push(["assistant_json", assistantMessage?.content || "-"]);
    details.push(["user", userMessage?.content]);
    details.push(["system", systemMessage?.content]);
    toneClass = "is-warning";
  } else {
    Object.entries(record)
      .slice(0, 4)
      .forEach(([label, value]) => metrics.push([label, value]));
  }

  return (
    <article className={classNames("artifact-record", toneClass)}>
      <div className="artifact-record-head">
        <h3>{title}</h3>
      </div>
      {summary ? <p>{summary}</p> : null}
      {chips.length ? (
        <div className="artifact-chip-row">
          {chips.filter(Boolean).map((chip) => (
            <span
              key={chip}
              className={classNames(
                "micro-chip",
                ["rejected", "mismatch", "parse_fail"].includes(chip) && "is-danger",
                ["matched", "parse_ok", "accepted"].includes(chip) && "is-success",
                chip === "corrected" && "is-warning"
              )}
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      {metrics.length ? (
        <div className="artifact-card-metrics">
          {metrics
            .filter(([, value]) => value != null && value !== "")
            .map(([label, value]) => (
              <span key={label}>
                <strong>{label}</strong>
                {formatMetricValue(label, value)}
              </span>
            ))}
        </div>
      ) : null}
      {details.length ? (
        <div className="artifact-detail-grid">
          {details
            .filter(([, value]) => value != null && value !== "")
            .map(([label, value]) => (
              <div key={label} className="artifact-detail-block">
                <strong>{label}</strong>
                <span>{formatMetricValue(label, value)}</span>
              </div>
            ))}
        </div>
      ) : null}
    </article>
  );
}

function RawCandidatesStructured({ records, rawCandidateViewMode, rawCandidateGroupBy }) {
  if (!records.length) {
    return (
      <div className="empty-board compact">
        <strong>没有匹配当前筛选的候选样本</strong>
      </div>
    );
  }

  const renderRawCandidateRow = (record, compact = false) => {
    const metaItems = [
      ["difficulty", record.metadata?.difficulty || "-"],
      ["report", record.context?.has_visible_report ? "true" : "false"],
      ["stage", record.context?.dialogue_stage || "-"],
      ["tags", formatMetricValue("tags", record.metadata?.tags || [])],
    ];

    return (
      <article key={record.id} className={classNames("raw-candidate-row", compact && "is-compact")}>
        <div className="raw-candidate-row-main">
          <div className="raw-candidate-side">
            <div className="raw-candidate-cell raw-candidate-cell-id">
              <span className="raw-candidate-cell-label">ID</span>
              <code>{record.id || "-"}</code>
            </div>
            <div className="raw-candidate-cell raw-candidate-cell-hint">
              <span className="raw-candidate-cell-label">label_hint</span>
              <strong>{record.metadata?.label_hint || "-"}</strong>
            </div>
          </div>
          <div className="raw-candidate-cell raw-candidate-cell-text">
            <span className="raw-candidate-cell-label">User Text</span>
            <p>{getRawCandidateUserText(record)}</p>
          </div>
        </div>
        <div className="raw-candidate-row-meta">
          {metaItems.map(([label, value]) => (
            <span key={`${record.id}-${label}`} className="raw-candidate-meta-item">
              <strong>{label}</strong>
              {value}
            </span>
          ))}
        </div>
      </article>
    );
  };

  if (rawCandidateViewMode === "category") {
    const grouped = new Map();
    records.forEach((record) => {
      const key = getRawCandidateGroupValue(record, rawCandidateGroupBy);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(record);
    });
    const groups = Array.from(grouped.entries()).sort((left, right) => right[1].length - left[1].length);
    return (
      <div className="artifact-diagnostic-panel">
        <div className="artifact-summary-grid">
          {groups.map(([group, items]) => (
            <article key={group} className="artifact-summary-card">
              <h3>{group}</h3>
              <strong>{items.length}</strong>
              <span>{rawCandidateGroupBy}</span>
            </article>
          ))}
        </div>
        <div className="artifact-category-grid">
          {groups.map(([group, items]) => (
            <article key={group} className="artifact-category-card">
              <div className="artifact-record-head">
                <h3>{group}</h3>
                <span className="micro-chip">{items.length} 条</span>
              </div>
              <div className="raw-candidate-list is-compact">{items.map((record) => renderRawCandidateRow(record, true))}</div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-diagnostic-panel">
      <div className="raw-candidate-list">{records.map((record) => renderRawCandidateRow(record))}</div>
    </div>
  );
}

function RejectedSamplesStructured({ records }) {
  if (!records.length) {
    return (
      <div className="empty-board compact">
        <strong>没有匹配当前筛选的拒绝样本</strong>
      </div>
    );
  }
  const grouped = new Map();
  records.forEach((record) => {
    const reason = record.rejection_reason || "unknown";
    if (!grouped.has(reason)) {
      grouped.set(reason, []);
    }
    grouped.get(reason).push(record);
  });
  const groups = Array.from(grouped.entries()).sort((left, right) => right[1].length - left[1].length);
  return (
    <div className="artifact-diagnostic-panel">
      <div className="artifact-summary-grid">
        {groups.map(([reason, items]) => (
          <article key={reason} className="artifact-summary-card">
            <h3>{getRejectionReasonLabel(reason)}</h3>
            <strong>{items.length}</strong>
            <span>rejection_reason</span>
          </article>
        ))}
      </div>
      <div className="artifact-table-wrap">
        <table className="artifact-table">
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
            {records.map((record) => (
              <tr key={record.id} className="is-danger">
                <td>
                  <code>{record.id || "-"}</code>
                </td>
                <td>
                  <code>{record.user_text || record.input?.user_text || "-"}</code>
                </td>
                <td>{getRejectionReasonLabel(record.rejection_reason)}</td>
                <td>{record.annotation?.teacher_label || "-"}</td>
                <td>{record.annotation?.parse_ok ? "ok" : "fail"}</td>
                <td>{record.context?.has_visible_report ? "true" : "false"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="artifact-card-grid">
        {records.map((record, index) => (
          <ArtifactRecordCard
            key={record.id || record.sample_id || `rejected_samples-${index}`}
            record={record}
            artifactKey="rejected_samples"
          />
        ))}
      </div>
    </div>
  );
}

function EvalPredictionsStructured({ records }) {
  if (!records.length) {
    return (
      <div className="empty-board compact">
        <strong>没有匹配当前筛选的评测记录</strong>
      </div>
    );
  }
  const sorted = [...records].sort((left, right) => {
    const leftBad = left.expected_label !== left.predicted_label || left.parse_ok === false ? 1 : 0;
    const rightBad = right.expected_label !== right.predicted_label || right.parse_ok === false ? 1 : 0;
    return rightBad - leftBad;
  });
  const confusion = summarizeEvalPredictions(sorted);
  const mismatches = sorted.filter((item) => item.expected_label !== item.predicted_label);
  const parseFailures = sorted.filter((item) => item.parse_ok === false);
  return (
    <div className="artifact-diagnostic-panel">
      <div className="artifact-confusion-grid">
        <article className="artifact-confusion-card">
          <h3>Confusion Topline</h3>
          <div className="artifact-confusion-list">
            {confusion.map(([pair, count]) => (
              <div key={pair} className="artifact-confusion-item">
                <span>{pair}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="artifact-confusion-card">
          <h3>Error Focus</h3>
          <div className="artifact-confusion-list">
            <div className="artifact-confusion-item">
              <span>mismatch</span>
              <strong>{mismatches.length}</strong>
            </div>
            <div className="artifact-confusion-item">
              <span>parse_fail</span>
              <strong>{parseFailures.length}</strong>
            </div>
            <div className="artifact-confusion-item">
              <span>visible rows</span>
              <strong>{sorted.length}</strong>
            </div>
          </div>
        </article>
      </div>
      <div className="artifact-table-wrap">
        <table className="artifact-table">
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
            {sorted.map((record) => {
              const isAlert =
                record.expected_label !== record.predicted_label || record.parse_ok === false;
              return (
                <tr key={record.id} className={isAlert ? "is-danger" : "is-success"}>
                  <td>
                    <code>{record.id || "-"}</code>
                  </td>
                  <td>{record.expected_label || "-"}</td>
                  <td>{record.predicted_label || "-"}</td>
                  <td>{record.parse_ok ? "ok" : "fail"}</td>
                  <td>
                    <code>{record.user_text || "-"}</code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="artifact-card-grid">
        {sorted.map((record) => (
          <ArtifactRecordCard key={record.id} record={record} artifactKey="eval_predictions" />
        ))}
      </div>
    </div>
  );
}

function EvalResultStructured({ content }) {
  const promptfooSummary = content?.promptfoo?.summary || {};
  const topConfusions = content?.quality?.top_confusions || [];
  const perClass = Object.entries(content?.metrics?.per_class || {});
  return (
    <div className="artifact-object-stack">
      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Dataset</h3>
          <span>先看样本规模和标签分布</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["sample_count", content?.dataset?.sample_count],
            ["hard_case_sample_count", content?.dataset?.hard_case_sample_count],
            ["no_visible_report_sample_count", content?.dataset?.no_visible_report_sample_count],
            ["label_distribution", formatMetricValue("label_distribution", content?.dataset?.label_distribution)],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Metrics</h3>
          <span>优先判断这次 run 是否达到可保留基线</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["overall_accuracy", content?.metrics?.overall_accuracy],
            ["macro_f1", content?.metrics?.macro_f1],
            ["json_valid_rate", content?.metrics?.json_valid_rate],
            ["hard_cases_accuracy", content?.metrics?.hard_cases_accuracy],
            [
              "has_visible_report_false_accuracy",
              content?.metrics?.has_visible_report_false_accuracy,
            ],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
        {perClass.length ? (
          <div className="artifact-table-wrap">
            <table className="artifact-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Precision</th>
                  <th>Recall</th>
                  <th>F1</th>
                </tr>
              </thead>
              <tbody>
                {perClass.map(([label, values]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{formatMetricValue("precision", values.precision)}</td>
                    <td>{formatMetricValue("recall", values.recall)}</td>
                    <td>{formatMetricValue("f1", values.f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Quality</h3>
          <span>关注错例密度和最主要的混淆方向</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["mismatch_count", content?.quality?.mismatch_count],
            ["parse_failure_count", content?.quality?.parse_failure_count],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
        {topConfusions.length ? (
          <div className="artifact-table-wrap">
            <table className="artifact-table">
              <thead>
                <tr>
                  <th>Expected</th>
                  <th>Predicted</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {topConfusions.map((item) => (
                  <tr key={`${item.expected}-${item.predicted}`}>
                    <td>{item.expected}</td>
                    <td>{item.predicted}</td>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-board compact">
            <strong>当前没有非对角混淆样本</strong>
          </div>
        )}
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Promptfoo</h3>
          <span>确认外部评测器执行状态，不必先翻 results.json</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["status", content?.promptfoo?.status],
            ["pass_rate", promptfooSummary.pass_rate],
            ["total_tests", promptfooSummary.total_tests],
            ["results_path", content?.promptfoo?.results_path],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StudentTrainStructured({ records, totalRecords, mode = "final" }) {
  const actionDistribution = new Map();
  const rolePatternCounts = new Map();
  const messageLengthCounts = new Map();
  const systemPromptSet = new Set();
  let systemMessageCount = 0;
  let validAssistantJsonCount = 0;
  let invalidAssistantJsonCount = 0;

  records.forEach((record) => {
    const messages = Array.isArray(record?.messages) ? record.messages : [];
    const roles = messages.map((message) => message?.role || "unknown");
    const pattern = roles.join(" -> ") || "empty";
    rolePatternCounts.set(pattern, (rolePatternCounts.get(pattern) || 0) + 1);
    messageLengthCounts.set(messages.length, (messageLengthCounts.get(messages.length) || 0) + 1);

    const systemMessage = messages.find((message) => message?.role === "system");
    if (systemMessage?.content) {
      systemMessageCount += 1;
      systemPromptSet.add(systemMessage.content);
    }

    const assistantMessage = [...messages].reverse().find((message) => message?.role === "assistant");
    if (!assistantMessage?.content) {
      invalidAssistantJsonCount += 1;
      return;
    }
    try {
      const parsed = JSON.parse(assistantMessage.content);
      if (parsed && typeof parsed.action === "string" && parsed.action.trim()) {
        validAssistantJsonCount += 1;
        const action = parsed.action.trim();
        actionDistribution.set(action, (actionDistribution.get(action) || 0) + 1);
      } else {
        invalidAssistantJsonCount += 1;
      }
    } catch {
      invalidAssistantJsonCount += 1;
    }
  });

  const rolePatterns = Array.from(rolePatternCounts.entries()).sort((left, right) => right[1] - left[1]);
  const messageLengths = Array.from(messageLengthCounts.entries()).sort((left, right) => Number(left[0]) - Number(right[0]));
  const labelDistribution = Array.from(actionDistribution.entries()).sort((left, right) => right[1] - left[1]);
  const previewRecords = records.slice(0, 6);
  const isAuditMode = mode === "audit";

  return (
    <div className="artifact-object-stack">
      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>{isAuditMode ? "Audit Position" : "Delivery Position"}</h3>
          <span>
            {isAuditMode
              ? "这份文件用于审计与通用导出检查，不是默认最终微调交付物"
              : "这份文件是默认最终可直接微调的正式交付物"}
          </span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["artifact_mode", isAuditMode ? "audit_export" : "final_sft_dataset"],
            ["preferred_upload_target", isAuditMode ? "student_train" : "this_file"],
            ["same_message_shape", "yes"],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Training Readiness</h3>
          <span>先确认这批样本是否满足直接微调需要的基本结构约束</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["visible_samples", records.length],
            ["total_samples", totalRecords ?? records.length],
            ["with_system", systemMessageCount],
            ["valid_assistant_json", validAssistantJsonCount],
            ["invalid_assistant_json", invalidAssistantJsonCount],
            ["unique_system_prompts", systemPromptSet.size],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Message Template</h3>
          <span>检查消息轮数与 role 排列是否稳定，避免训练模板混杂</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["dominant_role_pattern", rolePatterns[0]?.[0] || "-"],
            ["dominant_role_pattern_count", rolePatterns[0]?.[1] || 0],
            ["message_length_variants", messageLengths.length],
            ["dominant_message_count", messageLengths[0]?.[0] || "-"],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
        <div className="artifact-table-wrap">
          <table className="artifact-table">
            <thead>
              <tr>
                <th>Role Pattern</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {rolePatterns.map(([pattern, count]) => (
                <tr key={pattern}>
                  <td>{pattern}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Label Distribution</h3>
          <span>确认 assistant JSON 的 action 标签是否符合预期分布</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["unique_actions", labelDistribution.length],
            ["top_action", labelDistribution[0]?.[0] || "-"],
            ["top_action_count", labelDistribution[0]?.[1] || 0],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
        <div className="artifact-table-wrap">
          <table className="artifact-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {labelDistribution.map(([label, count]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Sample Preview</h3>
          <span>快速抽查前几条样本，确认 messages 结构与输出 JSON 风格一致</span>
        </div>
        <div className="artifact-card-grid">
          {previewRecords.map((record, index) => (
            <ArtifactRecordCard
              key={`student-train-preview-${index}`}
              record={record}
              artifactKey={isAuditMode ? "train_export" : "student_train"}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TrainExportMetadataStructured({ content }) {
  const historicalLeakage = content?.historical_leakage || {};
  const historicalSourceCounts = Object.entries(historicalLeakage.historical_source_counts || {});
  const matchTypeCounts = Object.entries(historicalLeakage.match_type_counts || {});

  return (
    <div className="artifact-object-stack">
      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Export Identity</h3>
          <span>先确认这份文件是审计导出，不是最终微调交付物</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["dataset_name", content?.dataset_name],
            ["artifact_role", content?.artifact_role],
            ["is_final_sft_dataset", content?.is_final_sft_dataset],
            ["format", content?.format],
            ["sample_count", content?.sample_count],
            ["version_id", content?.version_id],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Lineage</h3>
          <span>看清 canonical dataset 与推荐训练交付物的对应关系</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["canonical_dataset_path", content?.canonical_dataset_path],
            ["recommended_training_artifact", content?.recommended_training_artifact],
            ["source_paths", content?.source_paths],
            ["generated_at", content?.generated_at],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Leakage Guard</h3>
          <span>确认跨 run 泄漏拦截是否生效，以及是否有历史样本被挡下</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["blocked_count", historicalLeakage.blocked_count],
            ["indexed_source_count", Object.keys(historicalLeakage.indexed_source_counts || {}).length],
            ["historical_source_count", historicalSourceCounts.length],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
        {matchTypeCounts.length ? (
          <div className="artifact-table-wrap">
            <table className="artifact-table">
              <thead>
                <tr>
                  <th>Match Type</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {matchTypeCounts.map(([label, value]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{formatMetricValue(label, value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {content?.note ? (
        <section className="artifact-object-block">
          <div className="artifact-object-head">
            <h3>Note</h3>
            <span>使用边界与交付建议</span>
          </div>
          <div className="artifact-detail-grid">
            <div className="artifact-detail-block artifact-detail-block-wide">
              <strong>note</strong>
              <span>{content.note}</span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TrainingMetadataStructured({ content }) {
  return (
    <div className="artifact-object-stack">
      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Delivery Identity</h3>
          <span>先确认这份文件就是最终可直接微调的正式交付物</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["dataset_name", content?.dataset_name],
            ["artifact_role", content?.artifact_role],
            ["is_final_sft_dataset", content?.is_final_sft_dataset],
            ["format", content?.format],
            ["sample_count", content?.sample_count],
            ["version_id", content?.version_id],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Training Readiness</h3>
          <span>确认训练器真正关心的输入特征是否齐全</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["has_system_prompt", content?.has_system_prompt],
            ["includes_hard_cases", content?.includes_hard_cases],
            ["student_train_path", content?.student_train_path],
            ["source_artifact", content?.source_artifact],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="artifact-object-block">
        <div className="artifact-object-head">
          <h3>Lineage</h3>
          <span>看清这版最终训练文件是从哪个 canonical dataset 打包出来的</span>
        </div>
        <div className="artifact-key-grid">
          {[
            ["canonical_dataset_path", content?.canonical_dataset_path],
            ["source_paths", content?.source_paths],
            ["generated_at", content?.generated_at],
            ["run_id", content?.run_id],
          ].map(([label, value]) => (
            <div key={label} className="artifact-key-card">
              <strong>{label}</strong>
              <span>{formatMetricValue(label, value)}</span>
            </div>
          ))}
        </div>
      </section>

      {content?.note ? (
        <section className="artifact-object-block">
          <div className="artifact-object-head">
            <h3>Note</h3>
            <span>训练回流与治理约束</span>
          </div>
          <div className="artifact-detail-grid">
            <div className="artifact-detail-block artifact-detail-block-wide">
              <strong>note</strong>
              <span>{content.note}</span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function GenericObjectStructured({ object, title }) {
  const entries = Object.entries(object || {});
  if (!entries.length) {
    return (
      <div className="empty-board compact">
        <strong>{title} 当前为空</strong>
      </div>
    );
  }
  return (
    <section className="artifact-object-block">
      <div className="artifact-object-head">
        <h3>{title}</h3>
        <span>结构化概览</span>
      </div>
      <div className="artifact-key-grid">
        {entries.map(([label, value]) => (
          <div key={label} className="artifact-key-card">
            <strong>{label}</strong>
            <span>{formatMetricValue(label, value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ArtifactStructuredContent({
  artifactPayload,
  artifactViewMode,
  visibleArtifactRows,
  paginatedRawArtifactContent,
  rawCandidateViewMode,
  rawCandidateGroupBy,
}) {
  if (!artifactPayload) {
    return (
      <div className="empty-board compact">
        <strong>先从左侧选择一个 artifact</strong>
      </div>
    );
  }

  if (artifactViewMode === "raw") {
    return (
      <div className="raw-artifact-view">
        <pre className="code-block raw-artifact-code">
          {paginatedRawArtifactContent}
        </pre>
      </div>
    );
  }

  if (artifactPayload.kind === "jsonl") {
    if (artifactPayload.key === "student_train") {
      return (
        <StudentTrainStructured
          records={visibleArtifactRows}
          totalRecords={artifactPayload.total_records || visibleArtifactRows.length}
          mode="final"
        />
      );
    }
    if (artifactPayload.key === "train_export") {
      return (
        <StudentTrainStructured
          records={visibleArtifactRows}
          totalRecords={artifactPayload.total_records || visibleArtifactRows.length}
          mode="audit"
        />
      );
    }
    if (artifactPayload.key === "raw_candidates") {
      return (
        <RawCandidatesStructured
          records={visibleArtifactRows}
          rawCandidateViewMode={rawCandidateViewMode}
          rawCandidateGroupBy={rawCandidateGroupBy}
        />
      );
    }
    if (artifactPayload.key === "rejected_samples") {
      return <RejectedSamplesStructured records={visibleArtifactRows} />;
    }
    if (artifactPayload.key === "eval_predictions") {
      return <EvalPredictionsStructured records={visibleArtifactRows} />;
    }
    if (!visibleArtifactRows.length) {
      return (
        <div className="empty-board compact">
          <strong>没有匹配当前搜索或筛选条件的记录</strong>
        </div>
      );
    }
    return (
      <div className="artifact-card-grid">
        {visibleArtifactRows.map((record, index) => (
          <ArtifactRecordCard
            key={record.id || record.sample_id || `${artifactPayload.key}-${index}`}
            record={record}
            artifactKey={artifactPayload.key}
          />
        ))}
      </div>
    );
  }

  if (artifactPayload.kind === "json") {
    if (!artifactPayload.content) {
      return (
        <div className="empty-board compact">
          <strong>文件不存在</strong>
        </div>
      );
    }
    if (artifactPayload.key === "eval_result") {
      return <EvalResultStructured content={artifactPayload.content} />;
    }
    if (artifactPayload.key === "train_export_metadata") {
      return <TrainExportMetadataStructured content={artifactPayload.content} />;
    }
    if (artifactPayload.key === "training_metadata") {
      return <TrainingMetadataStructured content={artifactPayload.content} />;
    }
    return <GenericObjectStructured object={artifactPayload.content} title={artifactPayload.key} />;
  }

  return (
    <article className="artifact-text-block">
      <h3>{artifactPayload.key}</h3>
      <pre>{artifactPayload.content || "文件不存在"}</pre>
    </article>
  );
}
