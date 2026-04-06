import { REVIEW_DECISION_DETAILS } from "../core/constants.js";
import { escapeHtml } from "../core/platform.js";
import { renderReviewDecisionGuide, renderReviewDecisionOptions } from "../core/review.js";

export function createReviewModule({
  state,
  elements,
  api,
  callbacks,
}) {
  const { reviewListEl, reviewSummaryEl, reviewerInputEl, reloadReviewButton, saveReviewButton } = elements;
  const { setMessage, setCommandLoading, loadRunDetails } = callbacks;

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

  function bindEvents() {
    reloadReviewButton.addEventListener("click", loadReviewRecords);
    saveReviewButton.addEventListener("click", saveReviewRecords);
  }

  return {
    bindEvents,
    loadReviewRecords,
    renderReviews,
    renderReviewSummary,
    saveReviewRecords,
  };
}
