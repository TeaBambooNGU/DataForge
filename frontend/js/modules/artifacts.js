import { escapeHtml, formatArtifactValue, getRejectionReasonLabel } from "../core/platform.js";

function shortenText(value, limit = 72) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizeStageName(value) {
  return String(value || "").replace(/_/g, "-");
}

export function createArtifactsModule({
  state,
  elements,
  api,
  callbacks,
  dictionaries,
}) {
  const {
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
  } = elements;

  const {
    setMessage,
    getRecordSearchText,
    buildSummaryChips,
  } = callbacks;

  const {
    artifactExplanations,
    artifactCategoryMeta,
    recommendedArtifactsByStage,
  } = dictionaries;

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

    const explanation = artifactExplanations[payload.key] || {
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
    return artifactCategoryMeta[category] || {
      label: category || "Artifacts",
      description: "当前阶段产物。",
    };
  }

  function getRecommendedArtifactKeys(run) {
    if (!run?.last_stage) {
      return ["raw_candidates"];
    }
    return recommendedArtifactsByStage[normalizeStageName(run.last_stage)] || [];
  }

  function getArtifactListHint(artifact) {
    const explanation = artifactExplanations[artifact.key];
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
    const summary = record.user_text || record.input?.user_text || record.raw_output || record.review_comment || "";
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
            <div class="artifact-key-value"><div><strong>sample_count</strong><span>${escapeHtml(formatArtifactValue(object.dataset?.sample_count))}</span></div></div>
            <div class="artifact-key-value"><div><strong>hard_case_sample_count</strong><span>${escapeHtml(formatArtifactValue(object.dataset?.hard_case_sample_count))}</span></div></div>
            <div class="artifact-key-value"><div><strong>no_visible_report_sample_count</strong><span>${escapeHtml(formatArtifactValue(object.dataset?.no_visible_report_sample_count))}</span></div></div>
            <div class="artifact-key-value"><div><strong>label_distribution</strong><span>${escapeHtml(formatArtifactValue(object.dataset?.label_distribution))}</span></div></div>
          </div>
        </section>
        <section class="artifact-object-block">
          <h3>Metrics</h3>
          <div class="artifact-key-grid">
            <div class="artifact-key-value"><div><strong>overall_accuracy</strong><span>${escapeHtml(formatArtifactValue(object.metrics?.overall_accuracy))}</span></div></div>
            <div class="artifact-key-value"><div><strong>macro_f1</strong><span>${escapeHtml(formatArtifactValue(object.metrics?.macro_f1))}</span></div></div>
            <div class="artifact-key-value"><div><strong>json_valid_rate</strong><span>${escapeHtml(formatArtifactValue(object.metrics?.json_valid_rate))}</span></div></div>
            <div class="artifact-key-value"><div><strong>hard_cases_accuracy</strong><span>${escapeHtml(formatArtifactValue(object.metrics?.hard_cases_accuracy))}</span></div></div>
            <div class="artifact-key-value"><div><strong>has_visible_report_false_accuracy</strong><span>${escapeHtml(formatArtifactValue(object.metrics?.has_visible_report_false_accuracy))}</span></div></div>
          </div>
        </section>
        <section class="artifact-object-block">
          <h3>Quality</h3>
          <div class="artifact-key-grid">
            <div class="artifact-key-value"><div><strong>mismatch_count</strong><span>${escapeHtml(formatArtifactValue(object.quality?.mismatch_count))}</span></div></div>
            <div class="artifact-key-value"><div><strong>parse_failure_count</strong><span>${escapeHtml(formatArtifactValue(object.quality?.parse_failure_count))}</span></div></div>
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
            <div class="artifact-key-value"><div><strong>status</strong><span>${escapeHtml(formatArtifactValue(object.promptfoo?.status))}</span></div></div>
            <div class="artifact-key-value"><div><strong>pass_rate</strong><span>${escapeHtml(formatArtifactValue(promptfooSummary.pass_rate))}</span></div></div>
            <div class="artifact-key-value"><div><strong>total_tests</strong><span>${escapeHtml(formatArtifactValue(promptfooSummary.total_tests))}</span></div></div>
            <div class="artifact-key-value"><div><strong>results_path</strong><span>${escapeHtml(formatArtifactValue(object.promptfoo?.results_path))}</span></div></div>
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

  function renderArtifacts() {
    if (!state.selectedRun) {
      artifactListEl.innerHTML = '<div class="empty-state">选择 run 后可查看产物。</div>';
      artifactMetaEl.textContent = "暂无选中 run";
      state.artifactPayload = null;
      renderArtifactStructured(null);
      return;
    }

    const artifacts = getVisibleArtifacts(state.selectedRun);
    if (!artifacts.length) {
      artifactListEl.innerHTML = '<div class="empty-state">当前 run 还没有落盘产物。</div>';
      artifactMetaEl.textContent = "暂无产物";
      state.artifactPayload = null;
      renderArtifactStructured(null);
      return;
    }

    const recommendedKeys = new Set(getRecommendedArtifactKeys(state.selectedRun));
    const groupedArtifacts = groupArtifactsByCategory(artifacts);

    artifactMetaEl.textContent = `${artifacts.length} 个可读产物`;
    artifactListEl.innerHTML = `
      <article class="artifact-nav-overview">
        <div class="artifact-nav-head">
          <div>
            <h3>Artifact Navigator</h3>
            <p>按阶段聚类浏览当前 run 产物，优先查看推荐入口，再深入诊断。</p>
          </div>
          <span class="artifact-nav-count">${escapeHtml(String(artifacts.length))}</span>
        </div>
        <div class="artifact-nav-chip-row">
          <span>${escapeHtml(`last_stage: ${state.selectedRun.last_stage || "created"}`)}</span>
          <span>${escapeHtml(`status: ${state.selectedRun.status || "-"}`)}</span>
          <span>${escapeHtml(`${Object.keys(state.selectedRun.stages || {}).length}/7 stages`)}</span>
        </div>
        ${
          recommendedKeys.size
            ? `
              <div class="artifact-spotlight">
                <strong>Recommended Reads</strong>
                <div class="artifact-spotlight-row">
                  ${artifacts
                    .filter((artifact) => recommendedKeys.has(artifact.key))
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
                    const recommended = recommendedKeys.has(artifact.key);
                    return `
                      <button class="artifact-item ${artifact.key === state.selectedArtifactKey ? "is-active" : ""}" type="button" data-artifact="${artifact.key}">
                        <div class="artifact-item-head">
                          <strong>${escapeHtml(artifact.key)}</strong>
                          <span class="artifact-item-kind">${escapeHtml(artifact.kind)}</span>
                        </div>
                        <span class="artifact-item-role">${escapeHtml(recommended ? "recommended" : categoryInfo.label)}</span>
                        <span>${escapeHtml(getArtifactListHint(artifact))}</span>
                        <div class="artifact-item-diagnostic ${recommended ? "is-recommended" : ""}">
                          <span>${escapeHtml(artifact.relative_path)}</span>
                          <span class="artifact-item-badge">${escapeHtml(`${artifact.size_bytes} bytes`)}</span>
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

  function bindEvents() {
    reloadArtifactButton.addEventListener("click", async () => {
      if (state.selectedArtifactKey) {
        await loadArtifact(state.selectedArtifactKey);
      }
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
  }

  return {
    bindEvents,
    getVisibleArtifacts,
    loadArtifact,
    renderArtifacts,
    renderArtifactStructured,
    renderArtifactViewSwitch,
  };
}
