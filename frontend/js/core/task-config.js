function createScenarioContext(context = {}) {
  return {
    has_visible_report: false,
    previous_report_summary: "",
    dialogue_stage: "standalone",
    language: "zh",
    ...context,
  };
}

function normalizeScenario(scenario = {}) {
  return {
    intent: scenario.intent || "rewrite_report",
    difficulty: scenario.difficulty || "medium",
    tags: Array.isArray(scenario.tags) ? scenario.tags : [],
    templates: Array.isArray(scenario.templates) ? scenario.templates : [],
    ...scenario,
    context: createScenarioContext(scenario.context),
  };
}

export function normalizeTaskConfigFiles(config) {
  if (!config || typeof config !== "object") {
    return config;
  }

  return {
    ...config,
    task: config.task || {},
    runtime: config.runtime || {},
    rules: config.rules || {},
    exports: config.exports || {},
    labels: Array.isArray(config.labels) ? config.labels : [],
    scenarios: Array.isArray(config.scenarios) ? config.scenarios.map((scenario) => normalizeScenario(scenario)) : [],
    generator_prompt: config.generator_prompt || "",
    teacher_prompt: config.teacher_prompt || "",
  };
}

export function hasTaskConfigChanges(taskConfig, originalTaskConfig) {
  return !!taskConfig && !!originalTaskConfig && JSON.stringify(taskConfig) !== JSON.stringify(originalTaskConfig);
}

export function createEmptyScenario() {
  return {
    intent: "rewrite_report",
    difficulty: "medium",
    tags: [],
    context: createScenarioContext(),
    templates: [""],
  };
}

export function createDefaultTaskConfig(taskName) {
  const normalizedName = String(taskName || "").trim();
  const labels = ["primary_intent", "followup_request", "needs_clarification"];
  return {
    task: {
      name: normalizedName,
      theme: `${normalizedName}_theme`,
      language: "zh",
      task_type: "classification",
      entry_schema: "conversation_action",
    },
    runtime: {
      generator: {
        provider: "mock",
        model: "mock-generator-v1",
        temperature: 0,
        max_tokens: 1024,
        max_retries: 1,
        retry_backoff_seconds: 1,
      },
      teacher: {
        provider: "mock",
        model: "mock-teacher-v1",
        temperature: 0,
        max_tokens: 1024,
        max_retries: 1,
        retry_backoff_seconds: 1,
      },
      eval: {
        provider: "mock",
        model: "mock-eval-v1",
        temperature: 0,
        max_tokens: 1024,
        max_retries: 1,
        retry_backoff_seconds: 1,
      },
    },
    rules: {
      disallow_rewrite_without_visible_report: false,
    },
    exports: {
      train_format: "chatml_jsonl",
      eval_format: "promptfoo_jsonl",
      student_format: "chatml_jsonl",
    },
    labels,
    scenarios: [
      {
        intent: "primary_intent",
        difficulty: "medium",
        tags: ["custom", "bootstrap"],
        context: createScenarioContext({
          has_visible_report: true,
          previous_report_summary: "The user is asking about a newly defined task.",
        }),
        templates: [
          "请围绕当前主题生成一条高质量中文样本。",
          "构造一条包含明确目标与约束的任务请求。",
        ],
        generation_count: 2,
      },
    ],
    generator_prompt: [
      "你是一个蒸馏数据生成器。",
      "",
      `任务名: ${normalizedName}`,
      `主题: ${normalizedName}_theme`,
      `标签候选: ${labels.join(", ")}`,
      "",
      '请根据给定 scenario 生成高质量用户输入样本，输出 JSON：',
      '{"items":[{"user_text":"...", "label_hint":"...", "meta":{}}]}',
      "",
    ].join("\n"),
    teacher_prompt: [
      "你是一个严格的标注教师。",
      "",
      `任务名: ${normalizedName}`,
      `主题: ${normalizedName}_theme`,
      `可用标签: ${labels.join(", ")}`,
      "",
      '请阅读输入并输出 JSON：',
      '{"label":"...", "reason":"...", "confidence":0.0}',
      "",
    ].join("\n"),
  };
}
