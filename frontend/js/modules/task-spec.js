import { cloneData, escapeHtml, formatArtifactValue } from "../core/platform.js";
import { createEmptyScenario, normalizeTaskConfigFiles } from "../core/task-config.js";

function estimateScenarioSamples(scenario) {
  const count = Number(scenario?.generation_count || 0);
  if (Number.isInteger(count) && count > 0) {
    return count;
  }
  return (scenario?.templates || []).filter(Boolean).length;
}

function totalEstimatedSamples(scenarios = []) {
  return scenarios.reduce((sum, scenario) => sum + estimateScenarioSamples(scenario), 0);
}

function configInputValue(value) {
  return value == null ? "" : String(value);
}

function buildSummaryChips(items) {
  return items
    .filter(([, value]) => value != null)
    .map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</span>`)
    .join("");
}

function renderKeyGrid(target, items) {
  target.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="task-spec-key">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(formatArtifactValue(value))}</span>
        </div>
      `
    )
    .join("");
}

function coercePrimitiveInput(value) {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (!Number.isNaN(Number(trimmed)) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.includes(".") ? Number.parseFloat(trimmed) : Number.parseInt(trimmed, 10);
  }
  return trimmed;
}

function normalizeLlmProviderEntry(provider = {}) {
  const normalized = {
    ...provider,
    label: provider.label || provider.name || "",
    description: provider.description || "",
    badge: provider.badge || "",
    implementation: provider.implementation || provider.name || "",
    kind: provider.kind || "builtin",
    editable: Boolean(provider.editable),
    env_keys: {
      base_url_env: provider.env_keys?.base_url_env || "",
      api_key_env: provider.env_keys?.api_key_env || "",
      model_env: provider.env_keys?.model_env || "",
    },
    config: {
      base_url: provider.config?.base_url || "",
      api_key: provider.config?.api_key || "",
      default_model: provider.config?.default_model || "",
      has_api_key: Boolean(provider.config?.has_api_key),
      api_key_masked: provider.config?.api_key_masked || "",
    },
  };
  syncDerivedProviderEnvKeys(normalized);
  return normalized;
}

function normalizeLlmSettings(payload) {
  return {
    providers: Array.isArray(payload?.providers) ? payload.providers.map((provider) => normalizeLlmProviderEntry(provider)) : [],
  };
}

function normalizeDiscoveredModels(models, latestModel = "") {
  const normalized = [];
  const seen = new Set();
  const preferred = String(latestModel || "").trim();
  for (const item of Array.isArray(models) ? models : []) {
    const value = String(item?.value || item?.id || "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push({
      value,
      label: String(item?.label || item?.display_name || value).trim() || value,
      recommended: Boolean(item?.recommended),
    });
  }
  const recommendedValue = preferred || normalized.find((item) => item.recommended)?.value || normalized[0]?.value || "";
  return normalized.map((item) => ({
    ...item,
    recommended: item.value === recommendedValue,
  }));
}

function buildStageModelCatalog(models) {
  return {
    generator: cloneData(models),
    teacher: cloneData(models),
    eval: cloneData(models),
  };
}

function hasLlmSettingsChanges(settings, originalSettings) {
  return !!settings && !!originalSettings && JSON.stringify(settings) !== JSON.stringify(originalSettings);
}

