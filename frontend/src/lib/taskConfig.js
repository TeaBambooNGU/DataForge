import { EMPTY_RUNTIME_MODELS } from "../constants/app.js";
import { deepClone } from "./utils.js";

export function normalizeProviderId(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^[^a-z0-9]+/, "")
      .replace(/_+/g, "_") || "custom_provider"
  );
}

export function buildCustomEnvKey(providerName, suffix) {
  return (
    String(providerName || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") + `_${suffix}`
  );
}

export function summarizeTask(task) {
  if (!task) {
    return "选择 task 进入运行空间";
  }
  return `${task.run_count || 0} runs / ${task.labels?.length || 0} labels`;
}

export function buildTaskConfigDraft(payload) {
  return {
    task: deepClone(payload.task),
    runtimeText: JSON.stringify(payload.runtime || {}, null, 2),
    rulesText: JSON.stringify(payload.rules || {}, null, 2),
    exportsText: JSON.stringify(payload.exports || {}, null, 2),
    labelsText: (payload.labels || []).join("\n"),
    scenariosText: JSON.stringify(payload.scenarios || [], null, 2),
    generatorPrompt: payload.generator_prompt || "",
    teacherPrompt: payload.teacher_prompt || "",
  };
}

export function buildTaskConfigPayloadFromDraft(draft) {
  return {
    task: deepClone(draft.task),
    runtime: JSON.parse(draft.runtimeText || "{}"),
    rules: JSON.parse(draft.rulesText || "{}"),
    exports: JSON.parse(draft.exportsText || "{}"),
    labels: (draft.labelsText || "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    scenarios: JSON.parse(draft.scenariosText || "[]"),
    generator_prompt: draft.generatorPrompt,
    teacher_prompt: draft.teacherPrompt,
  };
}

export function safeParseJson(text, fallback) {
  try {
    return JSON.parse(text || "");
  } catch {
    return fallback;
  }
}

export function estimateScenarioSamples(scenario) {
  const count = Number(scenario?.generation_count || 0);
  if (Number.isInteger(count) && count > 0) {
    return count;
  }
  return Array.isArray(scenario?.templates)
    ? scenario.templates.filter((item) => String(item || "").trim()).length
    : 0;
}

export function totalEstimatedSamples(scenarios = []) {
  return scenarios.reduce((sum, scenario) => sum + estimateScenarioSamples(scenario), 0);
}

export function formatDialogueStageLabel(value) {
  if (value === "followup") {
    return "追问";
  }
  if (value === "standalone") {
    return "独立提问";
  }
  return value || "-";
}

export function getRuntimeProviders(runtimeCatalog) {
  return Array.isArray(runtimeCatalog?.providers) ? runtimeCatalog.providers : [];
}

export function getRuntimeFieldCatalog(runtimeCatalog) {
  return Array.isArray(runtimeCatalog?.fields) ? runtimeCatalog.fields : [];
}

export function getRuntimeProviderMeta(runtimeCatalog, providerName) {
  return getRuntimeProviders(runtimeCatalog).find((provider) => provider.name === providerName) || null;
}

export function getProviderModelOptions(runtimeCatalog, providerName, stage) {
  return getRuntimeProviderMeta(runtimeCatalog, providerName)?.models?.[stage] || [];
}

export function getRecommendedModelValue(runtimeCatalog, providerName, stage) {
  const options = getProviderModelOptions(runtimeCatalog, providerName, stage);
  return options.find((item) => item.recommended)?.value || options[0]?.value || "";
}

export function getGlobalProviderSettings(settings, providerName) {
  return (settings?.providers || []).find((provider) => provider.name === providerName) || null;
}

export function getKnownRuntimeKeys(runtimeCatalog, providerName) {
  const fieldKeys = getRuntimeFieldCatalog(runtimeCatalog).map((field) => field.key);
  const providerFieldKeys = getRuntimeProviderMeta(runtimeCatalog, providerName)?.provider_fields || [];
  return new Set(["provider", "model", ...fieldKeys, ...providerFieldKeys]);
}

export function getRuntimeCustomEntries(runtimeCatalog, providerName, config = {}) {
  const knownKeys = getKnownRuntimeKeys(runtimeCatalog, providerName);
  return Object.entries(config || {}).filter(([key]) => !knownKeys.has(key));
}

export function runtimeCustomEntryStateKey(stage, key) {
  return `${stage}:${key}`;
}

export function inferRuntimeCustomEntryType(value) {
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return "number";
  }
  if (value && typeof value === "object") {
    return "json";
  }
  return "text";
}

function autoDetectPrimitiveInput(rawValue) {
  const text = String(rawValue ?? "");
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return Number(trimmed);
  }
  return text;
}

export function coerceRuntimeCustomEntryInput(rawValue, mode = "auto") {
  if (mode === "boolean") {
    return rawValue === "" ? "" : rawValue === true || rawValue === "true";
  }
  if (mode === "number") {
    if (rawValue === "") {
      return "";
    }
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : "";
  }
  if (mode === "text") {
    return String(rawValue ?? "");
  }
  return autoDetectPrimitiveInput(rawValue);
}

