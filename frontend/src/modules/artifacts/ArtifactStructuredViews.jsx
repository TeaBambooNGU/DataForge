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
    return <GenericObjectStructured object={artifactPayload.content} title={artifactPayload.key} />;
  }

  return (
    <article className="artifact-text-block">
      <h3>{artifactPayload.key}</h3>
      <pre>{artifactPayload.content || "文件不存在"}</pre>
    </article>
  );
}