function buildCustomProviderName(settings) {
  const used = new Set((settings?.providers || []).map((provider) => String(provider.name || "").trim()).filter(Boolean));
  let index = 1;
  let candidate = `custom_provider_${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `custom_provider_${index}`;
  }
  return candidate;
}

function normalizeProviderId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/_+/g, "_");
  return normalized || "custom_provider";
}

function buildCustomEnvKey(providerName, suffix) {
  return String(providerName || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") + `_${suffix}`;
}

function syncDerivedProviderEnvKeys(provider) {
  if (!provider?.editable) {
    return;
  }
  const providerName = normalizeProviderId(provider.name);
  provider.name = providerName;
  provider.label = providerName;
  provider.env_keys.base_url_env = buildCustomEnvKey(providerName, "BASE_URL");
  provider.env_keys.api_key_env = buildCustomEnvKey(providerName, "API_KEY");
}

function buildProviderFamilies(state) {
  const providers = state.llmSettings?.providers || [];
  return providers
    .filter((provider) => provider.kind === "builtin" && provider.name !== "mock")
    .map((provider) => ({
      value: provider.name,
      label: provider.label || provider.name,
      badge: provider.badge || provider.name,
    }));
}

function getBuiltinProviderSettings(settings, providerName) {
  return (settings?.providers || []).find((provider) => provider.kind === "builtin" && provider.name === providerName) || null;
}

function getRecommendedProviderModel(provider, stage = "generator") {
  const models = Array.isArray(provider?.models?.[stage]) ? provider.models[stage] : [];
  return models.find((item) => item.recommended)?.value || models[0]?.value || "";
}

function syncCustomProviderFamily(settings, provider, implementation) {
  const family = getBuiltinProviderSettings(settings, implementation);
  if (!family) {
    provider.implementation = implementation;
    return;
  }
  const previousDefaultModel = provider.config?.default_model || "";
  const previousRecommended = getRecommendedProviderModel(provider);
  provider.implementation = implementation;
  provider.models = cloneData(family.models || {});
  if (!provider.description || provider.description === family.description) {
    provider.description = family.description || "";
  }
  if (!previousDefaultModel || previousDefaultModel === previousRecommended) {
    provider.config.default_model = getRecommendedProviderModel(family);
  }
}

const RUNTIME_STAGE_META = {
  generator: {
    index: "01",
    eyebrow: "Sample Forge",
    title: "Generator",
    description: "决定候选样本怎么被生成，先选 provider，再确认模型和控制参数。",
  },
  teacher: {
    index: "02",
    eyebrow: "Label Judge",
    title: "Teacher",
    description: "决定教师标注链路的稳定性，优先保证 JSON 输出与标签边界一致。",
  },
  eval: {
    index: "03",
    eyebrow: "Benchmark Lens",
    title: "Eval",
    description: "决定 gold 集上的回放评测行为，通常与 teacher 接近但不必完全相同。",
  },
};

const DIFFICULTY_OPTIONS = ["easy", "medium", "hard"];
const DIALOGUE_STAGE_OPTIONS = ["standalone", "followup"];

function formatDialogueStageLabel(value) {
  if (value === "followup") {
    return "追问";
  }
  if (value === "standalone") {
    return "独立提问";
  }
  return value || "-";
}

function getRuntimeProviders(state) {
  return Array.isArray(state.runtimeCatalog?.providers) ? state.runtimeCatalog.providers : [];
}

function getRuntimeFieldCatalog(state) {
  return Array.isArray(state.runtimeCatalog?.fields) ? state.runtimeCatalog.fields : [];
}

function getProviderMeta(state, providerName) {
  return getRuntimeProviders(state).find((provider) => provider.name === providerName) || null;
}

function getGlobalLlmProvider(state, providerName) {
  return state.llmSettings?.providers?.find((provider) => provider.name === providerName) || null;
}

function isGlobalLlmConfigured(provider) {
  if (!provider) {
    return false;
  }
  return provider.name === "mock" || provider.config?.has_api_key || Boolean(String(provider.config?.api_key || "").trim());
}

function getProviderModelOptions(state, providerName, stage) {
  const provider = getProviderMeta(state, providerName);
  const models = provider?.models?.[stage];
  return Array.isArray(models) ? models : [];
}

function getRecommendedModel(state, providerName, stage) {
  const options = getProviderModelOptions(state, providerName, stage);
  return options.find((item) => item.recommended)?.value || options[0]?.value || "";
}

function syncRuntimeCatalogProviderModels(state, providerName, models) {
  if (!state.runtimeCatalog || !Array.isArray(state.runtimeCatalog.providers)) {
    return;
  }
  const provider = state.runtimeCatalog.providers.find((item) => item.name === providerName);
  if (!provider) {
    return;
  }
  provider.models = buildStageModelCatalog(models);
}

function getKnownRuntimeKeys(state, providerName) {
  const fieldKeys = getRuntimeFieldCatalog(state).map((field) => field.key);
  const providerFieldKeys = getProviderMeta(state, providerName)?.provider_fields || [];
  return new Set(["provider", "model", ...fieldKeys, ...providerFieldKeys]);
}

function getRuntimeCustomEntries(state, stage, config = {}) {
  const knownKeys = getKnownRuntimeKeys(state, config.provider);
  return Object.entries(config || {}).filter(([key]) => !knownKeys.has(key));
}

function buildRuntimePreset(state, stage, providerName, currentConfig = {}, options = {}) {
  const provider = getProviderMeta(state, providerName);
  if (!provider) {
    return { ...currentConfig, provider: providerName };
  }
  const { keepCurrentModel = false } = options;
  const customEntries = Object.fromEntries(getRuntimeCustomEntries(state, stage, currentConfig));
  const nextConfig = {
    ...customEntries,
    ...(provider.defaults || {}),
    provider: providerName,
  };
  const currentModel = currentConfig.model;
  const validModels = getProviderModelOptions(state, providerName, stage);
  const hasCurrentModel = validModels.some((item) => item.value === currentModel);
  nextConfig.model = keepCurrentModel && hasCurrentModel
    ? currentModel
    : getRecommendedModel(state, providerName, stage);
  return nextConfig;
}

function buildRuntimePresetFromGlobal(state, stage, providerName, currentConfig = {}) {
  const nextConfig = buildRuntimePreset(state, stage, providerName, currentConfig);
  const globalProvider = getGlobalLlmProvider(state, providerName);
  if (!globalProvider) {
    return nextConfig;
  }
  const defaultModel = String(globalProvider.config?.default_model || "").trim();
  if (defaultModel) {
    nextConfig.model = defaultModel;
  }
  const baseUrlEnv = globalProvider.env_keys?.base_url_env;
  const apiKeyEnv = globalProvider.env_keys?.api_key_env;
  if (baseUrlEnv) {
    nextConfig.base_url_env = baseUrlEnv;
  }
  if (apiKeyEnv) {
    nextConfig.api_key_env = apiKeyEnv;
  }
  return nextConfig;
}

function buildRuntimeStageSummary(state, stage, config = {}) {
  const provider = getProviderMeta(state, config.provider);
  const summaryParts = [
    provider?.label || config.provider || "未选择 provider",
    config.model || "未选择模型",
  ];
  if (config.max_retries != null && config.max_retries !== "") {
    summaryParts.push(`retries ${config.max_retries}`);
  }
  return summaryParts.join(" · ");
}

function renderRuntimeFieldControl(field, stage, value, provider) {
  const currentValue = value == null ? "" : value;
  const fieldLabel = field.label || field.key;

  if (field.type === "boolean") {
    return `
      <label class="config-field runtime-config-field">
        <span>${escapeHtml(fieldLabel)}</span>
        <select data-runtime-stage="${escapeHtml(stage)}" data-runtime-key="${escapeHtml(field.key)}">
          <option value="true" ${currentValue === true || currentValue === "true" ? "selected" : ""}>true</option>
          <option value="false" ${currentValue === false || currentValue === "false" ? "selected" : ""}>false</option>
        </select>
      </label>
    `;
  }

  if (field.type === "env-select") {
    const providerOptions = Array.isArray(provider?.env_options?.[field.key]) ? provider.env_options[field.key] : [];
    const options = Array.from(new Set([...providerOptions, String(currentValue || "")].filter(Boolean)));
    return `
      <label class="config-field runtime-config-field">
        <span>${escapeHtml(fieldLabel)}</span>
        <select data-runtime-stage="${escapeHtml(stage)}" data-runtime-key="${escapeHtml(field.key)}">
          ${options
            .map(
              (option) => `
                <option value="${escapeHtml(option)}" ${String(currentValue) === option ? "selected" : ""}>${escapeHtml(option)}</option>
              `
            )
            .join("")}
        </select>
      </label>
    `;
  }

  const type = field.type === "number" ? "number" : "text";
  const min = field.min != null ? `min="${escapeHtml(String(field.min))}"` : "";
  const max = field.max != null ? `max="${escapeHtml(String(field.max))}"` : "";
  const step = field.step != null ? `step="${escapeHtml(String(field.step))}"` : "";

  return `
    <label class="config-field runtime-config-field">
      <span>${escapeHtml(fieldLabel)}</span>
      <input
        data-runtime-stage="${escapeHtml(stage)}"
        data-runtime-key="${escapeHtml(field.key)}"
        type="${type}"
        value="${escapeHtml(configInputValue(currentValue))}"
        ${min}
        ${max}
        ${step}
      />
    </label>
  `;
}

export function createTaskSpecModule({
  state,
  elements,
  api,
  callbacks,
}) {
  const {
    taskSpecReadViewEl,
    taskSpecEditViewEl,
    promptViewSwitchEl,
    editTaskConfigButton,
    resetTaskConfigButton,
    saveTaskConfigButton,
    reloadTaskConfigButton,
    taskConfigAdviceEl,
    addScenarioButton,
    taskConfigStatusEl,
    taskConfigSummaryEl,
    taskConfigImpactEl,
    llmProviderGridEl,
    llmDeckStatusEl,
    llmDeckMetaEl,
    addLlmProviderButton,
    reloadLlmSettingsButton,
    saveLlmSettingsButton,
    taskMetaFormEl,
    taskRuntimeEditorEl,
    taskRulesEditorEl,
    taskExportsEditorEl,
    taskLabelsEditorEl,
    taskScenarioSummaryEl,
    taskScenarioEditorEl,
    taskPromptEditorEl,
    taskDossierHeroEl,
    taskSpecOverviewEl,
    taskSpecLabelsEl,
    taskSpecRulesEl,
    taskSpecExportsEl,
    taskRuntimeGridEl,
    taskScenarioGridEl,
    taskPromptMetaEl,
    taskPromptPreviewEl,
  } = elements;

  const {
    syncConfigDirty,
    setConfigStatus,
    setMessage,
    loadTasks,
    renderTasks,
    renderSummary,
    renderSidebarSettings,
  } = callbacks;

  function renderPromptSwitch() {
    promptViewSwitchEl.querySelectorAll("[data-prompt-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.promptView === state.promptView);
    });
  }

  function renderTaskSpecMode() {
    const hasTask = !!state.taskSpec;
    const editing = hasTask && state.isEditingTaskConfig;

    taskSpecReadViewEl.hidden = editing;
    taskSpecEditViewEl.hidden = !hasTask || !editing;
    promptViewSwitchEl.hidden = !hasTask || editing;
    editTaskConfigButton.hidden = !hasTask || editing;
    resetTaskConfigButton.hidden = !editing;
    saveTaskConfigButton.hidden = !editing;
    reloadTaskConfigButton.hidden = !hasTask;
    reloadTaskConfigButton.textContent = editing ? "从磁盘重载" : "重载配置";

    if (!hasTask) {
      taskConfigAdviceEl.textContent = "选择 task 后显示任务配置与新建入口。";
      return;
    }

    taskConfigAdviceEl.textContent = editing
      ? "你正在编辑真实配置文件。保存后只影响后续新 run，不会回写已有运行产物。"
      : "当前为只读任务配置。点击“编辑配置”后进入独立编辑页面。";
  }

  function renderConfigStatusActions() {
    const disabled = !state.taskConfig || state.configSaving;
    renderTaskSpecMode();
    reloadTaskConfigButton.disabled = !state.selectedTask || state.configSaving;
    editTaskConfigButton.disabled = disabled;
    resetTaskConfigButton.disabled = disabled;
    saveTaskConfigButton.disabled = disabled || !state.configDirty;
    addScenarioButton.disabled = disabled || !state.isEditingTaskConfig;
  }

  function setLlmDeckStatus(message, tone = "neutral") {
    llmDeckStatusEl.textContent = message;
    llmDeckStatusEl.dataset.tone = tone;
  }

  function renderLlmDeckActions() {
    addLlmProviderButton.disabled = !state.llmSettings || state.llmSettingsSaving || !!state.llmTestingProvider;
    reloadLlmSettingsButton.disabled = state.llmSettingsSaving || !!state.llmTestingProvider;
    saveLlmSettingsButton.disabled = !state.llmSettings || state.llmSettingsSaving || !state.llmSettingsDirty;
  }

  function renderLlmDeck() {
    if (!state.llmSettings) {
      llmProviderGridEl.innerHTML = '<div class="empty-state">尚未加载全局 LLM 配置。</div>';
      setLlmDeckStatus("选择 task 或刷新工作台后加载全局配置。");
      llmDeckMetaEl.textContent = "连通性测试会使用当前卡片中的即时输入值。";
      renderLlmDeckActions();
      return;
    }

    const providerFamilies = buildProviderFamilies(state);
    llmDeckMetaEl.textContent = state.llmSettingsDirty
      ? "存在未保存的全局修改。测试按钮会优先使用当前表单值；自定义 provider 元数据会写入 .dataforge/runtime_providers.json。"
      : "当前卡片展示的是 workspace 级 provider 配置；内置项保存到项目根 .env，自定义 provider 额外写入 .dataforge/runtime_providers.json。";
    llmProviderGridEl.innerHTML = state.llmSettings.providers
      .map((provider) => {
        const config = provider.config || {};
        const providerModels = Array.isArray(provider.models?.generator) ? provider.models.generator : [];
        const configured = isGlobalLlmConfigured(provider);
        const testing = state.llmTestingProvider === provider.name;
        const testResult = state.llmTestResults?.[provider.name];
        const statusTone = testResult ? (testResult.ok ? "success" : "error") : (configured ? "ready" : "idle");
        const statusLabel = testResult
          ? (testResult.ok ? "连通通过" : "连通失败")
          : (configured ? "已配置" : "待配置");
        const editable = Boolean(provider.editable);
        const familyLabel = providerFamilies.find((item) => item.value === provider.implementation)?.label || provider.implementation;
        const providerIdHint = editable ? "task runtime 会直接引用这个 provider id" : "内置 provider id 固定，不支持改名";
        const envSummary = `${provider.env_keys?.base_url_env || "内置默认"} / ${provider.env_keys?.api_key_env || "本地 mock"}`;

        return `
          <article class="llm-provider-card llm-provider-card-${escapeHtml(provider.name)}" data-llm-provider-card="${escapeHtml(provider.name)}">
            <div class="llm-provider-card-head">
              <div>
                <p class="llm-provider-kicker">${escapeHtml(provider.badge || "workspace")}</p>
                <h4>${escapeHtml(provider.label || provider.name)}</h4>
              </div>
              <span class="llm-provider-status is-${escapeHtml(statusTone)}">${escapeHtml(statusLabel)}</span>
            </div>

            <p class="llm-provider-description">${escapeHtml(provider.description || "")}</p>

            <div class="llm-provider-telemetry">
              <span><strong>provider</strong>${escapeHtml(provider.name)}</span>
              <span><strong>family</strong>${escapeHtml(familyLabel || "-")}</span>
              <span><strong>default model</strong>${escapeHtml(config.default_model || "-")}</span>
            </div>

            <div class="llm-provider-form">
              ${
                editable
                  ? `
                    <div class="llm-provider-meta-grid">
                      <label class="config-field">
                        <span>Provider ID</span>
                        <input
                          data-llm-provider="${escapeHtml(provider.name)}"
                          data-llm-meta="name"
                          type="text"
                          value="${escapeHtml(configInputValue(provider.name))}"
                          placeholder="例如 qwen_relay"
                        />
                      </label>
                      <label class="config-field">
                        <span>Family</span>
                        <select data-llm-provider="${escapeHtml(provider.name)}" data-llm-meta="implementation">
                          ${providerFamilies
                            .map(
                              (item) => `
                                <option value="${escapeHtml(item.value)}" ${item.value === provider.implementation ? "selected" : ""}>
                                  ${escapeHtml(item.label)}
                                </option>
                              `
                            )
                            .join("")}
                        </select>
                      </label>
                    </div>
                    <p class="llm-provider-inline-note">${escapeHtml(`${providerIdHint} · Env: ${envSummary}`)}</p>
                  `
                  : `
                    <p class="llm-provider-inline-note">${escapeHtml(`${providerIdHint} · Env: ${envSummary}`)}</p>
                  `
              }

              <label class="config-field config-field-full">
                <span>Base URL</span>
                <input
                  data-llm-provider="${escapeHtml(provider.name)}"
                  data-llm-config="base_url"
                  type="text"
                  placeholder="留空则使用 provider 内置默认端点"
                  value="${escapeHtml(configInputValue(config.base_url))}"
                />
              </label>

              <label class="config-field config-field-full">
                <span>API Key</span>
                <input
                  data-llm-provider="${escapeHtml(provider.name)}"
                  data-llm-config="api_key"
                  type="password"
                  placeholder="${escapeHtml(config.has_api_key ? `已保存 ${config.api_key_masked || ""}，留空保持不变` : "输入 API Key")}"
                  value="${escapeHtml(configInputValue(config.api_key))}"
                />
              </label>

              <label class="config-field config-field-full">
                <span>Default Model</span>
                <input
                  data-llm-provider="${escapeHtml(provider.name)}"
                  data-llm-config="default_model"
                  type="text"
                  value="${escapeHtml(configInputValue(config.default_model))}"
                  placeholder="这里的模型会作为 task runtime 的快捷套用值"
                />
              </label>

              ${
                providerModels.length
                  ? `
                    <div class="llm-model-rack">
                      ${providerModels
                        .map(
                          (item) => `
                            <button
                              class="llm-model-chip ${item.value === config.default_model ? "is-active" : ""}"
                              type="button"
                              data-llm-model="${escapeHtml(item.value)}"
                              data-llm-provider="${escapeHtml(provider.name)}"
                            >
                              <span>${escapeHtml(item.label || item.value)}</span>
                              ${item.recommended ? '<em>推荐</em>' : ""}
                            </button>
                          `
                        )
                        .join("")}
                    </div>
                  `
                  : ""
              }
            </div>

            <div class="llm-provider-actions">
              <div class="llm-provider-button-row">
                <button
                  class="ghost-button"
                  type="button"
                  data-llm-action="test"
                  data-llm-provider="${escapeHtml(provider.name)}"
                  ${testing ? "disabled" : ""}
                >
                  ${testing ? "测试中..." : "测试连通"}
                </button>
                ${
                  editable
                    ? `
                      <button
                        class="ghost-button danger-ghost-button"
                        type="button"
                        data-llm-action="delete"
                        data-llm-provider="${escapeHtml(provider.name)}"
                      >
                        删除 Provider
                      </button>
                    `
                    : ""
                }
              </div>
              <span class="llm-provider-hint">
                ${configured ? "保存后可在 task runtime 中直接套用这套全局设置。" : "至少配置 API Key 后再做真实探活。"}
              </span>
            </div>

            <div class="llm-provider-result ${testResult ? `is-${testResult.ok ? "success" : "error"}` : ""}">
              ${
                testResult
                  ? `
                    <strong>${escapeHtml(testResult.ok ? "连通成功" : "连通失败")}</strong>
                    <span>${escapeHtml(testResult.endpoint || "-")}</span>
                    <span>${escapeHtml(`${testResult.model || "-"} · ${testResult.latency_ms ?? 0} ms`)}</span>
                    <p>${escapeHtml(testResult.preview || testResult.error || "无额外返回内容")}</p>
                  `
                  : `
                    <strong>Probe</strong>
                    <span>尚未执行连通性测试</span>
                    <p>这里会显示 endpoint、模型和延迟，便于快速判断当前全局配置是否可用。</p>
                  `
              }
            </div>
          </article>
        `;
      })
      .join("");
    renderLlmDeckActions();
  }

  function renderConfigSummary() {
    if (!state.taskConfig) {
      taskConfigSummaryEl.innerHTML = "";
      taskConfigImpactEl.innerHTML = "";
      return;
    }

    renderKeyGrid(taskConfigSummaryEl, [
      ["estimated_samples", totalEstimatedSamples(state.taskConfig.scenarios || [])],
      ["labels", (state.taskConfig.labels || []).length],
      ["scenarios", (state.taskConfig.scenarios || []).length],
      ["generator_provider", state.taskConfig.runtime?.generator?.provider || "-"],
      ["teacher_provider", state.taskConfig.runtime?.teacher?.provider || "-"],
    ]);
    renderKeyGrid(taskConfigImpactEl, [
      ["generate", "受场景矩阵和 generator prompt 影响"],
      ["classify", "受 labels、teacher prompt、teacher runtime 影响"],
      ["filter-export", "受 rules 和 labels 影响"],
      ["eval", "受 labels、eval runtime 与 gold 构建结果影响"],
    ]);
  }

  function renderTaskMetaForm() {
    if (!state.taskConfig) {
      taskMetaFormEl.innerHTML = "";
      return;
    }
    const task = state.taskConfig.task || {};
    taskMetaFormEl.innerHTML = `
      <div class="config-static-grid">
        <div class="config-static-item">
          <strong>Task Name</strong>
          <span>${escapeHtml(configInputValue(task.name) || "-")}</span>
        </div>
        <div class="config-static-item">
          <strong>Task Type</strong>
          <span>${escapeHtml(configInputValue(task.task_type) || "-")}</span>
        </div>
        <div class="config-static-item">
          <strong>Entry Schema</strong>
          <span>${escapeHtml(configInputValue(task.entry_schema) || "-")}</span>
        </div>
      </div>
      <label class="config-field">
        <span>Theme</span>
        <input data-config-section="task" data-config-key="theme" type="text" value="${escapeHtml(
          configInputValue(task.theme)
        )}" />
      </label>
      <label class="config-field">
        <span>Language</span>
        <input data-config-section="task" data-config-key="language" type="text" value="${escapeHtml(
          configInputValue(task.language)
        )}" />
      </label>
    `;
  }

  function renderPrimitiveEditor(target, sectionName, payload) {
    target.innerHTML = Object.entries(payload || {})
      .map(
        ([key, value]) => `
          <label class="config-field">
            <span>${escapeHtml(`${sectionName}.${key}`)}</span>
            <input data-config-section="${escapeHtml(sectionName)}" data-config-key="${escapeHtml(key)}" type="text" value="${escapeHtml(
              configInputValue(value)
            )}" />
          </label>
        `
      )
      .join("");
  }

  function renderTaskRuntimeEditor() {
    if (!state.taskConfig) {
      taskRuntimeEditorEl.innerHTML = "";
      return;
    }
    const stages = state.runtimeCatalog?.stages || Object.keys(state.taskConfig.runtime || {});
    taskRuntimeEditorEl.innerHTML = stages
      .map((stage) => {
        const config = state.taskConfig.runtime?.[stage] || {};
        const stageMeta = RUNTIME_STAGE_META[stage] || {
          index: "--",
          eyebrow: "Runtime Stage",
          title: stage,
          description: "配置当前 stage 的 provider、model 和高级参数。",
        };
        const providerName = config.provider || getRuntimeProviders(state)[0]?.name || "";
        const provider = getProviderMeta(state, providerName);
        const modelOptions = getProviderModelOptions(state, providerName, stage);
        const currentModel = config.model || getRecommendedModel(state, providerName, stage);
        const fieldCatalog = getRuntimeFieldCatalog(state);
        const commonFields = fieldCatalog.filter((field) => field.bucket === "common");
        const providerFieldKeys = provider?.provider_fields || [];
        const providerFields = fieldCatalog.filter((field) => providerFieldKeys.includes(field.key));
        const customEntries = getRuntimeCustomEntries(state, stage, config);
        const advancedOpen = !!state.runtimeAdvancedOpen?.[stage];
        const manualModelOpen = !!state.runtimeManualModelOpen?.[stage];
        const globalProvider = getGlobalLlmProvider(state, providerName);
        const globalReady = isGlobalLlmConfigured(globalProvider);
        const showManualModelField = manualModelOpen || !modelOptions.length || !modelOptions.some((item) => item.value === currentModel);

        return `
          <article class="config-runtime-card runtime-stage-card is-${escapeHtml(stage)}">
            <div class="runtime-stage-head">
              <div class="runtime-stage-index">${escapeHtml(stageMeta.index)}</div>
              <div class="runtime-stage-copy">
                <p class="runtime-stage-eyebrow">${escapeHtml(stageMeta.eyebrow)}</p>
                <h4>${escapeHtml(stageMeta.title)}</h4>
                <p class="runtime-stage-description">${escapeHtml(stageMeta.description)}</p>
              </div>
              <div class="runtime-stage-summary">${escapeHtml(buildRuntimeStageSummary(state, stage, config))}</div>
            </div>

            <div class="runtime-selection-block">
              <div class="runtime-selection-head">
                <strong>Provider</strong>
                <span>优先选已有接入方式，不再手动写 provider 名称。</span>
              </div>
              <div class="runtime-provider-rack">
                ${getRuntimeProviders(state)
                  .map(
                    (entry) => `
                      <button
                        class="runtime-provider-chip ${entry.name === providerName ? "is-active" : ""}"
                        type="button"
                        data-runtime-provider="${escapeHtml(entry.name)}"
                        data-runtime-stage="${escapeHtml(stage)}"
                      >
                        <span class="runtime-provider-label">${escapeHtml(entry.label)}</span>
                        <span class="runtime-provider-note">${escapeHtml(entry.badge || entry.description || "")}</span>
                      </button>
                    `
                  )
                  .join("")}
              </div>
              <p class="runtime-provider-description">${escapeHtml(provider?.description || "请选择一个 provider。")}</p>
              <div class="runtime-global-bridge ${globalReady ? "is-ready" : "is-idle"}">
                <strong>${escapeHtml(globalReady ? "Global Deck Ready" : "Global Deck Pending")}</strong>
                <span>${escapeHtml(
                  globalReady
                    ? `${provider?.label || providerName} 已在全局配置中就绪，可直接套用 env 引用与默认模型。`
                    : "当前 provider 还没有可套用的全局 API Key。"
                )}</span>
              </div>
            </div>

            <div class="runtime-selection-block">
              <div class="runtime-selection-head">
                <strong>Model</strong>
                <span>先用推荐模型，再按 stage 目的微调。</span>
              </div>
              <div class="runtime-model-rack">
                ${modelOptions
                  .map(
                    (item) => `
                      <button
                        class="runtime-model-chip ${item.value === currentModel ? "is-active" : ""}"
                        type="button"
                        data-runtime-model="${escapeHtml(item.value)}"
                        data-runtime-stage="${escapeHtml(stage)}"
                      >
                        <span>${escapeHtml(item.label || item.value)}</span>
                        ${item.recommended ? '<em>推荐</em>' : ""}
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>

            <div class="runtime-actions-row">
              <button
                class="ghost-button"
                type="button"
                data-runtime-action="apply-global"
                data-runtime-stage="${escapeHtml(stage)}"
                ${globalReady ? "" : "disabled"}
              >
                套用全局配置
              </button>
              <button
                class="ghost-button"
                type="button"
                data-runtime-action="apply-recommended"
                data-runtime-stage="${escapeHtml(stage)}"
              >
                应用推荐配置
              </button>
              <button
                class="ghost-button"
                type="button"
                data-runtime-action="toggle-custom-model"
                data-runtime-stage="${escapeHtml(stage)}"
              >
                ${showManualModelField ? "收起手动模型" : "手动填写模型"}
              </button>
              <button
                class="ghost-button runtime-advanced-toggle ${advancedOpen ? "is-active" : ""}"
                type="button"
                data-runtime-action="toggle-advanced"
                data-runtime-stage="${escapeHtml(stage)}"
              >
                ${advancedOpen ? "收起高级参数" : "展开高级参数"}
              </button>
            </div>

            ${
              showManualModelField
                ? `
                  <label class="config-field runtime-model-custom-field">
                    <span>其他模型</span>
                    <input
                      data-runtime-stage="${escapeHtml(stage)}"
                      data-runtime-key="model"
                      type="text"
                      value="${escapeHtml(configInputValue(currentModel))}"
                      placeholder="当推荐列表没有目标模型时再手动填写"
                    />
                  </label>
                `
                : ""
            }

            <div class="runtime-advanced-panel" ${advancedOpen ? "" : "hidden"}>
              <div class="runtime-advanced-grid">
                ${commonFields.map((field) => renderRuntimeFieldControl(field, stage, config[field.key], provider)).join("")}
                ${providerFields.map((field) => renderRuntimeFieldControl(field, stage, config[field.key], provider)).join("")}
              </div>
              ${
                customEntries.length
                  ? `
                    <div class="runtime-custom-block">
                      <div class="runtime-selection-head">
                        <strong>Custom Params</strong>
                        <span>保留当前 task 中 catalog 未覆盖的运行时字段。</span>
                      </div>
                      <div class="runtime-custom-grid">
                        ${customEntries
                          .map(
                            ([key, value]) => `
                              <label class="config-field runtime-config-field">
                                <span>${escapeHtml(key)}</span>
                                <input
                                  data-runtime-stage="${escapeHtml(stage)}"
                                  data-runtime-key="${escapeHtml(key)}"
                                  type="text"
                                  value="${escapeHtml(configInputValue(value))}"
                                />
                              </label>
                            `
                          )
                          .join("")}
                      </div>
                    </div>
                  `
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderTaskLabelsEditor() {
    if (!state.taskConfig) {
      taskLabelsEditorEl.innerHTML = "";
      return;
    }
    const labels = state.taskConfig.labels || [];
    taskLabelsEditorEl.innerHTML = `
      <div class="config-chip-list">
        ${labels
          .map(
            (label, index) => `
              <span class="config-chip">
                ${escapeHtml(label)}
                <button class="config-chip-remove" data-label-index="${index}" type="button">移除</button>
              </span>
            `
          )
          .join("")}
      </div>
      <div class="config-inline-input">
        <input id="newLabelInput" type="text" placeholder="新增 label，例如 summarize_report" />
        <button class="ghost-button" id="addLabelButton" type="button">添加 Label</button>
      </div>
    `;
  }

  function renderTaskScenarioSummary() {
    if (!state.taskConfig) {
      taskScenarioSummaryEl.innerHTML = "";
      return;
    }
    taskScenarioSummaryEl.innerHTML = buildSummaryChips([
      ["scenarios", String((state.taskConfig.scenarios || []).length)],
      ["estimated_samples", String(totalEstimatedSamples(state.taskConfig.scenarios || []))],
      [
        "high_risk",
        String((state.taskConfig.scenarios || []).filter((scenario) => scenario.difficulty === "hard").length),
      ],
    ]);
  }

  function renderTaskScenarioEditor() {
    if (!state.taskConfig) {
      taskScenarioEditorEl.innerHTML = "";
      return;
    }
    taskScenarioEditorEl.innerHTML = (state.taskConfig.scenarios || [])
      .map((scenario, index) => {
        const templates = (scenario.templates || []).join("\n");
        const tags = (scenario.tags || []).join(", ");
        const advancedOpen = !!state.scenarioAdvancedOpen?.[index];
        return `
          <article class="config-scenario-card" data-scenario-index="${index}">
            <div class="config-section-head">
              <div>
                <h4>${escapeHtml(`Scenario ${index + 1}`)}</h4>
                <p>预计生成 ${escapeHtml(String(estimateScenarioSamples(scenario)))} 条样本</p>
              </div>
              <div class="config-section-actions">
                <button class="ghost-button" data-toggle-scenario-advanced="${index}" type="button">
                  ${advancedOpen ? "收起高级设置" : "展开高级设置"}
                </button>
                <button class="ghost-button" data-remove-scenario="${index}" type="button">删除</button>
              </div>
            </div>
            <div class="config-form-grid">
              <label class="config-field">
                <span>intent</span>
                <input data-scenario-field="intent" data-scenario-index="${index}" type="text" value="${escapeHtml(
                  configInputValue(scenario.intent)
                )}" />
              </label>
              <label class="config-field">
                <span>difficulty</span>
                <select data-scenario-field="difficulty" data-scenario-index="${index}">
                  ${DIFFICULTY_OPTIONS
                    .map(
                      (option) => `
                        <option value="${escapeHtml(option)}" ${option === scenario.difficulty ? "selected" : ""}>${escapeHtml(option)}</option>
                      `
                    )
                    .join("")}
                </select>
              </label>
              <label class="config-field">
                <span>generation_count</span>
                <input data-scenario-field="generation_count" data-scenario-index="${index}" type="number" min="1" placeholder="留空则使用 templates 条数" value="${escapeHtml(
                  configInputValue(scenario.generation_count)
                )}" />
              </label>
              <label class="config-field config-field-full">
                <span>templates</span>
                <textarea data-scenario-field="templates" data-scenario-index="${index}" rows="4" placeholder="每行一条模板">${escapeHtml(
                  templates
                )}</textarea>
              </label>
            </div>
            <div class="config-scenario-advanced" ${advancedOpen ? "" : "hidden"}>
              <div class="config-form-grid">
                <label class="config-field">
                  <span>tags</span>
                  <input data-scenario-field="tags" data-scenario-index="${index}" type="text" placeholder="逗号分隔" value="${escapeHtml(
                    configInputValue(tags)
                  )}" />
                </label>
                <label class="config-field">
                  <span>dialogue_stage</span>
                  <select data-scenario-context="dialogue_stage" data-scenario-index="${index}">
                    ${DIALOGUE_STAGE_OPTIONS
                      .map(
                        (option) => `
                          <option value="${escapeHtml(option)}" ${option === scenario.context?.dialogue_stage ? "selected" : ""}>${escapeHtml(
                            formatDialogueStageLabel(option)
                          )}</option>
                        `
                      )
                      .join("")}
                  </select>
                </label>
                <label class="config-field config-field-toggle">
                  <span>has_visible_report</span>
                  <select data-scenario-context="has_visible_report" data-scenario-index="${index}">
                    <option value="true" ${scenario.context?.has_visible_report ? "selected" : ""}>true</option>
                    <option value="false" ${scenario.context?.has_visible_report ? "" : "selected"}>false</option>
                  </select>
                </label>
                <label class="config-field">
                  <span>language override</span>
                  <input data-scenario-context="language" data-scenario-index="${index}" type="text" value="${escapeHtml(
                    configInputValue(scenario.context?.language)
                  )}" />
                </label>
                <label class="config-field config-field-full">
                  <span>previous_report_summary</span>
                  <textarea data-scenario-context="previous_report_summary" data-scenario-index="${index}" rows="2">${escapeHtml(
                    configInputValue(scenario.context?.previous_report_summary)
                  )}</textarea>
                </label>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderTaskPromptEditor() {
    if (!state.taskConfig) {
      taskPromptEditorEl.innerHTML = "";
      return;
    }
    taskPromptEditorEl.innerHTML = `
      <label class="config-field config-field-full">
        <span>Generator Prompt</span>
        <textarea data-prompt-field="generator_prompt" rows="10">${escapeHtml(
          state.taskConfig.generator_prompt || ""
        )}</textarea>
      </label>
      <label class="config-field config-field-full">
        <span>Teacher Prompt</span>
        <textarea data-prompt-field="teacher_prompt" rows="10">${escapeHtml(
          state.taskConfig.teacher_prompt || ""
        )}</textarea>
      </label>
    `;
  }

  function buildTaskSpecView() {
    if (!state.taskSpec) {
      return null;
    }
    if (!state.taskConfig) {
      return state.taskSpec;
    }
    return {
      ...state.taskSpec,
      ...state.taskConfig.task,
      runtime: state.taskConfig.runtime,
      rules: state.taskConfig.rules,
      exports: state.taskConfig.exports,
      labels: state.taskConfig.labels,
      scenarios: state.taskConfig.scenarios,
      generator_prompt: state.taskConfig.generator_prompt,
      teacher_prompt: state.taskConfig.teacher_prompt,
    };
  }

  function renderTaskSpecReadOnly(view) {
    const runCount = state.selectedTask?.run_count || 0;
    const estimatedSamples = totalEstimatedSamples(state.taskConfig?.scenarios || view.scenarios || []);
    taskDossierHeroEl.innerHTML = `
      <div class="task-dossier-ribbon">Task Dossier</div>
      <div class="task-dossier-grid">
        <div>
          <p class="task-dossier-eyebrow">${escapeHtml(view.task_type || "task")}</p>
          <h3 class="task-dossier-title">${escapeHtml(view.name)}</h3>
          <p class="task-dossier-copy">
            这里只保留新建前真正需要确认的配置：标签、场景、模型和提示词。历史 run 的推进与诊断放到其他页签。
          </p>
        </div>
        <div class="task-dossier-matrix">
          <span><strong>theme</strong>${escapeHtml(view.theme || "-")}</span>
          <span><strong>language</strong>${escapeHtml(view.language || "-")}</span>
          <span><strong>labels</strong>${escapeHtml(String((view.labels || []).length))}</span>
          <span><strong>runs</strong>${escapeHtml(String(runCount))}</span>
        </div>
      </div>
      <div class="task-dossier-foot">
        <span>${escapeHtml(runCount ? `${runCount} 条运行记录可追溯` : "还没有 run，适合先校对定义后启动首轮")}</span>
        <span>${escapeHtml(`estimated samples: ${estimatedSamples}`)}</span>
      </div>
    `;

    renderKeyGrid(taskSpecOverviewEl, [
      ["theme", view.theme],
      ["language", view.language],
      ["entry_schema", view.entry_schema],
    ]);

    taskSpecLabelsEl.innerHTML = (view.labels || [])
      .map((label) => `<span class="task-spec-chip">${escapeHtml(label)}</span>`)
      .join("");
    renderKeyGrid(taskSpecRulesEl, Object.entries(view.rules || {}));
    renderKeyGrid(taskSpecExportsEl, Object.entries(view.exports || {}));

    taskRuntimeGridEl.innerHTML = Object.entries(view.runtime || {})
      .map(
        ([stage, config]) => `
          <article class="task-runtime-card">
            <h3>${escapeHtml(stage)}</h3>
            <div class="task-runtime-meta">
              <span><strong>provider</strong>: ${escapeHtml(formatArtifactValue(config?.provider || "-"))}</span>
              <span><strong>model</strong>: ${escapeHtml(formatArtifactValue(config?.model || "-"))}</span>
              <span><strong>retries</strong>: ${escapeHtml(formatArtifactValue(config?.max_retries ?? "-"))}</span>
            </div>
          </article>
        `
      )
      .join("");

    taskScenarioGridEl.innerHTML = (view.scenarios || [])
      .map(
        (scenario, index) => `
          <article class="task-scenario-card">
            <h3>${escapeHtml(`${index + 1}. ${scenario.intent}`)}</h3>
            <div class="task-spec-chip-group">
              <span class="task-spec-chip">${escapeHtml(scenario.difficulty || "-")}</span>
              ${(scenario.tags || []).map((tag) => `<span class="task-spec-chip">${escapeHtml(tag)}</span>`).join("")}
            </div>
            <p>${escapeHtml((scenario.templates || []).slice(0, 2).join(" / ") || "暂无模板")}</p>
            <div class="task-spec-key-grid">
              <div class="task-spec-key">
                <strong>samples</strong>
                <span>${escapeHtml(String(estimateScenarioSamples(scenario)))}</span>
              </div>
              <div class="task-spec-key">
                <strong>report context</strong>
                <span>${escapeHtml(scenario.context?.has_visible_report ? "有报告上下文" : "无报告上下文")}</span>
              </div>
              <div class="task-spec-key">
                <strong>dialogue</strong>
                <span>${escapeHtml(formatDialogueStageLabel(scenario.context?.dialogue_stage))}</span>
              </div>
            </div>
          </article>
        `
      )
      .join("");

    const promptText = state.promptView === "generator" ? view.generator_prompt : view.teacher_prompt;
    const runtimeConfig = state.promptView === "generator" ? view.runtime?.generator : view.runtime?.teacher;
    taskPromptMetaEl.innerHTML = buildSummaryChips([
      ["view", `${state.promptView}_prompt`],
      ["provider", runtimeConfig?.provider || "-"],
      ["model", runtimeConfig?.model || "-"],
    ]);
    taskPromptPreviewEl.textContent = promptText || "暂无 prompt";
  }

  function renderTaskSpec() {
    renderLlmDeck();
    if (!state.taskSpec) {
      taskDossierHeroEl.innerHTML = '<div class="empty-state">选择 task 后显示任务配置。</div>';
      taskSpecOverviewEl.innerHTML = '<div class="empty-state">选择 task 后显示任务配置。</div>';
      taskSpecLabelsEl.innerHTML = "";
      taskSpecRulesEl.innerHTML = "";
      taskSpecExportsEl.innerHTML = "";
      taskRuntimeGridEl.innerHTML = "";
      taskScenarioGridEl.innerHTML = '<div class="empty-state">暂无 scenario。</div>';
      taskPromptMetaEl.innerHTML = "";
      taskPromptPreviewEl.textContent = "选择 task 后显示 prompt";
      taskConfigSummaryEl.innerHTML = "";
      taskConfigImpactEl.innerHTML = "";
      taskMetaFormEl.innerHTML = "";
      taskRuntimeEditorEl.innerHTML = "";
      taskRulesEditorEl.innerHTML = "";
      taskExportsEditorEl.innerHTML = "";
      taskLabelsEditorEl.innerHTML = "";
      taskScenarioSummaryEl.innerHTML = "";
      taskScenarioEditorEl.innerHTML = "";
      taskPromptEditorEl.innerHTML = "";
      setConfigStatus("选择 task 后显示可编辑配置");
      renderConfigStatusActions();
      renderPromptSwitch();
      return;
    }
    renderTaskSpecReadOnly(buildTaskSpecView());
    renderConfigSummary();
    renderTaskMetaForm();
    renderTaskRuntimeEditor();
    renderPrimitiveEditor(taskRulesEditorEl, "rules", state.taskConfig?.rules || {});
    renderPrimitiveEditor(taskExportsEditorEl, "exports", state.taskConfig?.exports || {});
    renderTaskLabelsEditor();
    renderTaskScenarioSummary();
    renderTaskScenarioEditor();
    renderTaskPromptEditor();
    renderConfigStatusActions();
    renderPromptSwitch();
  }

  async function loadLlmSettings() {
    setLlmDeckStatus("正在加载全局 LLM 配置...");
    renderLlmDeckActions();
    try {
      const payload = await api("/api/settings/llm");
      state.llmSettings = normalizeLlmSettings(cloneData(payload));
      state.originalLlmSettings = normalizeLlmSettings(cloneData(payload));
      state.llmSettingsDirty = false;
      setLlmDeckStatus("全局配置已加载", "success");
      renderLlmDeck();
      renderSidebarSettings();
      renderTaskRuntimeEditor();
    } catch (error) {
      setLlmDeckStatus(error.message, "error");
      llmProviderGridEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
      renderLlmDeckActions();
      throw error;
    }
  }

  async function loadTaskSpec(options = {}) {
    const { preserveEditing = false } = options;
    if (!state.selectedTask) {
      state.taskSpec = null;
      state.taskConfig = null;
      state.originalTaskConfig = null;
      state.runtimeCatalog = null;
      state.isEditingTaskConfig = false;
      syncConfigDirty();
      renderTaskSpec();
      return;
    }
    const [specPayload, configPayload] = await Promise.all([
      api(`/api/tasks/${state.selectedTask.name}/spec`),
      api(`/api/tasks/${state.selectedTask.name}/config-files`),
    ]);
    state.taskSpec = specPayload;
    state.taskConfig = normalizeTaskConfigFiles(cloneData(configPayload));
    state.originalTaskConfig = normalizeTaskConfigFiles(cloneData(configPayload));
    state.runtimeCatalog = cloneData(configPayload.runtime_catalog || null);
    state.isEditingTaskConfig = preserveEditing ? state.isEditingTaskConfig : false;
    syncConfigDirty();
    setConfigStatus("配置已加载");
    renderTaskSpec();
  }

  function updateLlmSettings(mutator) {
    if (!state.llmSettings) {
      return;
    }
    mutator(state.llmSettings);
    state.llmSettings = normalizeLlmSettings(state.llmSettings);
    state.llmSettingsDirty = hasLlmSettingsChanges(state.llmSettings, state.originalLlmSettings);
    setLlmDeckStatus(state.llmSettingsDirty ? "存在未保存的全局修改" : "全局配置已同步", state.llmSettingsDirty ? "warning" : "success");
    renderLlmDeck();
    renderSidebarSettings();
    renderTaskRuntimeEditor();
  }

  function addCustomProvider() {
    if (!state.llmSettings) {
      return;
    }
    updateLlmSettings((draft) => {
      const providerName = buildCustomProviderName(draft);
      const family = getBuiltinProviderSettings(draft, "openai_compatible");
      draft.providers.push({
        name: providerName,
        label: providerName,
        description: "新增一个可视化维护的 provider 别名，运行时会映射到现有实现族。",
        badge: "custom",
        implementation: "openai_compatible",
        kind: "custom",
        editable: true,
        models: cloneData(family?.models || {}),
        env_keys: {
          base_url_env: buildCustomEnvKey(providerName, "BASE_URL"),
          api_key_env: buildCustomEnvKey(providerName, "API_KEY"),
          model_env: "",
        },
        config: {
          base_url: "",
          api_key: "",
          default_model: getRecommendedProviderModel(family),
          has_api_key: false,
          api_key_masked: "",
        },
      });
      syncDerivedProviderEnvKeys(draft.providers[draft.providers.length - 1]);
    });
  }

  async function saveLlmSettings() {
    if (!state.llmSettings) {
      setMessage("当前没有可保存的全局 LLM 配置。", "error");
      return;
    }

    state.llmSettingsSaving = true;
    setLlmDeckStatus("正在保存全局 LLM 配置...");
    renderLlmDeckActions();

    try {
      const payload = await api("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify({
          providers: state.llmSettings.providers.map((provider) => ({
            name: provider.name,
            label: provider.label || "",
            description: provider.description || "",
            badge: provider.badge || "",
            implementation: provider.implementation || "",
            base_url_env: provider.env_keys?.base_url_env || "",
            api_key_env: provider.env_keys?.api_key_env || "",
            base_url: provider.config?.base_url || "",
            api_key: provider.config?.api_key || "",
            default_model: provider.config?.default_model || "",
            models: provider.models || {},
          })),
        }),
      });
      state.llmSettings = normalizeLlmSettings(cloneData(payload.settings));
      state.originalLlmSettings = normalizeLlmSettings(cloneData(payload.settings));
      state.llmSettingsDirty = false;
      setLlmDeckStatus("全局配置保存成功", "success");
      setMessage("全局 LLM 配置已保存", "success");
      renderLlmDeck();
      renderSidebarSettings();
      renderTaskRuntimeEditor();
    } catch (error) {
      setLlmDeckStatus(error.message, "error");
      setMessage(error.message, "error");
    } finally {
      state.llmSettingsSaving = false;
      renderLlmDeckActions();
    }
  }

  async function testLlmConnection(providerName) {
    const provider = getGlobalLlmProvider(state, providerName);
    if (!provider || state.llmTestingProvider) {
      return;
    }

    state.llmTestingProvider = providerName;
    setLlmDeckStatus(`正在测试 ${provider.label || providerName} ...`);
    renderLlmDeck();
    try {
      const result = await api("/api/settings/llm/test", {
        method: "POST",
        body: JSON.stringify({
          provider: providerName,
          implementation: provider.implementation || "",
          base_url_env: provider.env_keys?.base_url_env || "",
          api_key_env: provider.env_keys?.api_key_env || "",
          base_url: provider.config?.base_url || "",
          api_key: provider.config?.api_key || "",
          default_model: provider.config?.default_model || "",
        }),
      });
      state.llmTestResults[providerName] = result;
      let syncedModelCount = 0;
      const discoveredModels = normalizeDiscoveredModels(result.models, result.latest_model);
      if (result.ok && discoveredModels.length) {
        syncedModelCount = discoveredModels.length;
        const discoveredDefaultModel = String(result.latest_model || "").trim() || discoveredModels[0]?.value || "";
        syncRuntimeCatalogProviderModels(state, providerName, discoveredModels);
        updateLlmSettings((draft) => {
          const draftProvider = draft.providers.find((item) => item.name === providerName);
          if (!draftProvider) {
            return;
          }
          draftProvider.models = buildStageModelCatalog(discoveredModels);
          if (discoveredDefaultModel) {
            draftProvider.config.default_model = discoveredDefaultModel;
          }
        });
      }
      setLlmDeckStatus(
        result.ok ? `${provider.label || providerName} 连通通过` : `${provider.label || providerName} 连通失败`,
        result.ok ? "success" : "error"
      );
      setMessage(
        result.ok
          ? `${provider.label || providerName} 连通通过（${result.latency_ms ?? 0} ms${syncedModelCount ? `，已同步 ${syncedModelCount} 个模型` : ""}）`
          : result.error || `${provider.label || providerName} 连通失败`,
        result.ok ? "success" : "error"
      );
    } catch (error) {
      state.llmTestResults[providerName] = { ok: false, error: error.message };
      setLlmDeckStatus(error.message, "error");
      setMessage(error.message, "error");
    } finally {
      state.llmTestingProvider = null;
      renderLlmDeck();
      renderSidebarSettings();
    }
  }

  function updateTaskConfig(mutator, options = {}) {
    if (!state.taskConfig) {
      return;
    }
    const { rerenderEditors = true } = options;
    mutator(state.taskConfig);
    state.taskConfig = normalizeTaskConfigFiles(state.taskConfig);
    syncConfigDirty();
    setConfigStatus(state.configDirty ? "存在未保存修改" : "配置已同步", state.configDirty ? "warning" : "neutral");
    renderTaskSpecReadOnly(buildTaskSpecView());
    renderConfigSummary();
    renderTaskScenarioSummary();
    renderConfigStatusActions();
    renderPromptSwitch();
    if (rerenderEditors) {
      renderTaskMetaForm();
      renderTaskRuntimeEditor();
      renderPrimitiveEditor(taskRulesEditorEl, "rules", state.taskConfig?.rules || {});
      renderPrimitiveEditor(taskExportsEditorEl, "exports", state.taskConfig?.exports || {});
      renderTaskLabelsEditor();
      renderTaskScenarioEditor();
      renderTaskPromptEditor();
    }
  }

  async function saveTaskConfig() {
    if (!state.selectedTask || !state.taskConfig) {
      setMessage("当前没有可保存的 task 配置。", "error");
      return;
    }

    state.configSaving = true;
    renderConfigStatusActions();
    setConfigStatus("正在保存配置...");
    setMessage("正在保存 task 配置...");

    try {
      const payload = await api(`/api/tasks/${state.selectedTask.name}/config-files`, {
        method: "PUT",
        body: JSON.stringify({
          task: state.taskConfig.task,
          runtime: state.taskConfig.runtime,
          rules: state.taskConfig.rules,
          exports: state.taskConfig.exports,
          labels: state.taskConfig.labels,
          scenarios: state.taskConfig.scenarios,
          generator_prompt: state.taskConfig.generator_prompt,
          teacher_prompt: state.taskConfig.teacher_prompt,
        }),
      });
      state.taskConfig = normalizeTaskConfigFiles(cloneData(payload.config));
      state.originalTaskConfig = normalizeTaskConfigFiles(cloneData(payload.config));
      state.taskSpec = payload.spec;
      state.isEditingTaskConfig = false;
      syncConfigDirty();
      await loadTasks();
      state.selectedTask = state.tasks.find((item) => item.name === state.selectedTask?.name) || state.selectedTask;
      setConfigStatus("配置保存成功", "success");
      setMessage("task 配置已保存", "success");
      renderTaskSpec();
      renderTasks();
      renderSummary();
    } catch (error) {
      setConfigStatus(error.message, "error");
      setMessage(error.message, "error");
    } finally {
      state.configSaving = false;
      renderConfigStatusActions();
    }
  }

  function enterTaskConfigEditMode() {
    if (!state.taskConfig || state.configSaving) {
      return;
    }
    state.isEditingTaskConfig = true;
    if (!state.configDirty) {
      setConfigStatus("已进入编辑模式");
    }
    renderTaskSpec();
  }

  function cancelTaskConfigEditMode() {
    if (!state.originalTaskConfig || state.configSaving) {
      return;
    }
    state.taskConfig = normalizeTaskConfigFiles(cloneData(state.originalTaskConfig));
    state.isEditingTaskConfig = false;
    syncConfigDirty();
    setConfigStatus("已取消编辑");
    renderTaskSpec();
  }

  function bindPrimitiveEditor(container, sectionName) {
    container.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.dataset.configSection !== sectionName) {
        return;
      }
      updateTaskConfig((draft) => {
        draft[sectionName][target.dataset.configKey] = coercePrimitiveInput(target.value);
      }, { rerenderEditors: false });
    });
  }

  function bindEvents() {
    addLlmProviderButton.addEventListener("click", () => {
      addCustomProvider();
    });

    llmProviderGridEl.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.dataset.llmProvider) {
        return;
      }
      updateLlmSettings((draft) => {
        const provider = draft.providers.find((item) => item.name === target.dataset.llmProvider);
        if (!provider) {
          return;
        }
        if (target.dataset.llmConfig) {
          provider.config[target.dataset.llmConfig] = target.value;
          return;
        }
        if (target.dataset.llmMeta) {
          if (target.dataset.llmMeta === "name") {
            provider[target.dataset.llmMeta] = normalizeProviderId(target.value);
            syncDerivedProviderEnvKeys(provider);
            return;
          }
          provider[target.dataset.llmMeta] = target.value;
        }
      });
    });

    llmProviderGridEl.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) || !target.dataset.llmProvider || !target.dataset.llmMeta) {
        return;
      }
      updateLlmSettings((draft) => {
        const provider = draft.providers.find((item) => item.name === target.dataset.llmProvider);
        if (!provider) {
          return;
        }
        if (target.dataset.llmMeta === "implementation") {
          syncCustomProviderFamily(draft, provider, target.value);
          return;
        }
        provider[target.dataset.llmMeta] = target.value;
      });
    });

    llmProviderGridEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const modelButton = target.closest("[data-llm-model]");
      if (modelButton instanceof HTMLElement) {
        updateLlmSettings((draft) => {
          const provider = draft.providers.find((item) => item.name === modelButton.dataset.llmProvider);
          if (!provider) {
            return;
          }
          provider.config.default_model = modelButton.dataset.llmModel || "";
        });
        return;
      }

      const actionButton = target.closest("[data-llm-action='test']");
      if (actionButton instanceof HTMLElement && actionButton.dataset.llmProvider) {
        testLlmConnection(actionButton.dataset.llmProvider);
        return;
      }

      const deleteButton = target.closest("[data-llm-action='delete']");
      if (deleteButton instanceof HTMLElement && deleteButton.dataset.llmProvider) {
        delete state.llmTestResults[deleteButton.dataset.llmProvider];
        updateLlmSettings((draft) => {
          draft.providers = draft.providers.filter((provider) => provider.name !== deleteButton.dataset.llmProvider);
        });
      }
    });

    taskMetaFormEl.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.dataset.configSection) {
        return;
      }
      updateTaskConfig((draft) => {
        draft[target.dataset.configSection][target.dataset.configKey] = target.value;
      }, { rerenderEditors: false });
    });

    taskRuntimeEditorEl.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.dataset.runtimeStage) {
        return;
      }
      updateTaskConfig((draft) => {
        draft.runtime[target.dataset.runtimeStage][target.dataset.runtimeKey] = coercePrimitiveInput(target.value);
      }, { rerenderEditors: false });
    });

    taskRuntimeEditorEl.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) || !target.dataset.runtimeStage) {
        return;
      }
      updateTaskConfig((draft) => {
        draft.runtime[target.dataset.runtimeStage][target.dataset.runtimeKey] = coercePrimitiveInput(target.value);
      }, { rerenderEditors: false });
    });

    taskRuntimeEditorEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const providerButton = target.closest("[data-runtime-provider]");
      if (providerButton instanceof HTMLElement) {
        const stage = providerButton.dataset.runtimeStage;
        const providerName = providerButton.dataset.runtimeProvider;
        if (!stage || !providerName) {
          return;
        }
        updateTaskConfig((draft) => {
          const currentConfig = draft.runtime[stage] || {};
          if (currentConfig.provider === providerName) {
            return;
          }
          draft.runtime[stage] = buildRuntimePreset(state, stage, providerName, currentConfig);
        });
        return;
      }

      const modelButton = target.closest("[data-runtime-model]");
      if (modelButton instanceof HTMLElement) {
        const stage = modelButton.dataset.runtimeStage;
        const model = modelButton.dataset.runtimeModel;
        if (!stage || !model) {
          return;
        }
        updateTaskConfig((draft) => {
          draft.runtime[stage].model = model;
        });
        return;
      }

      const actionButton = target.closest("[data-runtime-action]");
      if (!(actionButton instanceof HTMLElement)) {
        return;
      }
      const stage = actionButton.dataset.runtimeStage;
      const action = actionButton.dataset.runtimeAction;
      if (!stage || !action) {
        return;
      }
      if (action === "toggle-advanced") {
        state.runtimeAdvancedOpen[stage] = !state.runtimeAdvancedOpen[stage];
        renderTaskRuntimeEditor();
        return;
      }
      if (action === "toggle-custom-model") {
        state.runtimeManualModelOpen[stage] = !state.runtimeManualModelOpen[stage];
        renderTaskRuntimeEditor();
        return;
      }
      if (action === "apply-recommended") {
        updateTaskConfig((draft) => {
          const currentConfig = draft.runtime[stage] || {};
          const providerName = currentConfig.provider || getRuntimeProviders(state)[0]?.name || "mock";
          draft.runtime[stage] = buildRuntimePreset(state, stage, providerName, currentConfig);
        });
        return;
      }
      if (action === "apply-global") {
        updateTaskConfig((draft) => {
          const currentConfig = draft.runtime[stage] || {};
          const providerName = currentConfig.provider || getRuntimeProviders(state)[0]?.name || "mock";
          draft.runtime[stage] = buildRuntimePresetFromGlobal(state, stage, providerName, currentConfig);
        });
      }
    });

    bindPrimitiveEditor(taskRulesEditorEl, "rules");
    bindPrimitiveEditor(taskExportsEditorEl, "exports");

    taskLabelsEditorEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.matches("[data-label-index]")) {
        const index = Number(target.dataset.labelIndex);
        updateTaskConfig((draft) => {
          draft.labels.splice(index, 1);
        });
        return;
      }
      if (target.id === "addLabelButton") {
        const input = document.getElementById("newLabelInput");
        if (!(input instanceof HTMLInputElement)) {
          return;
        }
        const value = input.value.trim();
        if (!value) {
          setConfigStatus("新增 label 不能为空", "error");
          return;
        }
        updateTaskConfig((draft) => {
          if (!draft.labels.includes(value)) {
            draft.labels.push(value);
          }
        });
      }
    });

    taskScenarioEditorEl.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
        return;
      }
      const index = Number(target.dataset.scenarioIndex);
      if (!Number.isInteger(index) || !state.taskConfig?.scenarios?.[index]) {
        return;
      }
      updateTaskConfig((draft) => {
        const scenario = draft.scenarios[index];
        if (target.dataset.scenarioField) {
          const field = target.dataset.scenarioField;
          if (field === "tags") {
            scenario.tags = target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
          } else if (field === "templates") {
            scenario.templates = target.value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean);
          } else if (field === "generation_count") {
            const value = target.value.trim();
            if (!value) {
              delete scenario.generation_count;
            } else {
              scenario.generation_count = Number.parseInt(value, 10);
            }
          } else {
            scenario[field] = target.value;
          }
        }
        if (target.dataset.scenarioContext) {
          const field = target.dataset.scenarioContext;
          scenario.context ||= {};
          if (field === "has_visible_report") {
            scenario.context[field] = target.value === "true";
          } else {
            scenario.context[field] = target.value;
          }
        }
      }, { rerenderEditors: false });
    });

    taskScenarioEditorEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.matches("[data-toggle-scenario-advanced]")) {
        const index = Number(target.dataset.toggleScenarioAdvanced);
        state.scenarioAdvancedOpen[index] = !state.scenarioAdvancedOpen[index];
        renderTaskScenarioEditor();
        return;
      }
      if (!target.matches("[data-remove-scenario]")) {
        return;
      }
      const index = Number(target.dataset.removeScenario);
      updateTaskConfig((draft) => {
        draft.scenarios.splice(index, 1);
      });
    });

    taskPromptEditorEl.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.dataset.promptField) {
        return;
      }
      updateTaskConfig((draft) => {
        draft[target.dataset.promptField] = target.value;
      }, { rerenderEditors: false });
    });

    editTaskConfigButton.addEventListener("click", enterTaskConfigEditMode);
    reloadLlmSettingsButton.addEventListener("click", loadLlmSettings);
    saveLlmSettingsButton.addEventListener("click", saveLlmSettings);
    reloadTaskConfigButton.addEventListener("click", async () => {
      if (!state.selectedTask) {
        return;
      }
      await loadTaskSpec({ preserveEditing: state.isEditingTaskConfig });
      setConfigStatus("配置已从磁盘重载", "success");
    });
    resetTaskConfigButton.addEventListener("click", cancelTaskConfigEditMode);
    saveTaskConfigButton.addEventListener("click", saveTaskConfig);
    addScenarioButton.addEventListener("click", () => {
      updateTaskConfig((draft) => {
        draft.scenarios.push(createEmptyScenario());
      });
    });
    promptViewSwitchEl.querySelectorAll("[data-prompt-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.promptView = button.dataset.promptView;
        renderTaskSpec();
      });
    });
  }

  return {
    bindEvents,
    loadLlmSettings,
    loadTaskSpec,
    renderConfigStatusActions,
    renderPromptSwitch,
    renderTaskSpec,
    saveTaskConfig,
    updateTaskConfig,
    enterTaskConfigEditMode,
    cancelTaskConfigEditMode,
  };
}
