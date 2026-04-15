import {
  ARTIFACT_CATEGORY_META,
  ARTIFACT_EXPLANATIONS,
  RECOMMENDED_ARTIFACTS_BY_STAGE,
  REJECTION_REASON_LABELS,
} from "../constants/app.js";
import {
  formatMetricValue,
  humanizeLabel,
  normalizeStageName,
  shortenText,
} from "./utils.js";

export function getRejectionReasonLabel(reason) {
  return REJECTION_REASON_LABELS[reason] || humanizeLabel(reason);
}

export function getArtifactCategoryInfo(category) {
  return ARTIFACT_CATEGORY_META[category] || ARTIFACT_CATEGORY_META.other;
}

export function getRecommendedArtifactKeys(run) {
  if (!run?.last_stage) {
    return ["raw_candidates"];
  }
  return RECOMMENDED_ARTIFACTS_BY_STAGE[normalizeStageName(run.last_stage)] || [];
}

export function groupArtifactsByCategory(artifacts) {
  const groups = new Map();
  artifacts.forEach((artifact) => {
    const category = artifact.category || "other";
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(artifact);
  });
  const order = ["raw", "processed", "gold", "exports", "reports", "training", "other"];
  return Array.from(groups.entries()).sort(
    ([left], [right]) => order.indexOf(left) - order.indexOf(right)
  );
}

export function getArtifactSearchText(record) {
  return JSON.stringify(record || {}).toLowerCase();
}

export function getArtifactFilterOptions(payload) {
  const key = payload?.key;
  const records = Array.isArray(payload?.content) ? payload.content : [];
  if (key === "raw_candidates") {
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
    const reasons = Array.from(
      new Set(records.map((record) => record.rejection_reason).filter(Boolean))
    ).sort();
    return [
      { value: "all", label: "全部" },
      ...reasons.map((reason) => ({
        value: `reason:${reason}`,
        label: getRejectionReasonLabel(reason),
      })),
    ];
  }
  return [{ value: "all", label: "全部" }];
}

export function recordPassesArtifactFilter(record, payload, filter) {
  if (!filter || filter === "all" || !payload) {
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
    return (record.review_decision || "pending") === filter;
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
    return (
      record.metadata?.difficulty === "hard" ||
      (record.metadata?.tags || []).includes("ambiguous")
    );
  }
  if (key === "rejected_samples" && filter.startsWith("reason:")) {
    return record.rejection_reason === filter.slice("reason:".length);
  }
  return true;
}

export function getRawCandidateUserText(record) {
  return record.user_text || record.input?.user_text || "-";
}

