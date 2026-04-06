import { REVIEW_DECISION_DETAILS } from "./constants.js";
import { escapeHtml } from "./platform.js";

export function getReviewDecisionDetail(decision) {
  return REVIEW_DECISION_DETAILS[decision] || REVIEW_DECISION_DETAILS.pending;
}

export function renderReviewDecisionOptions(selectedDecision) {
  return Object.values(REVIEW_DECISION_DETAILS)
    .map(
      (detail) => `
        <option value="${escapeHtml(detail.label)}" ${selectedDecision === detail.label ? "selected" : ""}>
          ${escapeHtml(`${detail.label} | ${detail.display}`)}
        </option>
      `
    )
    .join("");
}

export function renderReviewDecisionGuide(selectedDecision) {
  const active = getReviewDecisionDetail(selectedDecision);
  return `
    <div class="review-decision-active-note">
      <div class="review-decision-item-head">
        <strong>当前选择：${escapeHtml(`${active.label} | ${active.display}`)}</strong>
      </div>
      <p>${escapeHtml(active.description)}</p>
      <span class="review-decision-item-note">${escapeHtml(active.requirement)}</span>
    </div>
  `;
}
