import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { DEFAULT_CREATE_TASK, STAGE_ACTIONS, WORKSPACE_TABS } from "./constants/app.js";
import { api } from "./lib/api.js";
import {
  buildArtifactSummary,
  createDefaultArtifactKey,
  getArtifactCategoryInfo,
  getArtifactFilterOptions,
  getArtifactSearchText,
  getRecommendedArtifactKeys,
  groupArtifactsByCategory,
  recordPassesArtifactFilter,
  visibleArtifacts,
} from "./lib/artifacts.js";
import { buildReviewSummary, reviewRecordMatchesFilter } from "./lib/review.js";
import {
  buildCustomEnvKey,
  buildRuntimePreset,
  buildRuntimePresetFromGlobal,
  buildTaskConfigDraft,
  buildTaskConfigPayloadFromDraft,
  coerceRuntimeCustomEntryInput,
  emptyCustomProvider,
  getNextRecommendedCommand,
  getRuntimeCustomEntryInputValue,
  inferRuntimeCustomEntryType,
  normalizeProviderId,
  normalizeSettingsPayload,
  runtimeCustomEntryStateKey,
  safeParseJson,
  totalEstimatedSamples,
  summarizeTask,
} from "./lib/taskConfig.js";
import { classNames, deepClone, formatDate } from "./lib/utils.js";
import ArtifactWorkspace from "./modules/artifacts/ArtifactWorkspace.jsx";
import CreateTaskModal from "./modules/common/CreateTaskModal.jsx";
import TaskConfigWorkspace from "./modules/config/TaskConfigWorkspace.jsx";
import HomeScreen from "./modules/home/HomeScreen.jsx";
import ReviewWorkspace from "./modules/review/ReviewWorkspace.jsx";
import SettingsDrawer from "./modules/settings/SettingsDrawer.jsx";
import OverviewWorkspace from "./modules/workspace/OverviewWorkspace.jsx";

const STRUCTURED_ARTIFACT_PAGE_SIZE = 24;
const RAW_ARTIFACT_LINE_PAGE_SIZE = 120;

function getTaskConfigCardLabel(cardKey) {
  if (cardKey === "task") {
    return "Task Dossier";
  }
  if (cardKey === "rules-exports") {
    return "Rules & Exports";
  }
  if (cardKey === "prompt-view") {
    return "Prompt View";
  }
  if (cardKey === "scenarios") {
    return "Scenario Cards";
  }
  if (cardKey.startsWith("runtime-")) {
    return cardKey.replace("runtime-", "");
  }
  return "当前卡片";
}

