import React from "react";

import { REVIEW_DECISION_DETAILS } from "../../constants/app.js";
import { getReviewDecisionDetail } from "../../lib/review.js";
import { classNames, formatMetricValue } from "../../lib/utils.js";

export default function ReviewWorkspace({
  reviewPayload,
  setReviewer,
  onSaveReview,
  reviewSummary,
  reviewFilter,
  setReviewFilter,
  filteredReviewRecords,
  reviewLoading,
  onDecisionChange,
  onUpdateRecord,
}) {
  return (
    <div className="panel-grid">
      <section className="panel panel-wide">
        <div className="section-head">
          <div>
            <span className="eyebrow">Human Review</span>
            <h2>人工复核</h2>
          </div>
          <div className="section-inline-actions">
            <input
              className="search-input short"
              type="text"
              value={reviewPayload.reviewer}
              onChange={(event) => setReviewer(event.target.value)}
              placeholder="reviewer"
            />
            <button className="ghost-button" type="button" onClick={onSaveReview}>
              保存 Review
            </button>
          </div>
        </div>

        <div className="summary-chip-row">
          {[
            ["all", "总数", reviewSummary.total],
            ["pending", "待处理", reviewSummary.pending],
            ["accepted", "接受", reviewSummary.accepted],
            ["corrected", "纠正", reviewSummary.corrected],
            ["rejected", "拒绝", reviewSummary.rejected],
          ].map(([filter, label, value]) => (
            <button
              key={filter}
              className={classNames("summary-chip", reviewFilter === filter && "is-active")}
              type="button"
              aria-pressed={reviewFilter === filter}
              onClick={() => setReviewFilter(filter)}
            >
              <span>{label}</span>
              <strong>{value}</strong>
            </button>
          ))}
        </div>

        <div className="review-decision-guide">
          {Object.values(REVIEW_DECISION_DETAILS).map((detail) => (
            <article
              key={detail.label}
              className={classNames("review-guide-card", reviewFilter === detail.label && "is-active")}
            >
              <div className="artifact-record-head">
                <h3>{detail.display}</h3>
                <span className="micro-chip">{detail.label}</span>
              </div>
              <p>{detail.description}</p>
              <span>{detail.requirement}</span>
            </article>
          ))}
        </div>

        <div className="review-toolbar-meta">
          <span>{`completion: ${formatMetricValue("completion_rate", reviewSummary.completionRate)}`}</span>
          <span>{`acceptance: ${formatMetricValue("acceptance_rate", reviewSummary.acceptanceRate)}`}</span>
          <span>{`visible: ${filteredReviewRecords.length}`}</span>
        </div>

        {reviewLoading ? (
          <div className="empty-board compact">
            <strong>正在读取 review pool</strong>
          </div>
        ) : reviewPayload.records.length ? (
          <div className="review-stack">
            {filteredReviewRecords.length ? (
              filteredReviewRecords.map((record) => {
                const index = reviewPayload.records.indexOf(record);
                const decisionDetail = getReviewDecisionDetail(record.review_decision || "pending");
                return (
                  <article key={record.sample_id || index} className="review-card">
                    <header>
                      <div>
                        <strong>{record.sample_id || `sample-${index + 1}`}</strong>
                        <span>{record.teacher_label || "-"}</span>
                      </div>
                      <div className="artifact-chip-row">
                        <span className="micro-chip">{record.context?.dialogue_stage || "unknown"}</span>
                        <span className="micro-chip">
                          {record.context?.has_visible_report ? "has report" : "no report"}
                        </span>
                        {(record.tags || []).slice(0, 3).map((tag) => (
                          <span key={tag} className="micro-chip">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </header>
                    <p>{record.user_text || record.input_text || "无文本"}</p>
                    <div className="review-grid">
                      <label>
                        <span>Decision</span>
                        <select
                          value={record.review_decision || "pending"}
                          onChange={(event) => onDecisionChange(index, event.target.value)}
                        >
                          {Object.values(REVIEW_DECISION_DETAILS).map((detail) => (
                            <option key={detail.label} value={detail.label}>
                              {`${detail.label} | ${detail.display}`}
                            </option>
                          ))}
                        </select>
                        <small className="field-hint">{decisionDetail.description}</small>
                        <small className="field-hint">{decisionDetail.requirement}</small>
                      </label>

                      <label>
                        <span>Reviewer Label</span>
                        <input
                          type="text"
                          value={record.reviewer_label || ""}
                          list={`labels-${index}`}
                          onChange={(event) =>
                            onUpdateRecord(index, (current) => ({
                              ...current,
                              reviewer_label: event.target.value,
                            }))
                          }
                        />
                        <datalist id={`labels-${index}`}>
                          {reviewPayload.labels.map((label) => (
                            <option key={label} value={label} />
                          ))}
                        </datalist>
                        <small className="field-hint">
                          accepted 会自动沿用 teacher_label；corrected 时这里必填。
                        </small>
                      </label>

                      <label>
                        <span>Reviewed By</span>
                        <input
                          type="text"
                          value={record.reviewed_by || ""}
                          onChange={(event) =>
                            onUpdateRecord(index, (current) => ({
                              ...current,
                              reviewed_by: event.target.value,
                            }))
                          }
                        />
                        <small className="field-hint">留空时，保存会优先使用顶部 Reviewer 名称。</small>
                      </label>
                      <label>
                        <span>Reviewed At</span>
                        <input
                          type="text"
                          value={record.reviewed_at || ""}
                          placeholder="留空时保存自动补当前时间"
                          onChange={(event) =>
                            onUpdateRecord(index, (current) => ({
                              ...current,
                              reviewed_at: event.target.value,
                            }))
                          }
                        />
                        <small className="field-hint">
                          可以手动填 ISO 时间；留空时保存自动补当前时间。
                        </small>
                      </label>
                    </div>
                    <label>
                      <span>Comment</span>
                      <textarea
                        rows="3"
                        value={record.review_comment || ""}
                        onChange={(event) =>
                          onUpdateRecord(index, (current) => ({
                            ...current,
                            review_comment: event.target.value,
                          }))
                        }
                      />
                      <small className="field-hint">
                        rejected 时建议明确写出拒绝原因；corrected 时建议说明为什么要改标。
                      </small>
                    </label>
                  </article>
                );
              })
            ) : (
              <div className="empty-board compact">
                <strong>当前筛选下没有 review 记录</strong>
                <p>切换 decision summary chips，或回到全部记录。</p>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-board compact">
            <strong>当前 run 没有 review 记录</strong>
            <p>先执行 review-export，或者切换到已有 review 的 run。</p>
          </div>
        )}
      </section>
    </div>
  );
}