export function getRuntimeCustomEntryInputValue(value, mode = "auto") {
  if (mode === "boolean") {
    return value === true ? "true" : value === false ? "false" : "";
  }
  if (mode === "json") {
    return JSON.stringify(value ?? {}, null, 2);
  }
  return value == null ? "" : String(value);
}

export function buildRuntimePreset(runtimeCatalog, stage, providerName, currentConfig = {}, options = {}) {
  const provider = getRuntimeProviderMeta(runtimeCatalog, providerName);
  if (!provider) {
    return { ...currentConfig, provider: providerName };
  }
  const { keepCurrentModel = false } = options;
  const knownKeys = getKnownRuntimeKeys(runtimeCatalog, providerName);
  const customEntries = Object.fromEntries(
    Object.entries(currentConfig || {}).filter(([key]) => !knownKeys.has(key))
  );
  const nextConfig = {
    ...customEntries,
    ...(provider.defaults || {}),
    provider: providerName,
  };
  const currentModel = currentConfig.model;
  const validModels = getProviderModelOptions(runtimeCatalog, providerName, stage);
  const hasCurrentModel = validModels.some((item) => item.value === currentModel);
  nextConfig.model =
    keepCurrentModel && hasCurrentModel
      ? currentModel
      : getRecommendedModelValue(runtimeCatalog, providerName, stage);
  return nextConfig;
}

export function buildRuntimePresetFromGlobal(
  runtimeCatalog,
  settings,
  stage,
  providerName,
  currentConfig = {}
) {
  const nextConfig = buildRuntimePreset(runtimeCatalog, stage, providerName, currentConfig);
  const globalProvider = getGlobalProviderSettings(settings, providerName);
  if (!globalProvider) {
    return nextConfig;
  }
  const defaultModel = String(globalProvider.config?.default_model || "").trim();
  if (defaultModel) {
    nextConfig.model = defaultModel;
  }
  if (globalProvider.env_keys?.base_url_env) {
    nextConfig.base_url_env = globalProvider.env_keys.base_url_env;
  }
  if (globalProvider.env_keys?.api_key_env) {
    nextConfig.api_key_env = globalProvider.env_keys.api_key_env;
  }
  return nextConfig;
}

export function isProviderConfigured(provider) {
  if (!provider) {
    return false;
  }
  return provider.name === "mock" || Boolean(provider.config?.has_api_key) || Boolean(provider.config?.api_key);
}

export function getProviderReadyLabel(provider, probe) {
  if (probe?.ok) {
    return "probe ok";
  }
  if (isProviderConfigured(provider)) {
    return "configured";
  }
  return "missing key";
}

export function syncCustomProviderFamily(provider, providers, nextImplementation) {
  const previousFamily = (providers || []).find(
    (item) => item.kind === "builtin" && item.name === provider.implementation
  );
  const family = (providers || []).find(
    (item) => item.kind === "builtin" && item.name === nextImplementation
  );
  provider.implementation = nextImplementation;
  if (!family) {
    return provider;
  }
  const previousDefaultModel = provider.config?.default_model || "";
  const previousRecommended =
    previousFamily?.models?.generator?.find((item) => item.recommended)?.value ||
    previousFamily?.models?.generator?.[0]?.value ||
    "";
  const nextRecommended =
    family.models?.generator?.find((item) => item.recommended)?.value ||
    family.models?.generator?.[0]?.value ||
    "";
  provider.models = deepClone(family.models || EMPTY_RUNTIME_MODELS);
  if (!provider.badge || provider.badge === "custom" || provider.badge === previousFamily?.badge) {
    provider.badge = family.badge || provider.badge;
  }
  if (!provider.description || provider.description === previousFamily?.description) {
    provider.description = family.description || provider.description;
  }
  if (!previousDefaultModel || previousDefaultModel === previousRecommended) {
    provider.config.default_model = nextRecommended || provider.config.default_model;
  }
  return provider;
}

export function getNextRecommendedCommand(selectedRun) {
  if (!selectedRun?.run_id) {
    return "generate";
  }
  const completed = new Set(Object.keys(selectedRun.stages || {}));
  const sequence = [
    "classify",
    "filter-export",
    "review-export",
    "validate-review",
    "build-gold",
    "eval",
    "student-export",
  ];
  return sequence.find((command) => !completed.has(command.replaceAll("-", "_"))) || null;
}

export function emptyCustomProvider(index) {
  const name = `custom_provider_${index}`;
  return {
    name,
    label: name,
    description: "",
    badge: "custom",
    implementation: "openai_compatible",
    kind: "custom",
    editable: true,
    models: deepClone(EMPTY_RUNTIME_MODELS),
    env_keys: {
      base_url_env: buildCustomEnvKey(name, "BASE_URL"),
      api_key_env: buildCustomEnvKey(name, "API_KEY"),
      model_env: "",
    },
    config: {
      base_url: "",
      api_key: "",
      default_model: "",
      has_api_key: false,
      api_key_masked: "",
    },
  };
}

export function normalizeSettingsPayload(payload) {
  return {
    providers: (payload?.providers || []).map((provider) => ({
      ...provider,
      models: provider.models || deepClone(EMPTY_RUNTIME_MODELS),
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
    })),
  };
}
