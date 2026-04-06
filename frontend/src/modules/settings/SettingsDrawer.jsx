import React from "react";

import { classNames } from "../../lib/utils.js";
import { getProviderReadyLabel, isProviderConfigured, syncCustomProviderFamily } from "../../lib/taskConfig.js";

export default function SettingsDrawer({
  settings,
  settingsDraft,
  onClose,
  onReset,
  onAddCustomProvider,
  savingSettings,
  onSaveSettings,
  providerStatusSummary,
  llmTests,
  testingProvider,
  onRemoveCustomProvider,
  onTestProvider,
  updateProvider,
  setFlashMessage,
  settingsDirty,
}) {
  return (
    <div className="overlay">
      <aside className="settings-drawer">
        <div className="section-head">
          <div>
            <span className="eyebrow">Global Provider Deck</span>
            <h2>Provider Settings</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="drawer-toolbar">
          <button className="ghost-button" type="button" onClick={onReset}>
            回退
          </button>
          <button className="ghost-button" type="button" onClick={onAddCustomProvider}>
            新增 Custom Provider
          </button>
          <button className="primary-button" type="button" disabled={savingSettings} onClick={onSaveSettings}>
            {savingSettings ? "保存中..." : "保存全部设置"}
          </button>
        </div>

        <div className="summary-chip-row">
          <article className="summary-chip">
            <span>providers</span>
            <strong>{providerStatusSummary.total}</strong>
          </article>
          <article className="summary-chip is-success">
            <span>configured</span>
            <strong>{providerStatusSummary.configured}</strong>
          </article>
          <article className="summary-chip is-warning">
            <span>ready</span>
            <strong>{providerStatusSummary.ready}</strong>
          </article>
          <article className="summary-chip">
            <span>probed</span>
            <strong>{providerStatusSummary.probed}</strong>
          </article>
        </div>

        <div className="provider-stack">
          {settingsDraft.providers.map((provider) => {
            const probe = llmTests[provider.name];
            const familyMeta =
              settingsDraft.providers.find(
                (item) => item.kind === "builtin" && item.name === provider.implementation
              ) || null;
            const familyRecommendedModel =
              familyMeta?.models?.generator?.find((item) => item.recommended)?.value ||
              familyMeta?.models?.generator?.[0]?.value ||
              "";
            return (
              <article key={provider.name} className="provider-card">
                <div className="provider-head">
                  <div>
                    <span className="eyebrow">{provider.kind}</span>
                    <h3>{provider.label || provider.name}</h3>
                    <p className="muted-text">{provider.description || "Provider 连接与模型设置。"}</p>
                  </div>
                  <div className="provider-actions">
                    {provider.editable && (
                      <button
                        className="danger-link"
                        type="button"
                        onClick={() => onRemoveCustomProvider(provider.name)}
                      >
                        Delete
                      </button>
                    )}
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={testingProvider === provider.name}
                      onClick={() => onTestProvider(provider)}
                    >
                      {testingProvider === provider.name ? "Testing..." : "Test"}
                    </button>
                  </div>
                </div>

                <div className="summary-chip-row">
                  <article
                    className={classNames(
                      "summary-chip",
                      isProviderConfigured(provider) ? "is-success" : "is-danger"
                    )}
                  >
                    <span>status</span>
                    <strong>{getProviderReadyLabel(provider, probe)}</strong>
                  </article>
                  <article className="summary-chip">
                    <span>family</span>
                    <strong>{provider.implementation}</strong>
                  </article>
                  <article
                    className={classNames(
                      "summary-chip",
                      probe?.ok ? "is-success" : probe ? "is-warning" : ""
                    )}
                  >
                    <span>probe</span>
                    <strong>{probe ? (probe.ok ? "passed" : "failed") : "untested"}</strong>
                  </article>
                  <article className="summary-chip">
                    <span>default model</span>
                    <strong>{provider.config.default_model || "-"}</strong>
                  </article>
                </div>

                <div className="config-grid">
                  {provider.editable ? (
                    <>
                      <label>
                        <span>Provider ID</span>
                        <input
                          type="text"
                          value={provider.name}
                          onChange={(event) =>
                            updateProvider(provider.name, (nextProvider) => {
                              nextProvider.name = event.target.value;
                              return nextProvider;
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Family</span>
                        <select
                          value={provider.implementation}
                          onChange={(event) => {
                            updateProvider(provider.name, (nextProvider) =>
                              syncCustomProviderFamily(
                                nextProvider,
                                settingsDraft.providers,
                                event.target.value
                              )
                            );
                            setFlashMessage(`已切换 ${provider.name} 的协议族`, "warning");
                          }}
                        >
                          <option value="openai_compatible">openai_compatible</option>
                          <option value="anthropic_compatible">anthropic_compatible</option>
                          <option value="minimax">minimax</option>
                        </select>
                      </label>
                    </>
                  ) : (
                    <label>
                      <span>Provider</span>
                      <input type="text" value={provider.name} disabled />
                    </label>
                  )}

                  <label>
                    <span>Base URL</span>
                    <input
                      type="text"
                      value={provider.config.base_url}
                      onChange={(event) =>
                        updateProvider(provider.name, (nextProvider) => {
                          nextProvider.config.base_url = event.target.value;
                          return nextProvider;
                        })
                      }
                    />
                  </label>

                  <label>
                    <span>API Key</span>
                    <input
                      type="password"
                      value={provider.config.api_key}
                      placeholder={provider.config.api_key_masked || ""}
                      onChange={(event) =>
                        updateProvider(provider.name, (nextProvider) => {
                          nextProvider.config.api_key = event.target.value;
                          return nextProvider;
                        })
                      }
                    />
                  </label>

                  <label>
                    <span>Default Model</span>
                    <input
                      type="text"
                      value={provider.config.default_model}
                      onChange={(event) =>
                        updateProvider(provider.name, (nextProvider) => {
                          nextProvider.config.default_model = event.target.value;
                          return nextProvider;
                        })
                      }
                    />
                  </label>
                </div>

                {provider.editable && (
                  <div className="env-strip">
                    <span>{provider.env_keys.base_url_env}</span>
                    <span>{provider.env_keys.api_key_env}</span>
                  </div>
                )}

                {provider.editable && (
                  <p className="muted-text">
                    自定义 provider 会继承所选 family 的调用协议；`Provider ID` 变化时，env key 会自动联动更新。
                  </p>
                )}

                {provider.editable && (
                  <div className="config-bullet-list compact-list provider-family-guide">
                    <span>{familyMeta?.description || "当前 family 决定请求协议、推荐模型和连接期望。"}</span>
                    <span>
                      {familyRecommendedModel
                        ? `推荐默认模型会优先回填为 ${familyRecommendedModel}`
                        : "当前 family 暂无推荐默认模型。"}
                    </span>
                    <span>
                      {familyMeta?.env_options?.base_url_env?.length ||
                      familyMeta?.env_options?.api_key_env?.length
                        ? `builtin env 参考: ${[
                            ...(familyMeta?.env_options?.base_url_env || []),
                            ...(familyMeta?.env_options?.api_key_env || []),
                          ].join(" / ")}`
                        : "保存后会为这个自定义 provider 生成独立 env key。"}
                    </span>
                  </div>
                )}

                <div className="model-strip">
                  {(provider.models?.generator || []).slice(0, 6).map((model) => (
                    <span
                      key={model.value}
                      className={classNames("model-pill", model.recommended && "is-recommended")}
                    >
                      {model.value}
                    </span>
                  ))}
                  {!provider.models?.generator?.length && <span className="muted-text">尚未探测模型</span>}
                </div>

                {probe && (
                  <div className={classNames("probe-result", probe.ok ? "ok" : "error")}>
                    <strong>{probe.ok ? "Connection OK" : "Connection Failed"}</strong>
                    <span>{probe.endpoint}</span>
                    <span>{probe.latest_model || probe.model || "未识别模型"}</span>
                    {probe.ok && probe.latest_model ? <p>{`已回填推荐模型: ${probe.latest_model}`}</p> : null}
                    {probe.models_error ? <p>{`模型探测提示: ${probe.models_error}`}</p> : null}
                    {!probe.ok && <p>{probe.error}</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <p className="muted-text">{settingsDirty ? "存在未保存修改" : "当前 provider deck 已同步"}</p>
      </aside>
    </div>
  );
}