function App() {
  const [tasks, setTasks] = useState([]);
  const [screen, setScreen] = useState("home");
  const [activeTask, setActiveTask] = useState(null);
  const [taskSpec, setTaskSpec] = useState(null);
  const [taskConfig, setTaskConfig] = useState(null);
  const [taskConfigDraft, setTaskConfigDraft] = useState(null);
  const [taskConfigBaseline, setTaskConfigBaseline] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  const [settings, setSettings] = useState({ providers: [] });
  const [settingsDraft, setSettingsDraft] = useState({ providers: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState("list");
  const [customProviderDraft, setCustomProviderDraft] = useState(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskDraft, setCreateTaskDraft] = useState(DEFAULT_CREATE_TASK);
  const [artifactKey, setArtifactKey] = useState(null);
  const [artifactPayload, setArtifactPayload] = useState(null);
  const [artifactSearch, setArtifactSearch] = useState("");
  const [artifactFilter, setArtifactFilter] = useState("all");
  const [artifactViewMode, setArtifactViewMode] = useState("structured");
  const [artifactPage, setArtifactPage] = useState(1);
  const [rawCandidateViewMode, setRawCandidateViewMode] = useState("table");
  const [rawCandidateGroupBy, setRawCandidateGroupBy] = useState("label_hint");
  const [reviewPayload, setReviewPayload] = useState({
    records: [],
    labels: [],
    summary: null,
    reviewer: "",
  });
  const [reviewFilter, setReviewFilter] = useState("all");
  const [message, setMessage] = useState("正在连接 DataForge");
  const [messageTone, setMessageTone] = useState("neutral");
  const [booting, setBooting] = useState(true);
  const [busyCommand, setBusyCommand] = useState("");
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [savingTaskConfigCard, setSavingTaskConfigCard] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingProvider, setTestingProvider] = useState("");
  const [llmTests, setLlmTests] = useState({});
  const [promptFocus, setPromptFocus] = useState("generator");
  const [isEditingTaskConfig, setIsEditingTaskConfig] = useState(false);
  const [editingTaskConfigCard, setEditingTaskConfigCard] = useState("");
  const [runtimeCustomModes, setRuntimeCustomModes] = useState({});
  const [expandedRuntimeStages, setExpandedRuntimeStages] = useState({
    generator: false,
    teacher: false,
    eval: false,
  });
  const [artifactNavSearch, setArtifactNavSearch] = useState("");
  const [artifactNavCategoryFilter, setArtifactNavCategoryFilter] = useState("all");
  const deferredArtifactSearch = useDeferredValue(artifactSearch);

  const taskConfigDirty = useMemo(
    () => JSON.stringify(taskConfigDraft) !== JSON.stringify(taskConfigBaseline),
    [taskConfigDraft, taskConfigBaseline]
  );

  const selectedRunCompletedStages = useMemo(
    () => new Set(Object.keys(selectedRun?.stages || {})),
    [selectedRun]
  );

  const artifactFilterOptions = useMemo(
    () => getArtifactFilterOptions(artifactPayload),
    [artifactPayload]
  );

  const filteredArtifactRows = useMemo(() => {
    const rows = Array.isArray(artifactPayload?.content) ? artifactPayload.content : [];
    const keyword = deferredArtifactSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (!recordPassesArtifactFilter(row, artifactPayload, artifactFilter)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return getArtifactSearchText(row).includes(keyword);
    });
  }, [artifactPayload, artifactFilter, deferredArtifactSearch]);

  const artifactSummary = useMemo(
    () => buildArtifactSummary(artifactPayload, filteredArtifactRows),
    [artifactPayload, filteredArtifactRows]
  );
  const rawArtifactText = useMemo(() => {
    if (!artifactPayload || artifactViewMode !== "raw") {
      return "";
    }
    if (typeof artifactPayload.content === "string") {
      return artifactPayload.content || "暂无内容";
    }
    return JSON.stringify(artifactPayload.content, null, 2) || "暂无内容";
  }, [artifactPayload, artifactViewMode]);
  const artifactPagination = useMemo(() => {
    if (!artifactPayload) {
      return {
        page: 1,
        pageCount: 1,
        totalItems: 0,
        startItem: 0,
        endItem: 0,
        pageSize: 0,
        unitLabel: "项",
      };
    }

    let totalItems = 0;
    let pageSize = 0;
    let unitLabel = "项";

    if (artifactViewMode === "structured" && artifactPayload.kind === "jsonl") {
      totalItems = filteredArtifactRows.length;
      pageSize = STRUCTURED_ARTIFACT_PAGE_SIZE;
      unitLabel = "条记录";
    } else if (artifactViewMode === "raw") {
      totalItems = rawArtifactText.split("\n").length;
      pageSize = RAW_ARTIFACT_LINE_PAGE_SIZE;
      unitLabel = "行";
    }

    if (!pageSize || totalItems <= 0) {
      return {
        page: 1,
        pageCount: 1,
        totalItems,
        startItem: totalItems ? 1 : 0,
        endItem: totalItems,
        pageSize,
        unitLabel,
      };
    }

    const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(artifactPage, pageCount);
    const startItem = (page - 1) * pageSize + 1;
    const endItem = Math.min(totalItems, startItem + pageSize - 1);

    return {
      page,
      pageCount,
      totalItems,
      startItem,
      endItem,
      pageSize,
      unitLabel,
    };
  }, [artifactPage, artifactPayload, artifactViewMode, filteredArtifactRows, rawArtifactText]);
  const visibleArtifactRows = useMemo(() => {
    if (artifactViewMode !== "structured" || artifactPayload?.kind !== "jsonl") {
      return filteredArtifactRows;
    }
    const startIndex = (artifactPagination.page - 1) * artifactPagination.pageSize;
    return filteredArtifactRows.slice(startIndex, startIndex + artifactPagination.pageSize);
  }, [
    artifactPagination.page,
    artifactPagination.pageSize,
    artifactPayload?.kind,
    artifactViewMode,
    filteredArtifactRows,
  ]);
  const paginatedRawArtifactContent = useMemo(() => {
    if (artifactViewMode !== "raw") {
      return rawArtifactText;
    }
    if (artifactPagination.pageCount <= 1) {
      return rawArtifactText;
    }
    const lines = rawArtifactText.split("\n");
    const startIndex = (artifactPagination.page - 1) * artifactPagination.pageSize;
    return lines.slice(startIndex, startIndex + artifactPagination.pageSize).join("\n");
  }, [
    artifactPagination.page,
    artifactPagination.pageCount,
    artifactPagination.pageSize,
    artifactViewMode,
    rawArtifactText,
  ]);

  const visibleRunArtifacts = useMemo(() => visibleArtifacts(selectedRun), [selectedRun]);
  const artifactNavCategoryOptions = useMemo(() => {
    const categories = Array.from(new Set(visibleRunArtifacts.map((artifact) => artifact.category))).filter(Boolean);
    return [
      { value: "all", label: "全部分类" },
      ...categories.map((category) => ({
        value: category,
        label: getArtifactCategoryInfo(category).label,
      })),
    ];
  }, [visibleRunArtifacts]);
  const filteredRunArtifacts = useMemo(() => {
    const keyword = artifactNavSearch.trim().toLowerCase();
    return visibleRunArtifacts.filter((artifact) => {
      if (artifactNavCategoryFilter !== "all" && artifact.category !== artifactNavCategoryFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [artifact.key, artifact.relative_path, artifact.kind, artifact.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [artifactNavCategoryFilter, artifactNavSearch, visibleRunArtifacts]);
  const groupedRunArtifacts = useMemo(
    () => groupArtifactsByCategory(filteredRunArtifacts),
    [filteredRunArtifacts]
  );
  const artifactDownloadUrl = useMemo(() => {
    if (!activeTask?.name || !selectedRun?.run_id || artifactKey !== "student_train") {
      return null;
    }
    return `/api/tasks/${activeTask.name}/runs/${selectedRun.run_id}/artifacts/${artifactKey}/download`;
  }, [activeTask?.name, artifactKey, selectedRun?.run_id]);

  const recommendedArtifactKeys = useMemo(
    () => new Set(getRecommendedArtifactKeys(selectedRun)),
    [selectedRun]
  );

  const reviewSummary = useMemo(
    () => buildReviewSummary(reviewPayload.summary, reviewPayload.records),
    [reviewPayload.records, reviewPayload.summary]
  );

  const filteredReviewRecords = useMemo(
    () => reviewPayload.records.filter((record) => reviewRecordMatchesFilter(record, reviewFilter)),
    [reviewFilter, reviewPayload.records]
  );

  const runtimeCatalog = useMemo(() => taskConfig?.runtime_catalog || null, [taskConfig]);
  const runtimeDraft = useMemo(
    () => safeParseJson(taskConfigDraft?.runtimeText || "{}", {}),
    [taskConfigDraft?.runtimeText]
  );
  const rulesDraft = useMemo(
    () => safeParseJson(taskConfigDraft?.rulesText || "{}", {}),
    [taskConfigDraft?.rulesText]
  );
  const exportsDraft = useMemo(
    () => safeParseJson(taskConfigDraft?.exportsText || "{}", {}),
    [taskConfigDraft?.exportsText]
  );
  const scenariosDraft = useMemo(
    () => safeParseJson(taskConfigDraft?.scenariosText || "[]", []),
    [taskConfigDraft?.scenariosText]
  );
  const labelDraftList = useMemo(
    () =>
      (taskConfigDraft?.labelsText || "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [taskConfigDraft?.labelsText]
  );

  const configSummaryCards = useMemo(() => {
    const configuredStages = Object.entries(runtimeDraft || {}).filter(([, config]) => config?.provider).length;
    const scenarioCount = scenariosDraft.length;
    const estimatedSamples = totalEstimatedSamples(scenariosDraft);
    return [
      { label: "runtime stages", value: configuredStages },
      { label: "labels", value: labelDraftList.length },
      { label: "scenarios", value: scenarioCount },
      { label: "estimated samples", value: estimatedSamples },
    ];
  }, [labelDraftList.length, runtimeDraft, scenariosDraft]);

  const configAdvice = useMemo(() => {
    const advice = [];
    if (!labelDraftList.length) {
      advice.push("当前 labels 为空，teacher 和 review 都无法形成稳定标签闭环。");
    }
    if (!scenariosDraft.length) {
      advice.push("当前没有 scenario，generate 不会产出有效候选样本。");
    }
    if (rulesDraft.disallow_rewrite_without_visible_report) {
      advice.push("已启用 rewrite_without_visible_report 规则，重点关注 rejected_samples 的误伤情况。");
    }
    if ((exportsDraft.student_format || "").includes("chatml")) {
      advice.push("student 导出仍是 chatml_jsonl，适合直接接训练器。");
    }
    return advice;
  }, [
    exportsDraft.student_format,
    labelDraftList.length,
    rulesDraft.disallow_rewrite_without_visible_report,
    scenariosDraft.length,
  ]);

  const providerStatusSummary = useMemo(() => {
    const providers = settingsDraft.providers || [];
    const configured = providers.filter(
      (provider) => provider.name === "mock" || provider.config?.has_api_key || provider.config?.api_key
    ).length;
    const ready = providers.filter((provider) => {
      const probe = llmTests[provider.name];
      return probe?.ok || provider.name === "mock" || provider.config?.has_api_key || provider.config?.api_key;
    }).length;
    const probed = providers.filter((provider) => llmTests[provider.name]).length;
    return { total: providers.length, configured, ready, probed };
  }, [llmTests, settingsDraft.providers]);

  function setFlashMessage(text, tone = "neutral") {
    setMessage(text);
    setMessageTone(tone);
  }

  const openArtifact = useCallback((key) => {
    if (!key) {
      return;
    }
    setWorkspaceTab("artifacts");
    setArtifactKey(key);
  }, []);

  const loadBoot = useCallback(async () => {
    setBooting(true);
    try {
      const [taskPayload, settingsPayload] = await Promise.all([api("/api/tasks"), api("/api/settings/llm")]);
      const nextTasks = taskPayload.items || [];
      const normalizedSettings = normalizeSettingsPayload(settingsPayload);
      setTasks(nextTasks);
      setSettings(normalizedSettings);
      setSettingsDraft(deepClone(normalizedSettings));
      if (activeTask) {
        const stillExists = nextTasks.find((item) => item.name === activeTask.name);
        if (!stillExists) {
          setActiveTask(null);
          setScreen("home");
          setRuns([]);
          setSelectedRun(null);
        }
      }
      setFlashMessage("Task 和 provider 状态已同步", "success");
    } catch (error) {
      setFlashMessage(error.message, "error");
    } finally {
      setBooting(false);
    }
  }, [activeTask]);

  const loadRun = useCallback(async (taskName, runId) => {
    if (!taskName || !runId) {
      setSelectedRun(null);
      setArtifactKey(null);
      setArtifactPayload(null);
      setArtifactSearch("");
      setArtifactFilter("all");
      setArtifactPage(1);
      setArtifactNavSearch("");
      setArtifactNavCategoryFilter("all");
      return;
    }
    const payload = await api(`/api/tasks/${taskName}/runs/${runId}`);
    setSelectedRun(payload);
    setArtifactPayload(null);
    setArtifactSearch("");
    setArtifactFilter("all");
    setArtifactPage(1);
    setArtifactNavSearch("");
    setArtifactNavCategoryFilter("all");
    setArtifactKey((current) => {
      if (current && visibleArtifacts(payload).some((item) => item.key === current && item.exists)) {
        return current;
      }
      return createDefaultArtifactKey(payload);
    });
  }, []);

  const openTask = useCallback(
    async (taskName, preferredRunId = null) => {
      setFlashMessage(`正在进入 ${taskName}`, "neutral");
      const [taskPayload, specPayload, configPayload, runsPayload] = await Promise.all([
        api(`/api/tasks/${taskName}`),
        api(`/api/tasks/${taskName}/spec`),
        api(`/api/tasks/${taskName}/config-files`),
        api(`/api/tasks/${taskName}/runs`),
      ]);
      const nextRuns = runsPayload.items || [];
      const nextDraft = buildTaskConfigDraft(configPayload);
      setActiveTask(taskPayload);
      setTaskSpec(specPayload);
      setTaskConfig(configPayload);
      setTaskConfigDraft(nextDraft);
      setTaskConfigBaseline(nextDraft);
      setIsEditingTaskConfig(false);
      setRuntimeCustomModes({});
      setRuns(nextRuns);
      setReviewPayload({ records: [], labels: [], summary: null, reviewer: "" });
      setReviewFilter("all");
      setWorkspaceTab("overview");
      setScreen("workspace");
      const runId =
        preferredRunId ||
        (selectedRun && nextRuns.some((item) => item.run_id === selectedRun.run_id)
          ? selectedRun.run_id
          : null) ||
        nextRuns[0]?.run_id ||
        null;
      await loadRun(taskName, runId);
      setFlashMessage(`${taskName} 已进入运行空间`, "success");
    },
    [loadRun, selectedRun]
  );

  useEffect(() => {
    loadBoot();
  }, [loadBoot]);

  useEffect(() => {
    if (!artifactFilterOptions.some((item) => item.value === artifactFilter)) {
      setArtifactFilter("all");
    }
  }, [artifactFilter, artifactFilterOptions]);

  useEffect(() => {
    setArtifactPage(1);
  }, [
    artifactKey,
    artifactSearch,
    artifactFilter,
    artifactViewMode,
    rawCandidateViewMode,
    rawCandidateGroupBy,
    artifactPayload?.relative_path,
  ]);

  useEffect(() => {
    if (artifactPage !== artifactPagination.page) {
      setArtifactPage(artifactPagination.page);
    }
  }, [artifactPage, artifactPagination.page]);

  useEffect(() => {
    if (!artifactNavCategoryOptions.some((item) => item.value === artifactNavCategoryFilter)) {
      setArtifactNavCategoryFilter("all");
    }
  }, [artifactNavCategoryFilter, artifactNavCategoryOptions]);

  useEffect(() => {
    if (workspaceTab !== "artifacts" || !activeTask?.name || !selectedRun?.run_id || !artifactKey) {
      return;
    }
    let cancelled = false;
    setArtifactLoading(true);
    api(`/api/tasks/${activeTask.name}/runs/${selectedRun.run_id}/artifacts/${artifactKey}`)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setArtifactPayload(payload);
        });
        setArtifactSearch("");
        setArtifactFilter("all");
        setArtifactPage(1);
      })
      .catch((error) => {
        if (!cancelled) {
          setFlashMessage(error.message, "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setArtifactLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifactKey, activeTask, selectedRun, workspaceTab]);

  useEffect(() => {
    if (workspaceTab !== "review" || !activeTask?.name || !selectedRun?.run_id) {
      return;
    }
    let cancelled = false;
    setReviewLoading(true);
    api(`/api/tasks/${activeTask.name}/runs/${selectedRun.run_id}/review-records`)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setReviewPayload({
          records: payload.records || [],
          labels: payload.labels || [],
          summary: payload.summary || null,
          reviewer: "",
        });
        setReviewFilter("all");
      })
      .catch((error) => {
        if (!cancelled) {
          setFlashMessage(error.message, "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTask, selectedRun, workspaceTab]);

  async function refreshCurrentTask(preferredRunId = null) {
    if (!activeTask?.name) {
      await loadBoot();
      return;
    }
    await openTask(activeTask.name, preferredRunId);
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    if (!createTaskDraft.name.trim()) {
      setFlashMessage("Task 名称不能为空", "error");
      return;
    }
    try {
      const payload = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ task: createTaskDraft }),
      });
      setCreateTaskOpen(false);
      setCreateTaskDraft(DEFAULT_CREATE_TASK);
      await loadBoot();
      await openTask(payload.task.name);
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  }

  async function handleDeleteTask(taskName) {
    if (!window.confirm(`删除 task ${taskName} 及其全部 runs？`)) {
      return;
    }
    try {
      await api(`/api/tasks/${taskName}`, { method: "DELETE" });
      if (activeTask?.name === taskName) {
        setActiveTask(null);
        setTaskSpec(null);
        setTaskConfig(null);
        setTaskConfigDraft(null);
        setTaskConfigBaseline(null);
        setRuns([]);
        setSelectedRun(null);
        setArtifactPayload(null);
        setScreen("home");
      }
      await loadBoot();
      setFlashMessage(`${taskName} 已删除`, "success");
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  }

  async function handleDeleteRun(runId) {
    if (!activeTask?.name || !window.confirm(`删除 run ${runId}？`)) {
      return;
    }
    try {
      const payload = await api(`/api/tasks/${activeTask.name}/runs/${runId}`, { method: "DELETE" });
      const nextRuns = payload.items || [];
      setRuns(nextRuns);
      const nextRunId = payload.latest_run_id || nextRuns[0]?.run_id || null;
      await loadRun(activeTask.name, nextRunId);
      setFlashMessage(`${runId} 已删除`, "success");
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  }

  async function handleRunCommand(command) {
    if (!activeTask?.name) {
      return;
    }
    if (
      ["classify", "filter-export", "review-export", "validate-review", "build-gold", "eval", "student-export"].includes(command) &&
      !selectedRun?.run_id
    ) {
      setFlashMessage("先创建或选择一个 run", "warning");
      return;
    }
    setBusyCommand(command);
    try {
      const payload = await api(`/api/tasks/${activeTask.name}/commands/${command}`, {
        method: "POST",
        body: JSON.stringify({ run_id: selectedRun?.run_id || null }),
      });
      await refreshCurrentTask(payload.run_id);
      setFlashMessage(`${command} 已完成`, "success");
    } catch (error) {
      setFlashMessage(error.message, "error");
    } finally {
      setBusyCommand("");
    }
  }

  function revertTaskConfigCard(cardKey) {
    if (!taskConfigBaseline) {
      return;
    }
    setTaskConfigDraft((current) => {
      if (!current) {
        return current;
      }
      if (cardKey === "task") {
        return { ...current, task: deepClone(taskConfigBaseline.task) };
      }
      if (cardKey === "rules-exports") {
        return {
          ...current,
          rulesText: taskConfigBaseline.rulesText,
          exportsText: taskConfigBaseline.exportsText,
          labelsText: taskConfigBaseline.labelsText,
        };
      }
      if (cardKey === "prompt-view") {
        return {
          ...current,
          generatorPrompt: taskConfigBaseline.generatorPrompt,
          teacherPrompt: taskConfigBaseline.teacherPrompt,
        };
      }
      if (cardKey === "scenarios") {
        return {
          ...current,
          scenariosText: taskConfigBaseline.scenariosText,
        };
      }
      if (cardKey.startsWith("runtime-")) {
        const stage = cardKey.replace("runtime-", "");
        const currentRuntime = safeParseJson(current.runtimeText || "{}", {});
        const baselineRuntime = safeParseJson(taskConfigBaseline.runtimeText || "{}", {});
        return {
          ...current,
          runtimeText: JSON.stringify(
            {
              ...currentRuntime,
              [stage]: deepClone(baselineRuntime?.[stage] || {}),
            },
            null,
            2
          ),
        };
      }
      return deepClone(taskConfigBaseline);
    });
    setFlashMessage(`${getTaskConfigCardLabel(cardKey)} 已回退`, "warning");
  }

  async function handleSaveTaskConfig(cardKey = "task") {
    if (!activeTask?.name || !taskConfigDraft) {
      return;
    }
    setSavingTaskConfigCard(cardKey);
    try {
      const payload = buildTaskConfigPayloadFromDraft(taskConfigDraft);
      const response = await api(`/api/tasks/${activeTask.name}/config-files`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const nextDraft = buildTaskConfigDraft(response.config);
      setTaskConfig(response.config);
      setTaskSpec(response.spec);
      setTaskConfigDraft(nextDraft);
      setTaskConfigBaseline(nextDraft);
      setEditingTaskConfigCard("");
      await loadBoot();
      setFlashMessage(`${getTaskConfigCardLabel(cardKey)} 已保存`, "success");
    } catch (error) {
      setFlashMessage(error.message, "error");
    } finally {
      setSavingTaskConfigCard("");
    }
  }

  async function handleSaveReview() {
    if (!activeTask?.name || !selectedRun?.run_id) {
      return;
    }
    for (const record of reviewPayload.records) {
      const decision = record.review_decision || "pending";
      if (decision === "corrected" && !String(record.reviewer_label || "").trim()) {
        setFlashMessage(`样本 ${record.sample_id} 选择 corrected 时必须填写 reviewer label`, "error");
        return;
      }
      if (decision === "rejected" && !String(record.review_comment || "").trim()) {
        setFlashMessage(`样本 ${record.sample_id} 选择 rejected 时必须填写 comment`, "error");
        return;
      }
      if (decision === "accepted" && !String(record.reviewer_label || "").trim()) {
        record.reviewer_label = record.teacher_label || "";
      }
    }
    try {
      const payload = await api(`/api/tasks/${activeTask.name}/runs/${selectedRun.run_id}/review-records`, {
        method: "PUT",
        body: JSON.stringify({
          reviewer: reviewPayload.reviewer || null,
          records: reviewPayload.records,
        }),
      });
      setReviewPayload((current) => ({
        ...current,
        records: payload.records || [],
        summary: payload.summary || null,
      }));
      setFlashMessage("Review 结果已保存", "success");
    } catch (error) {
      setFlashMessage(error.message, "error");
    }
  }

  function serializeProviders(providers) {
    return providers.map((provider) => ({
      name: provider.editable
        ? normalizeProviderId(provider.name || provider.label || "custom_provider")
        : provider.name,
      label: provider.editable
        ? normalizeProviderId(provider.label || provider.name || "custom_provider")
        : provider.label,
      description: provider.description,
      badge: provider.badge,
      implementation: provider.implementation,
      base_url_env: provider.env_keys.base_url_env,
      api_key_env: provider.env_keys.api_key_env,
      base_url: provider.config.base_url,
      api_key: provider.config.api_key || null,
      default_model: provider.config.default_model,
      models: provider.models,
    }));
  }

  async function persistProviders(providers, successMessage) {
    setSavingSettings(true);
    try {
      const response = await api("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify({
          providers: serializeProviders(providers),
        }),
      });
      const normalizedSettings = normalizeSettingsPayload(response.settings);
      setSettings(normalizedSettings);
      setSettingsDraft(deepClone(normalizedSettings));
      setSettingsView("list");
      setCustomProviderDraft(null);
      setFlashMessage(successMessage, "success");
      return normalizedSettings;
    } catch (error) {
      setFlashMessage(error.message, "error");
      throw error;
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleTestProvider(provider) {
    setTestingProvider(provider.name);
    try {
      const result = await api("/api/settings/llm/test", {
        method: "POST",
        body: JSON.stringify({
          provider: provider.name,
          implementation: provider.implementation,
          base_url_env: provider.env_keys.base_url_env,
          api_key_env: provider.env_keys.api_key_env,
          base_url: provider.config.base_url,
          api_key: provider.config.api_key || null,
          default_model: provider.config.default_model,
        }),
      });
      setLlmTests((current) => ({ ...current, [provider.name]: result }));
      setFlashMessage(
        result.ok ? `${provider.name} 连接成功` : `${provider.name} 连接失败`,
        result.ok ? "success" : "error"
      );
      return result;
    } catch (error) {
      setFlashMessage(error.message, "error");
      throw error;
    } finally {
      setTestingProvider("");
    }
  }

  function updateProvider(providerName, updater) {
    setSettingsDraft((current) => ({
      providers: current.providers.map((provider) => {
        if (provider.name !== providerName) {
          return provider;
        }
        const nextProvider = updater(deepClone(provider));
        if (nextProvider.editable) {
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
        }
        return nextProvider;
      }),
    }));
  }

  function updateCustomProviderDraft(updater) {
    setCustomProviderDraft((current) => {
      if (!current) {
        return current;
      }
      const nextProvider = updater(deepClone(current));
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
    });
  }

  function updateTaskConfigJsonField(field, updater, fallback) {
    setTaskConfigDraft((current) => {
      const parsed = safeParseJson(current[field] || "", fallback);
      const nextValue = updater(deepClone(parsed));
      return {
        ...current,
        [field]: JSON.stringify(nextValue, null, 2),
      };
    });
  }

  function updateRuntimeStage(stage, updater) {
    updateTaskConfigJsonField(
      "runtimeText",
      (runtime) => {
        runtime[stage] = updater({ ...(runtime[stage] || {}) });
        return runtime;
      },
      {}
    );
  }

  function updateRuntimeCustomEntry(stage, oldKey, nextKey, nextValue) {
    const normalizedKey = String(nextKey || "").trim();
    setRuntimeCustomModes((current) => {
      const next = { ...current };
      const previousStateKey = runtimeCustomEntryStateKey(stage, oldKey);
      const nextStateKey = runtimeCustomEntryStateKey(stage, normalizedKey);
      const previousMode = next[previousStateKey];
      delete next[previousStateKey];
      if (normalizedKey && previousMode) {
        next[nextStateKey] = previousMode;
      }
      return next;
    });
    updateRuntimeStage(stage, (current) => {
      const updated = { ...current };
      delete updated[oldKey];
      if (normalizedKey) {
        updated[normalizedKey] = nextValue;
      }
      return updated;
    });
  }

  function addRuntimeCustomEntry(stage) {
    updateRuntimeStage(stage, (current) => {
      const updated = { ...current };
      let index = 1;
      let nextKey = `custom_key_${index}`;
      while (nextKey in updated) {
        index += 1;
        nextKey = `custom_key_${index}`;
      }
      updated[nextKey] = "";
      return updated;
    });
  }

  function getRuntimeCustomEntryMode(stage, key) {
    return runtimeCustomModes[runtimeCustomEntryStateKey(stage, key)] || "auto";
  }

  function getRuntimeCustomEntryResolvedType(stage, key, value) {
    const mode = getRuntimeCustomEntryMode(stage, key);
    return mode === "auto" ? inferRuntimeCustomEntryType(value) : mode;
  }

  function updateRuntimeCustomEntryMode(stage, key, nextMode, currentValue) {
    const stateKey = runtimeCustomEntryStateKey(stage, key);
    setRuntimeCustomModes((current) => {
      const next = { ...current };
      if (nextMode === "auto") {
        delete next[stateKey];
      } else {
        next[stateKey] = nextMode;
      }
      return next;
    });
    if (inferRuntimeCustomEntryType(currentValue) === "json") {
      return;
    }
    const inputValue = getRuntimeCustomEntryInputValue(currentValue, nextMode);
    updateRuntimeCustomEntry(stage, key, key, coerceRuntimeCustomEntryInput(inputValue, nextMode));
  }

  function applyRuntimePresetToStage(stage, providerName, source) {
    const currentConfig = runtimeDraft?.[stage] || {};
    const nextConfig =
      source === "global"
        ? buildRuntimePresetFromGlobal(runtimeCatalog, settings, stage, providerName, currentConfig)
        : buildRuntimePreset(runtimeCatalog, stage, providerName, currentConfig);
    updateRuntimeStage(stage, () => nextConfig);
    setFlashMessage(
      source === "global" ? `${stage} 已套用全局 provider 配置` : `${stage} 已套用推荐运行配置`,
      "success"
    );
  }

  function updateScenarioAt(index, updater) {
    updateTaskConfigJsonField(
      "scenariosText",
      (scenarios) =>
        scenarios.map((scenario, scenarioIndex) =>
          scenarioIndex === index ? updater({ ...scenario }) : scenario
        ),
      []
    );
  }

  function addScenarioCard() {
    updateTaskConfigJsonField(
      "scenariosText",
      (scenarios) => [
        ...scenarios,
        {
          intent: labelDraftList[0] || "",
          difficulty: "medium",
          tags: [],
          context: {
            has_visible_report: true,
            previous_report_summary: "",
            dialogue_stage: "standalone",
            language: taskConfigDraft?.task.language || "zh",
          },
          templates: [""],
          generation_count: 1,
        },
      ],
      []
    );
  }

  function removeScenarioCard(index) {
    updateTaskConfigJsonField(
      "scenariosText",
      (scenarios) => scenarios.filter((_, scenarioIndex) => scenarioIndex !== index),
      []
    );
  }

  function toggleRuntimeStageExpanded(stage) {
    setExpandedRuntimeStages((current) => ({
      ...current,
      [stage]: !current[stage],
    }));
  }

  function addCustomProvider() {
    setCustomProviderDraft(emptyCustomProvider(settingsDraft.providers.length + 1));
    setSettingsView("create");
  }

  function cancelCustomProviderCreate() {
    setCustomProviderDraft(null);
    setSettingsView("list");
  }

  async function commitCustomProviderDraft() {
    if (!customProviderDraft) {
      return;
    }
    const normalizedDraft = {
      ...deepClone(customProviderDraft),
      name: normalizeProviderId(customProviderDraft.name || customProviderDraft.label || "custom_provider"),
    };
    normalizedDraft.label = normalizedDraft.name;
    normalizedDraft.env_keys.base_url_env = buildCustomEnvKey(normalizedDraft.name, "BASE_URL");
    normalizedDraft.env_keys.api_key_env = buildCustomEnvKey(normalizedDraft.name, "API_KEY");
    await persistProviders([...settingsDraft.providers, normalizedDraft], `已添加 ${normalizedDraft.name}`);
  }

  async function removeCustomProvider(providerName) {
    await persistProviders(
      settingsDraft.providers.filter((provider) => provider.name !== providerName),
      `已删除 ${providerName}`
    );
  }

  async function saveProvider(providerName, nextProvider) {
    const nextProviders = settingsDraft.providers.map((provider) =>
      provider.name === providerName ? deepClone(nextProvider) : provider
    );
    const savedProviderName =
      nextProvider.editable && (nextProvider.name || nextProvider.label)
        ? normalizeProviderId(nextProvider.name || nextProvider.label)
        : nextProvider.name;
    await persistProviders(nextProviders, `已保存 ${savedProviderName}`);
  }

  function updateReviewRecord(index, updater) {
    setReviewPayload((current) => ({
      ...current,
      records: current.records.map((record, recordIndex) =>
        recordIndex === index ? updater(record) : record
      ),
    }));
  }

  function handleReviewDecisionChange(index, decision) {
    updateReviewRecord(index, (record) => {
      const nextRecord = { ...record, review_decision: decision };
      if (decision === "accepted") {
        nextRecord.reviewer_label = record.reviewer_label || record.teacher_label || "";
      }
      return nextRecord;
    });
  }

  const currentTaskSummary = activeTask ? summarizeTask(activeTask) : "选择 task 进入 run";
  const currentRunSummary = selectedRun
    ? `${selectedRun.status || "draft"} / 已完成 ${Object.keys(selectedRun.stages || {}).length} 个阶段`
    : "尚未选择 run";
  const nextRecommendedCommand = getNextRecommendedCommand(selectedRun);
  const nextRecommendedAction = STAGE_ACTIONS.find(
    (action) => action.command === nextRecommendedCommand
  );
  const workspacePrimaryAction = !selectedRun?.run_id
    ? {
        label: "创建首个 Run",
        onClick: () => handleRunCommand("generate"),
      }
    : nextRecommendedAction
      ? {
          label: `执行 ${nextRecommendedAction.label}`,
          onClick: () => handleRunCommand(nextRecommendedAction.command),
        }
      : {
          label: "查看当前产物",
          onClick: () => setWorkspaceTab("artifacts"),
        };

  return (
    <div className="app-shell">
      <div className="app-backdrop" />

      <header className="topbar">
        <div className="topbar-panel">
          <div className="brand">
            <span className="brand-mark">DF</span>
            <div>
              <p>Calm Pipeline Studio</p>
              <strong>DataForge</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <div className={classNames("message-pill", messageTone && `is-${messageTone}`)}>
              {message}
            </div>
            <button
              className="gear-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="打开 Provider 设置"
            >
              <span className="gear-dot" />
              <span className="gear-icon">⚙</span>
            </button>
          </div>
        </div>
      </header>

      {screen === "home" ? (
        <HomeScreen
          tasks={tasks}
          settings={settings}
          booting={booting}
          onRefresh={loadBoot}
          onOpenTask={openTask}
          onOpenCreateTask={() => setCreateTaskOpen(true)}
          onDeleteTask={handleDeleteTask}
        />
      ) : (
        <main className="workspace-screen">
          <section className="workspace-hero">
            <div className="workspace-title">
              <div className="workspace-title-actions">
                <button className="ghost-button" type="button" onClick={() => setScreen("home")}>
                  返回 Task 列表
                </button>
                <div className="workspace-chip-row">
                  <span className="micro-chip subdued">{`${runs.length} Runs`}</span>
                  {activeTask?.language ? (
                    <span className="micro-chip subdued">{activeTask.language}</span>
                  ) : null}
                  {activeTask?.task_type ? (
                    <span className="micro-chip subdued">{activeTask.task_type}</span>
                  ) : null}
                </div>
              </div>
              <span className="eyebrow">Task Workspace</span>
              <h1>{activeTask?.name || "Task"}</h1>
              <p>{currentTaskSummary}</p>
            </div>

            <div className="workspace-focus-card">
              <div className="workspace-focus-head">
                <span className="eyebrow">Current Focus</span>
                <span className="micro-chip">{selectedRun?.run_id ? "当前 Run" : "等待创建"}</span>
              </div>
              <strong className="workspace-focus-title">
                {selectedRun?.run_id || "先创建一个 Run"}
              </strong>
              <p className="workspace-focus-copy">
                {selectedRun
                  ? `当前状态 ${selectedRun.status || "idle"}。${
                      nextRecommendedAction
                        ? `推荐优先推进 ${nextRecommendedAction.label}。`
                        : "当前 run 已可直接查看当前产物，也可以切换其他工作区。"
                    }`
                  : "当前 task 还没有 run。先创建一个运行实例，再进入产物、复核与配置流。"}
              </p>
              <div className="workspace-status">
                <div className="status-block">
                  <span>当前 Run</span>
                  <strong>{selectedRun?.run_id || "未创建"}</strong>
                </div>
                <div className="status-block">
                  <span>状态</span>
                  <strong>{selectedRun?.status || "idle"}</strong>
                </div>
                <div className="status-block">
                  <span>摘要</span>
                  <strong>{currentRunSummary}</strong>
                </div>
              </div>
              <div className="workspace-focus-actions">
                <button className="primary-button" type="button" onClick={workspacePrimaryAction.onClick}>
                  {workspacePrimaryAction.label}
                </button>
              </div>
            </div>
          </section>

          <section className="workspace-layout">
            <aside className="run-rail">
              <div className="run-rail-shell">
                <div className="section-head compact">
                  <div>
                    <span className="eyebrow">Run Reel</span>
                    <h2>Run 上下文</h2>
                  </div>
                  <span className="micro-chip subdued">{runs.length}</span>
                </div>

                <p className="run-rail-copy">左侧只负责切换 run，真正的推进操作放在右侧工作区。</p>

                <button className="rail-cta" type="button" onClick={() => handleRunCommand("generate")}>
                  新建 Run
                </button>

                <div className="run-list">
                  {runs.map((run) => (
                    <article
                      key={run.run_id}
                      className={classNames("run-card", selectedRun?.run_id === run.run_id && "is-active")}
                    >
                      <button
                        className="run-card-hit"
                        type="button"
                        onClick={() => loadRun(activeTask.name, run.run_id)}
                      >
                        <div className="task-card-head">
                          <span className="run-card-kicker">{run.last_stage || "fresh"}</span>
                          <span className="micro-chip subdued">
                            {selectedRun?.run_id === run.run_id ? "当前" : "可切换"}
                          </span>
                        </div>
                        <strong>{run.run_id}</strong>
                        <p>{run.status || "idle"}</p>
                        <div className="run-card-meta">
                          <span>{formatDate(run.updated_at)}</span>
                        </div>
                        <span className="task-card-entry">
                          {selectedRun?.run_id === run.run_id ? "当前工作上下文" : "切换到这个 Run"}
                        </span>
                      </button>
                      <button className="danger-link" type="button" onClick={() => handleDeleteRun(run.run_id)}>
                        删除
                      </button>
                    </article>
                  ))}

                  {!runs.length && (
                    <div className="empty-rail">
                      <strong>这个 task 还没有 run</strong>
                      <p>点击上方按钮创建第一个 run。</p>
                    </div>
                  )}
                </div>
              </div>
            </aside>

            <section className="cockpit">
              <div className="workspace-tabs-shell">
                <nav className="workspace-tabs" aria-label="workspace tabs">
                  {WORKSPACE_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      className={classNames("workspace-tab", workspaceTab === tab.key && "is-active")}
                      type="button"
                      aria-pressed={workspaceTab === tab.key}
                      onClick={() => setWorkspaceTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              {workspaceTab === "overview" && (
                <OverviewWorkspace
                  selectedRun={selectedRun}
                  nextRecommendedCommand={nextRecommendedCommand}
                  busyCommand={busyCommand}
                  selectedRunCompletedStages={selectedRunCompletedStages}
                  onRunCommand={handleRunCommand}
                  onOpenArtifact={openArtifact}
                />
              )}

              {workspaceTab === "artifacts" && (
                <ArtifactWorkspace
                  selectedRun={selectedRun}
                  groupedRunArtifacts={groupedRunArtifacts}
                  recommendedArtifactKeys={recommendedArtifactKeys}
                  artifactNavSearch={artifactNavSearch}
                  setArtifactNavSearch={setArtifactNavSearch}
                  artifactNavCategoryFilter={artifactNavCategoryFilter}
                  setArtifactNavCategoryFilter={setArtifactNavCategoryFilter}
                  artifactNavCategoryOptions={artifactNavCategoryOptions}
                  artifactKey={artifactKey}
                  setArtifactKey={setArtifactKey}
                  artifactSearch={artifactSearch}
                  setArtifactSearch={setArtifactSearch}
                  artifactFilter={artifactFilter}
                  setArtifactFilter={setArtifactFilter}
                  artifactFilterOptions={artifactFilterOptions}
                  artifactViewMode={artifactViewMode}
                  setArtifactViewMode={setArtifactViewMode}
                  artifactPayload={artifactPayload}
                  artifactDownloadUrl={artifactDownloadUrl}
                  artifactSummary={artifactSummary}
                  artifactLoading={artifactLoading}
                  rawCandidateViewMode={rawCandidateViewMode}
                  setRawCandidateViewMode={setRawCandidateViewMode}
                  rawCandidateGroupBy={rawCandidateGroupBy}
                  setRawCandidateGroupBy={setRawCandidateGroupBy}
                  visibleArtifactRows={visibleArtifactRows}
                  paginatedRawArtifactContent={paginatedRawArtifactContent}
                  artifactPagination={artifactPagination}
                  setArtifactPage={setArtifactPage}
                />
              )}

              {workspaceTab === "review" && (
                <ReviewWorkspace
                  reviewPayload={reviewPayload}
                  setReviewer={(reviewer) =>
                    setReviewPayload((current) => ({ ...current, reviewer }))
                  }
                  onSaveReview={handleSaveReview}
                  reviewSummary={reviewSummary}
                  reviewFilter={reviewFilter}
                  setReviewFilter={setReviewFilter}
                  filteredReviewRecords={filteredReviewRecords}
                  reviewLoading={reviewLoading}
                  onDecisionChange={handleReviewDecisionChange}
                  onUpdateRecord={updateReviewRecord}
                />
              )}

              {workspaceTab === "config" && taskConfigDraft && (
                <TaskConfigWorkspace
                  taskConfigDraft={taskConfigDraft}
                  isEditingTaskConfig={isEditingTaskConfig}
                  setIsEditingTaskConfig={setIsEditingTaskConfig}
                  editingTaskConfigCard={editingTaskConfigCard}
                  setEditingTaskConfigCard={setEditingTaskConfigCard}
                  taskConfigBaseline={taskConfigBaseline}
                  setTaskConfigDraft={setTaskConfigDraft}
                  setPromptFocus={setPromptFocus}
                  setFlashMessage={setFlashMessage}
                  savingTaskConfigCard={savingTaskConfigCard}
                  onSaveTaskConfig={handleSaveTaskConfig}
                  onRevertTaskConfigCard={revertTaskConfigCard}
                  configSummaryCards={configSummaryCards}
                  taskConfigDirty={taskConfigDirty}
                  configAdvice={configAdvice}
                  runtimeDraft={runtimeDraft}
                  exportsDraft={exportsDraft}
                  rulesDraft={rulesDraft}
                  scenariosDraft={scenariosDraft}
                  runtimeCatalog={runtimeCatalog}
                  settings={settings}
                  llmTests={llmTests}
                  expandedRuntimeStages={expandedRuntimeStages}
                  toggleRuntimeStageExpanded={toggleRuntimeStageExpanded}
                  applyRuntimePresetToStage={applyRuntimePresetToStage}
                  updateRuntimeStage={updateRuntimeStage}
                  addRuntimeCustomEntry={addRuntimeCustomEntry}
                  getRuntimeCustomEntryMode={getRuntimeCustomEntryMode}
                  getRuntimeCustomEntryResolvedType={getRuntimeCustomEntryResolvedType}
                  updateRuntimeCustomEntryMode={updateRuntimeCustomEntryMode}
                  updateRuntimeCustomEntry={updateRuntimeCustomEntry}
                  updateTaskConfigJsonField={updateTaskConfigJsonField}
                  promptFocus={promptFocus}
                  labelDraftList={labelDraftList}
                  addScenarioCard={addScenarioCard}
                  updateScenarioAt={updateScenarioAt}
                  removeScenarioCard={removeScenarioCard}
                />
              )}
            </section>
          </section>
        </main>
      )}

      {createTaskOpen ? (
        <CreateTaskModal
          createTaskDraft={createTaskDraft}
          setCreateTaskDraft={setCreateTaskDraft}
          onClose={() => setCreateTaskOpen(false)}
          onSubmit={handleCreateTask}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDrawer
          settings={settings}
          settingsDraft={settingsDraft}
          settingsView={settingsView}
          customProviderDraft={customProviderDraft}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsView("list");
            setCustomProviderDraft(null);
          }}
          onReset={() => {
            setSettingsDraft(deepClone(settings));
            setSettingsView("list");
            setCustomProviderDraft(null);
          }}
          onAddCustomProvider={addCustomProvider}
          onCancelCustomProvider={cancelCustomProviderCreate}
          onCreateCustomProvider={commitCustomProviderDraft}
          savingSettings={savingSettings}
          providerStatusSummary={providerStatusSummary}
          llmTests={llmTests}
          testingProvider={testingProvider}
          onRemoveCustomProvider={removeCustomProvider}
          onSaveProvider={saveProvider}
          onTestProvider={handleTestProvider}
          updateProvider={updateProvider}
          updateCustomProviderDraft={updateCustomProviderDraft}
          setFlashMessage={setFlashMessage}
        />
      ) : null}
    </div>
  );
}

export default App;