export function getRawCandidateGroupValue(record, groupBy) {
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

export function summarizeEvalPredictions(records) {
  const confusion = new Map();
  records.forEach((record) => {
    const expected = record.expected_label || "-";
    const predicted = record.predicted_label || "-";
    const key = `${expected}→${predicted}`;
    confusion.set(key, (confusion.get(key) || 0) + 1);
  });
  return Array.from(confusion.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
}

export function getArtifactListHint(artifact) {
  const explanation = ARTIFACT_EXPLANATIONS[artifact.key];
  if (!explanation) {
    return shortenText(artifact.relative_path, 54);
  }
  return shortenText(explanation.readingHint || explanation.usage || explanation.role, 72);
}

export function buildArtifactSummary(payload, records) {
  if (!payload) {
    return [];
  }
  const summary = [];
  const total = Array.isArray(payload.content) ? payload.total_records || payload.content.length : null;
  if (Array.isArray(payload.content)) {
    summary.push({ label: "visible", value: records.length });
    summary.push({ label: "total", value: total });
  }
  if (payload.key === "teacher_labeled") {
    summary.push({
      label: "parse_fail",
      value: records.filter((record) => record.annotation?.parse_ok === false).length,
      tone: "danger",
    });
  }
  if (payload.key === "review_candidates" || payload.key === "review_results") {
    summary.push({
      label: "accepted",
      value: records.filter((record) => record.review_decision === "accepted").length,
      tone: "success",
    });
    summary.push({
      label: "corrected",
      value: records.filter((record) => record.review_decision === "corrected").length,
      tone: "warning",
    });
    summary.push({
      label: "rejected",
      value: records.filter((record) => record.review_decision === "rejected").length,
      tone: "danger",
    });
  }
  if (payload.key === "eval_predictions") {
    summary.push({
      label: "mismatch",
      value: records.filter((record) => record.expected_label !== record.predicted_label).length,
      tone: "danger",
    });
    summary.push({
      label: "parse_fail",
      value: records.filter((record) => record.parse_ok === false).length,
      tone: "warning",
    });
  }
  if (payload.key === "eval_result") {
    const metrics = payload.content?.metrics || {};
    const quality = payload.content?.quality || {};
    const promptfoo = payload.content?.promptfoo?.summary || {};
    summary.push({
      label: "accuracy",
      value: formatMetricValue("accuracy", metrics.overall_accuracy),
      tone: "success",
    });
    summary.push({
      label: "macro_f1",
      value: formatMetricValue("macro_f1", metrics.macro_f1),
    });
    summary.push({
      label: "parse_fail",
      value: quality.parse_failure_count || 0,
      tone: "warning",
    });
    if (promptfoo.pass_rate != null) {
      summary.push({
        label: "promptfoo_pass",
        value: formatMetricValue("pass_rate", promptfoo.pass_rate),
      });
    }
  }
  if (payload.key === "training_metadata") {
    summary.push({
      label: "sample_count",
      value: payload.content?.sample_count || 0,
      tone: "success",
    });
    summary.push({
      label: "final_sft",
      value: payload.content?.is_final_sft_dataset ? "yes" : "no",
      tone: payload.content?.is_final_sft_dataset ? "success" : "warning",
    });
    summary.push({
      label: "system_prompt",
      value: payload.content?.has_system_prompt ? "yes" : "no",
      tone: payload.content?.has_system_prompt ? "success" : "warning",
    });
  }
  if (payload.key === "train_export_metadata") {
    const leakage = payload.content?.historical_leakage || {};
    summary.push({
      label: "sample_count",
      value: payload.content?.sample_count || 0,
    });
    summary.push({
      label: "audit_export",
      value: payload.content?.artifact_role === "audit_export" ? "yes" : "no",
      tone: "warning",
    });
    summary.push({
      label: "leakage_blocked",
      value: leakage.blocked_count || 0,
      tone: leakage.blocked_count ? "danger" : "success",
    });
  }
  if (payload.key === "student_train") {
    const uniqueActions = new Set();
    let withSystem = 0;
    let validJson = 0;
    records.forEach((record) => {
      const messages = Array.isArray(record?.messages) ? record.messages : [];
      if (messages.some((message) => message?.role === "system")) {
        withSystem += 1;
      }
      const assistantMessage = [...messages].reverse().find((message) => message?.role === "assistant");
      if (!assistantMessage?.content) {
        return;
      }
      try {
        const parsed = JSON.parse(assistantMessage.content);
        if (parsed?.action) {
          validJson += 1;
          uniqueActions.add(parsed.action);
        }
      } catch {}
    });
    summary.push({ label: "with_system", value: withSystem, tone: withSystem === records.length ? "success" : "warning" });
    summary.push({ label: "valid_json", value: validJson, tone: validJson === records.length ? "success" : "warning" });
    summary.push({ label: "unique_actions", value: uniqueActions.size });
  }
  if (payload.key === "train_export") {
    const uniqueActions = new Set();
    let withSystem = 0;
    let validJson = 0;
    records.forEach((record) => {
      const messages = Array.isArray(record?.messages) ? record.messages : [];
      if (messages.some((message) => message?.role === "system")) {
        withSystem += 1;
      }
      const assistantMessage = [...messages].reverse().find((message) => message?.role === "assistant");
      if (!assistantMessage?.content) {
        return;
      }
      try {
        const parsed = JSON.parse(assistantMessage.content);
        if (parsed?.action) {
          validJson += 1;
          uniqueActions.add(parsed.action);
        }
      } catch {}
    });
    summary.push({ label: "audit_export", value: "yes", tone: "warning" });
    summary.push({ label: "with_system", value: withSystem, tone: withSystem === records.length ? "success" : "warning" });
    summary.push({ label: "valid_json", value: validJson, tone: validJson === records.length ? "success" : "warning" });
    summary.push({ label: "unique_actions", value: uniqueActions.size });
  }
  if (payload.key === "gold_eval") {
    summary.push({
      label: "hard",
      value: records.filter(
        (record) =>
          record.metadata?.difficulty === "hard" ||
          (record.metadata?.tags || []).includes("ambiguous")
      ).length,
      tone: "warning",
    });
  }
  if (payload.key === "rejected_samples") {
    const reasonCounts = new Map();
    records.forEach((record) => {
      const reason = record.rejection_reason || "unknown";
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });
    Array.from(reasonCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .forEach(([reason, count]) => {
        summary.push({ label: getRejectionReasonLabel(reason), value: count, tone: "danger" });
      });
  }
  return summary;
}

export function createDefaultArtifactKey(run) {
  const artifacts = visibleArtifacts(run);
  return (
    artifacts.find((item) => item.artifact_role === "final_sft_dataset")?.key ||
    artifacts.find((item) => item.exists)?.key ||
    null
  );
}

export function visibleArtifacts(run) {
  return (run?.artifacts || []).filter((item) => item.exists && !item.key.endsWith("_manifest"));
}
