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
  filteredArtifactRows,
}) {
  return (
    <div className="panel-grid artifact-layout">
      <section className="panel artifact-sidebar">
        <div className="section-head">
          <div>
            <span className="eyebrow">Run Output</span>
            <h2>Artifacts</h2>
          </div>
        </div>
        {selectedRun ? (
          <div className="artifact-nav-overview">
            <div className="artifact-nav-head">
              <div>
                <h3>Artifact Navigator</h3>
                <p>按阶段聚类浏览当前 run 产物，优先查看推荐入口，再深入诊断。</p>
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
      </section>

      <section className="panel panel-wide">
        <div className="artifact-preview">
          <div className="section-head">
            <div>
              <span className="eyebrow">Artifact Preview</span>
              <h2>{artifactKey || "选择 artifact"}</h2>
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

              <div className="artifact-meta">
                <span>{artifactPayload.kind}</span>
                <span>{artifactPayload.relative_path}</span>
                <span>{ARTIFACT_COPY[artifactPayload.key] || "运行阶段的结构化输出。"}</span>
              </div>

              {artifactSummary.length ? (
                <div className="summary-chip-row">
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
                  filteredArtifactRows={filteredArtifactRows}
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
      </section>
    </div>
  );
}
