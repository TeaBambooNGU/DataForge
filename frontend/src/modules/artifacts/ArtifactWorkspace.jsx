import React from "react";

import { ARTIFACT_COPY, ARTIFACT_EXPLANATIONS, RAW_CANDIDATE_GROUP_OPTIONS } from "../../constants/app.js";
import {
  getArtifactCategoryInfo,
  getArtifactListHint,
  visibleArtifacts,
} from "../../lib/artifacts.js";
import { classNames, formatBytes } from "../../lib/utils.js";
import { ArtifactStructuredContent } from "./ArtifactStructuredViews.jsx";

export default function ArtifactWorkspace({
  selectedRun,
  groupedRunArtifacts,
  recommendedArtifactKeys,
  artifactNavSearch,
  setArtifactNavSearch,
  artifactNavCategoryFilter,
  setArtifactNavCategoryFilter,
  artifactNavCategoryOptions,
  artifactKey,
  setArtifactKey,
  artifactSearch,
  setArtifactSearch,
  artifactFilter,
  setArtifactFilter,
  artifactFilterOptions,
  artifactViewMode,
  setArtifactViewMode,
  artifactPayload,
  artifactSummary,
  artifactLoading,
  rawCandidateViewMode,
  setRawCandidateViewMode,
  rawCandidateGroupBy,
  setRawCandidateGroupBy,
  visibleArtifactRows,
  paginatedRawArtifactContent,
  artifactPagination,
  setArtifactPage,
}) {
  return (
    <div className="panel-grid artifact-layout">
      <section className="panel artifact-sidebar">
        <div className="artifact-sidebar-frame">
          <div className="section-head">
            <div>
              <span className="eyebrow">Run Output</span>
              <h2>产物导航</h2>
            </div>
          </div>
          <div className="artifact-sidebar-body">
            {selectedRun ? (
              <div className="artifact-nav-overview">
                <div className="artifact-nav-hero-card">
                  <div className="artifact-nav-head">
                    <div>
                      <h3>先选一个 artifact</h3>
                      <p>按阶段浏览当前 run 的产物。先看推荐入口，再决定是否深入原始内容。</p>
                    </div>
                    <span className="artifact-nav-count">{visibleArtifacts(selectedRun).length}</span>
                  </div>
                  <div className="artifact-nav-tools">
                    <input
                      className="search-input"
                      type="search"
                      value={artifactNavSearch}
                      onChange={(event) => setArtifactNavSearch(event.target.value)}
                      placeholder="搜索 artifact 名称或路径"
                    />
                    <select
                      className="filter-select"
                      value={artifactNavCategoryFilter}
                      onChange={(event) => setArtifactNavCategoryFilter(event.target.value)}
                    >
                      {artifactNavCategoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="artifact-nav-chip-row">
                    <span>{`last_stage: ${selectedRun.last_stage || "created"}`}</span>
                    <span>{`status: ${selectedRun.status || "-"}`}</span>
                    <span>{`${Object.keys(selectedRun.stages || {}).length}/7 stages`}</span>
                  </div>
                  {(() => {
                    const spotlightArtifacts = groupedRunArtifacts
                      .flatMap(([, items]) => items)
                      .filter((artifact) => recommendedArtifactKeys.has(artifact.key));
                    if (!spotlightArtifacts.length) {
                      return null;
                    }
                    return (
                      <div className="artifact-spotlight">
                        <strong>Recommended Reads</strong>
                        <div className="artifact-spotlight-row">
                          {spotlightArtifacts.map((artifact) => (
                            <button
                              key={artifact.key}
                              className={classNames(
                                "artifact-spotlight-button",
                                artifactKey === artifact.key && "is-active"
                              )}
                              type="button"
                              aria-pressed={artifactKey === artifact.key}
                              onClick={() => setArtifactKey(artifact.key)}
                            >
                              {artifact.key}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {groupedRunArtifacts.length ? (
                  <div className="artifact-list-group">
                    {groupedRunArtifacts.map(([category, items]) => {
                      const categoryInfo = getArtifactCategoryInfo(category);
                      return (
                        <section key={category} className="artifact-nav-group">
                          <div className="artifact-nav-group-head">
                            <div>
                              <h3>{categoryInfo.label}</h3>
                              <p>{categoryInfo.description}</p>
                            </div>
                            <span className="artifact-nav-count">{items.length}</span>
                          </div>
                          <div className="artifact-nav-group-list">
                            {items.map((artifact) => (
                              <button
                                key={artifact.key}
                                className={classNames("artifact-item", artifactKey === artifact.key && "is-active")}
                                type="button"
                                aria-pressed={artifactKey === artifact.key}
                                onClick={() => setArtifactKey(artifact.key)}
                              >
                                <div className="artifact-item-head">
                                  <strong>{artifact.key}</strong>
                                  <span className="artifact-item-kind">{artifact.kind}</span>
                                </div>
                                <span className="artifact-item-role">
                                  {recommendedArtifactKeys.has(artifact.key) ? "recommended" : categoryInfo.label}
                                </span>
                                <span>{getArtifactListHint(artifact)}</span>
                                <div
                                  className={classNames(
                                    "artifact-item-diagnostic",
                                    recommendedArtifactKeys.has(artifact.key) && "is-recommended"
                                  )}
                                >
                                  <span>{artifact.relative_path}</span>
                                  <span className="artifact-item-badge">{formatBytes(artifact.size_bytes)}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-board compact">
                    <strong>没有匹配当前导航筛选的 artifact</strong>
                    <p>改搜索词或切回“全部分类”，再决定先读哪份文件。</p>
                  </div>
                )}
              </div>
            ) : null}

            {!selectedRun?.artifacts?.some((item) => item.exists) && (
              <div className="empty-board compact">
                <strong>没有可读 artifact</strong>
                <p>先推进 run，再回来查看产物。</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel panel-wide">
        <div className="artifact-preview">
          <div className="section-head artifact-preview-head">
            <div className="artifact-preview-title">
              <span className="eyebrow">Artifact Preview</span>
              <h2>{artifactKey || "先选择一个 artifact"}</h2>
            </div>
            <div className="section-inline-actions artifact-toolbar">
              <input
                className="search-input"
                type="search"
                value={artifactSearch}
                onChange={(event) => setArtifactSearch(event.target.value)}
                placeholder="搜索当前 artifact"
                disabled={!artifactPayload || !Array.isArray(artifactPayload.content)}
              />
              <select
                className="filter-select"
                value={artifactFilter}
                onChange={(event) => setArtifactFilter(event.target.value)}
                disabled={!artifactPayload || artifactFilterOptions.length <= 1}
              >
                {artifactFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="segmented-control">
                <button
                  className={classNames("ghost-button", artifactViewMode === "structured" && "is-active")}
                  type="button"
                  aria-pressed={artifactViewMode === "structured"}
                  onClick={() => setArtifactViewMode("structured")}
                >
                  Structured
                </button>
                <button
                  className={classNames("ghost-button", artifactViewMode === "raw" && "is-active")}
                  type="button"
                  aria-pressed={artifactViewMode === "raw"}
                  onClick={() => setArtifactViewMode("raw")}
                >
                  Raw
                </button>
              </div>
            </div>
          </div>

          <div className="artifact-preview-body">
            {artifactPayload ? (
              <>
                <article className="artifact-explainer-card">
                  <div className="artifact-record-head">
                    <div>
                      <h3>{artifactPayload.key}</h3>
                      <p>
                        {ARTIFACT_EXPLANATIONS[artifactPayload.key]?.role ||
                          "该文件是当前 run 的中间产物或报告文件。"}
                      </p>
                    </div>
                    <span className="micro-chip">
                      {ARTIFACT_EXPLANATIONS[artifactPayload.key]?.stage ||
                        artifactPayload.category ||
                        "-"}
                    </span>
                  </div>
                  {artifactSummary.length ? (
                    <div className="summary-chip-row artifact-summary-row">
                      {artifactSummary.map((item) => (
                        <article
                          key={`${artifactPayload.key}-${item.label}`}
                          className={classNames("summary-chip", item.tone && `is-${item.tone}`)}
                        >
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <div className="artifact-meta">
                    <span>{artifactPayload.kind}</span>
                    <span>{artifactPayload.relative_path}</span>
                    <span>{ARTIFACT_COPY[artifactPayload.key] || "运行阶段的结构化输出。"}</span>
                  </div>
                  <div className="artifact-explainer-grid">
                    <div className="artifact-detail-block">
                      <strong>作用</strong>
                      <span>
                        {ARTIFACT_EXPLANATIONS[artifactPayload.key]?.role ||
                          ARTIFACT_COPY[artifactPayload.key] ||
                          "运行阶段的结构化输出。"}
                      </span>
                    </div>
                    <div className="artifact-detail-block">
                      <strong>典型用途</strong>
                      <span>
                        {ARTIFACT_EXPLANATIONS[artifactPayload.key]?.usage ||
                          "用于理解当前阶段的输出结果。"}
                      </span>
                    </div>
                    <div className="artifact-detail-block artifact-detail-block-wide">
                      <strong>阅读建议</strong>
                      <span>
                        {ARTIFACT_EXPLANATIONS[artifactPayload.key]?.readingHint ||
                          "结合顶部摘要和结构化视图一起阅读。"}
                      </span>
                    </div>
                  </div>
                </article>

                {artifactPayload.key === "raw_candidates" && artifactViewMode === "structured" ? (
                  <div className="section-inline-actions raw-candidate-toolbar">
                    <div className="segmented-control">
                      <button
                        className={classNames("ghost-button", rawCandidateViewMode === "table" && "is-active")}
                        type="button"
                        aria-pressed={rawCandidateViewMode === "table"}
                        onClick={() => setRawCandidateViewMode("table")}
                      >
                        Table
                      </button>
                      <button
                        className={classNames(
                          "ghost-button",
                          rawCandidateViewMode === "category" && "is-active"
                        )}
                        type="button"
                        aria-pressed={rawCandidateViewMode === "category"}
                        onClick={() => setRawCandidateViewMode("category")}
                      >
                        Category
                      </button>
                    </div>
                    {rawCandidateViewMode === "category" ? (
                      <select
                        className="filter-select"
                        value={rawCandidateGroupBy}
                        onChange={(event) => setRawCandidateGroupBy(event.target.value)}
                      >
                        {RAW_CANDIDATE_GROUP_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : null}

                {artifactLoading ? (
                  <div className="empty-board compact">
                    <strong>正在读取 artifact</strong>
                  </div>
                ) : (
                  <ArtifactStructuredContent
                    artifactPayload={artifactPayload}
                    artifactViewMode={artifactViewMode}
                    visibleArtifactRows={visibleArtifactRows}
                    paginatedRawArtifactContent={paginatedRawArtifactContent}
                    rawCandidateViewMode={rawCandidateViewMode}
                    rawCandidateGroupBy={rawCandidateGroupBy}
                  />
                )}
              </>
            ) : artifactLoading ? (
              <div className="empty-board compact">
                <strong>正在读取 artifact</strong>
              </div>
            ) : (
              <div className="empty-board compact">
                <strong>先从左侧选择一个 artifact</strong>
              </div>
            )}
          </div>

          {artifactPagination.pageCount > 1 ? (
            <div className="artifact-pagination">
              <span className="artifact-pagination-summary">
                {`${artifactPagination.startItem}-${artifactPagination.endItem} / ${artifactPagination.totalItems} ${artifactPagination.unitLabel}`}
              </span>
              <div className="artifact-pagination-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setArtifactPage(artifactPagination.page - 1)}
                  disabled={artifactPagination.page <= 1}
                >
                  上一页
                </button>
                <span className="micro-chip subdued">
                  {`第 ${artifactPagination.page} / ${artifactPagination.pageCount} 页`}
                </span>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setArtifactPage(artifactPagination.page + 1)}
                  disabled={artifactPagination.page >= artifactPagination.pageCount}
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
