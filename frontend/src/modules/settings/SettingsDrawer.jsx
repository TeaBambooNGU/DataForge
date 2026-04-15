import React, { useEffect, useState } from "react";

import { classNames, deepClone } from "../../lib/utils.js";
import {
  buildCustomEnvKey,
  getProviderReadyLabel,
  isProviderConfigured,
  normalizeProviderId,
  syncCustomProviderFamily,
} from "../../lib/taskConfig.js";

export default function SettingsDrawer({
  settings,
  settingsDraft,
  settingsView,
  customProviderDraft,
  onClose,
  onReset,
  onAddCustomProvider,
  onCancelCustomProvider,
  onCreateCustomProvider,
  savingSettings,
  providerStatusSummary,
  llmTests,
  testingProvider,
  onRemoveCustomProvider,
  onSaveProvider,
  onTestProvider,
  updateProvider,
  updateCustomProviderDraft,
  setFlashMessage,
}) {
  const [editingProviderName, setEditingProviderName] = useState("");
  const [editingProviderDraft, setEditingProviderDraft] = useState(null);

  useEffect(() => {
    if (settingsView === "create") {
      setEditingProviderName("");
      setEditingProviderDraft(null);
    }
  }, [settingsView]);

  function normalizeEditableDraft(provider) {
    const nextProvider = deepClone(provider);
    if (!nextProvider?.editable) {
      return nextProvider;
    }
    const rawName = String(nextProvider.name || "").trim().toLowerCase();
    const normalizedName = rawName ? normalizeProviderId(rawName) : "";
    nextProvider.name = normalizedName;
    nextProvider.label = normalizedName;
    nextProvider.env_keys.base_url_env = buildCustomEnvKey(
      normalizedName || "custom_provider",
      "BASE_URL"
    );
    nextProvider.env_keys.api_key_env = buildCustomEnvKey(
      normalizedName || "custom_provider",
      "API_KEY"
    );
    return nextProvider;
  }

  function startEditing(provider) {
    setEditingProviderName(provider.name);
    setEditingProviderDraft(deepClone(provider));
  }

  function cancelEditing() {
    setEditingProviderName("");
    setEditingProviderDraft(null);
  }

  function handleReset() {
    cancelEditing();
    onReset();
  }

  function updateEditingDraft(updater) {
    setEditingProviderDraft((current) => {
      if (!current) {
        return current;
      }
      return normalizeEditableDraft(updater(deepClone(current)));
    });
  }

  async function handleSaveEditingProvider(providerName) {
    if (!editingProviderDraft) {
      return;
    }
    await onSaveProvider(providerName, normalizeEditableDraft(editingProviderDraft));
    cancelEditing();
  }

  async function handleProbeProvider(provider, mode) {
    const result = await onTestProvider(provider);
    if (!result?.models?.length) {
      return;
    }
    const nextProvider = {
      ...deepClone(provider),
      models: {
        generator: result.models,
        teacher: result.models,
        eval: result.models,
      },
      config: {
        ...provider.config,
        default_model: result.latest_model || result.model || provider.config.default_model,
      },
    };
    if (mode === "create") {
      updateCustomProviderDraft(() => normalizeEditableDraft(nextProvider));
      return;
    }
    if (mode === "edit") {
      setEditingProviderDraft(normalizeEditableDraft(nextProvider));
    }
  }

  const renderProviderForm = (provider, isCreateMode = false) => {
    if (!provider) {
      return null;
    }
    const isEditing = !isCreateMode && editingProviderName === provider.name && editingProviderDraft;
    const currentProvider = isEditing ? editingProviderDraft : provider;
    const probe = llmTests[currentProvider.name] || llmTests[provider.name];
    const familyMeta =
      settingsDraft.providers.find(
        (item) => item.kind === "builtin" && item.name === currentProvider.implementation
      ) || null;
    const familyRecommendedModel =
      familyMeta?.models?.generator?.find((item) => item.recommended)?.value ||
      familyMeta?.models?.generator?.[0]?.value ||
      "";
    const mode = isCreateMode ? "create" : isEditing ? "edit" : "view";
    const applyUpdate = (providerName, updater) => {
      if (isCreateMode) {
        updateCustomProviderDraft(updater);
        return;
      }
      if (isEditing) {
        updateEditingDraft(updater);
        return;
      }
      updateProvider(providerName, updater);
    };

    return (
      <article
        className={classNames(
          "provider-card",
          isCreateMode && "provider-card-create",
          mode === "view" && "provider-card-readonly"
        )}
      >
        <div className="provider-card-top">
          <div className="provider-head">
            <div className="provider-head-copy">
              <span className="eyebrow">{isCreateMode ? "new custom provider" : currentProvider.kind}</span>
              <h3>{isCreateMode ? "Create Custom Provider" : currentProvider.label || currentProvider.name}</h3>
              <p className="muted-text">
                {isCreateMode
                  ? "先完成 Provider ID、协议族和连接信息，再决定是否写入全局 provider 列表。"
                  : mode === "edit"
                    ? "当前仅编辑这个 provider，保存后会立即同步到全局配置。"
                    : currentProvider.description || "Provider 连接与模型设置。"}
              </p>
            </div>
            <div className="provider-actions">
              {mode === "view" && (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => startEditing(provider)}
                >
                  编辑
                </button>
              )}
              {mode === "edit" && (
                <>
                  <button className="ghost-button" type="button" onClick={cancelEditing}>
                    取消
                  </button>
                  <button className="primary-button" type="button" onClick={() => handleSaveEditingProvider(provider.name)}>
                    单个保存
                  </button>
                </>
              )}
              {mode === "view" && currentProvider.editable && (
                <button
                  className="danger-link"
                  type="button"
                  disabled={savingSettings}
                  onClick={() => onRemoveCustomProvider(currentProvider.name)}
                >
                  删除
                </button>
              )}
              <button
                className={classNames("ghost-button", "provider-test-button", probe?.ok && "is-success")}
                type="button"
                disabled={testingProvider === currentProvider.name}
                onClick={() => handleProbeProvider(currentProvider, mode)}
              >
                <span
                  className={classNames(
                    "provider-test-indicator",
                    probe?.ok && "is-success",
                    testingProvider === currentProvider.name && "is-testing"
                  )}
                  aria-hidden="true"
                />
                {testingProvider === currentProvider.name ? "测试中..." : "测试连接"}
              </button>
            </div>
          </div>

          <div className="provider-summary-grid">
            <article
              className={classNames(
                "summary-chip",
                isProviderConfigured(currentProvider) ? "is-success" : "is-danger"
              )}
            >
              <span>status</span>
              <strong>{getProviderReadyLabel(currentProvider, probe)}</strong>
            </article>
            <article className="summary-chip">
              <span>family</span>
              <strong>{currentProvider.implementation}</strong>
            </article>
            <article
              className={classNames("summary-chip", probe?.ok ? "is-success" : probe ? "is-warning" : "")}
            >
              <span>probe</span>
              <strong>{probe ? (probe.ok ? "passed" : "failed") : "untested"}</strong>
            </article>
            <article className="summary-chip">
              <span>default model</span>
              <strong>{currentProvider.config.default_model || "-"}</strong>
            </article>
          </div>
        </div>

        <div className="config-grid">
          {currentProvider.editable ? (
            <>
              <label>
                <span>Provider ID</span>
                <input
                  type="text"
                  value={currentProvider.name}
                  disabled={mode === "view"}
                  onChange={(event) =>
                    applyUpdate(provider.name, (nextProvider) => {
                      nextProvider.name = event.target.value;
                      return nextProvider;
                    })
                  }
                />
              </label>
              <label>
                <span>Family</span>
                <select
                  value={currentProvider.implementation}
                  disabled={mode === "view"}
                  onChange={(event) => {
                    applyUpdate(provider.name, (nextProvider) =>
                      syncCustomProviderFamily(nextProvider, settingsDraft.providers, event.target.value)
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
              <input type="text" value={currentProvider.name} disabled />
            </label>
          )}

          <label>
            <span>Base URL</span>
            <input
              type="text"
              value={currentProvider.config.base_url}
              disabled={mode === "view"}
              onChange={(event) =>
                applyUpdate(provider.name, (nextProvider) => {
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
              value={currentProvider.config.api_key}
              placeholder={currentProvider.config.api_key_masked || ""}
              disabled={mode === "view"}
              onChange={(event) =>
                applyUpdate(provider.name, (nextProvider) => {
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
              value={currentProvider.config.default_model}
              disabled={mode === "view"}
              onChange={(event) =>
                applyUpdate(provider.name, (nextProvider) => {
                  nextProvider.config.default_model = event.target.value;
                  return nextProvider;
                })
              }
            />
          </label>
        </div>

        {currentProvider.editable && (
          <div className="env-strip provider-env-strip">
            <span>{currentProvider.env_keys.base_url_env}</span>
            <span>{currentProvider.env_keys.api_key_env}</span>
          </div>
        )}

        {currentProvider.editable && (
          <p className="muted-text">
            自定义 provider 会继承所选 family 的调用协议；`Provider ID` 变化时，env key 会自动联动更新。
          </p>
        )}

        {currentProvider.editable && (
          <div className="config-bullet-list compact-list provider-family-guide">
            <span>{familyMeta?.description || "当前 family 决定请求协议、推荐模型和连接期望。"}</span>
            <span>
              {familyRecommendedModel
                ? `推荐默认模型会优先回填为 ${familyRecommendedModel}`
                : "当前 family 暂无推荐默认模型。"}
            </span>
            <span>
              {familyMeta?.env_options?.base_url_env?.length || familyMeta?.env_options?.api_key_env?.length
                ? `builtin env 参考: ${[
                    ...(familyMeta?.env_options?.base_url_env || []),
                    ...(familyMeta?.env_options?.api_key_env || []),
                  ].join(" / ")}`
                : "保存后会为这个自定义 provider 生成独立 env key。"}
            </span>
          </div>
        )}

        <div className="model-strip provider-model-strip">
          {(currentProvider.models?.generator || []).slice(0, 6).map((model) => (
            <span key={model.value} className={classNames("model-pill", model.recommended && "is-recommended")}>
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
  };

  return (
    <div className="overlay">
      <aside className="settings-drawer">
        <div className="settings-drawer-hero">
          <div className="settings-drawer-hero-copy">
            <span className="eyebrow">Global Provider Deck</span>
            <h2>Provider Settings</h2>
            <p className="muted-text">集中管理全局模型连接、默认模型和自定义 provider 协议映射。</p>
          </div>
          <button className="ghost-button settings-drawer-close" type="button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="drawer-toolbar">
          <div className="drawer-toolbar-group">
            {settingsView === "create" ? (
              <>
                <button className="ghost-button" type="button" onClick={onCancelCustomProvider}>
                  返回列表
                </button>
                <button className="ghost-button" type="button" onClick={handleReset}>
                  回退
                </button>
              </>
            ) : (
              <>
                <button className="ghost-button" type="button" onClick={handleReset}>
                  回退
                </button>
                <button className="ghost-button" type="button" onClick={onAddCustomProvider}>
                  新增 Custom Provider
                </button>
              </>
            )}
          </div>
          <div className="drawer-toolbar-group is-primary">
            <p className="muted-text settings-drawer-status">
              {settingsView === "create"
                ? "Custom Provider 会在创建成功后立即写入全局配置"
                : "默认只读；点击单个 provider 的编辑后，再进行局部修改和保存"}
            </p>
            {settingsView === "create" ? (
              <button
                className="primary-button"
                type="button"
                disabled={savingSettings || !customProviderDraft?.name?.trim()}
                onClick={onCreateCustomProvider}
              >
                {savingSettings ? "创建中..." : "创建并保存"}
              </button>
            ) : null}
          </div>
        </div>

        {settingsView === "create" ? (
          <section className="provider-create-panel">
            <div className="provider-create-header">
              <span className="eyebrow">Focused Setup</span>
              <h3>新增 Custom Provider</h3>
              <p className="muted-text">
                当前页面只处理新增动作。完成配置并测试后，再把它加入下方 provider deck。
              </p>
            </div>
            {renderProviderForm(customProviderDraft, true)}
          </section>
        ) : (
          <>
            <div className="settings-summary-grid">
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
              {settingsDraft.providers.map((provider) => (
                <React.Fragment key={provider.name}>{renderProviderForm(provider)}</React.Fragment>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
