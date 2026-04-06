import { REVIEW_DECISION_DETAILS } from "../constants/app.js";

export function getReviewDecisionDetail(decision) {
  return REVIEW_DECISION_DETAILS[decision] || REVIEW_DECISION_DETAILS.pending;
}

export function buildReviewSummary(summary, records) {
  return {
    total: summary?.total ?? records.length,
    pending:
      summary?.pending ??
      records.filter((record) => (record.review_decision || "pending") === "pending").length,
    accepted:
      summary?.accepted ?? records.filter((record) => record.review_decision === "accepted").length,
    corrected:
      summary?.corrected ?? records.filter((record) => record.review_decision === "corrected").length,
    rejected:
      summary?.rejected ?? records.filter((record) => record.review_decision === "rejected").length,
    completionRate:
      summary?.completion_rate ??
      (records.length
        ? (
            records.filter((record) =>
              ["accepted", "corrected", "rejected"].includes(record.review_decision || "pending")
            ).length / records.length
          ).toFixed(4)
        : 0),
    acceptanceRate: summary?.acceptance_rate ?? 0,
  };
}

export function reviewRecordMatchesFilter(record, filter) {
  if (filter === "all") {
    return true;
  }
  return (record.review_decision || "pending") === filter;
}
