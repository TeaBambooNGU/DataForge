import React from "react";

import { classNames } from "../../lib/utils.js";

export default function HomeScreen({
  desktopInfo,
  tasks,
  settings,
  booting,
  onRefresh,
  onOpenTask,
  onOpenCreateTask,
  onDeleteTask,
  onOpenDesktopPath,
}) {
  const totalRuns = tasks.reduce((sum, item) => sum + (item.run_count || 0), 0);
  const spotlightTask = tasks.find((item) => item.run_count > 0) || tasks[0] || null;
  const workspaceState = desktopInfo?.workspaceState || null;
  const onboardingTitle = workspaceState?.justCreated
    ? "首次启动已完成工作区初始化"
    : workspaceState?.needsOnboarding
      ? "当前工作区还没有真实运行数据"
      : "当前工作区已经可以继续推进";
  const onboardingCopy = workspaceState?.justCreated
    ? "DataForge 已在 Documents 目录下建立专用工作区，并写入默认 task 配置。现在可以直接创建第一个 Task 或进入已有模板。"
    : workspaceState?.needsOnboarding
      ? "当前工作区里还没有 run 产物。你可以新建 Task，或打开工作区直接查看 seeded configs 与日志。"
      : `当前工作区已有 ${workspaceState?.runCount || 0} 个 run，可以直接从首页继续已有任务流。`;

  return (
    <main className="home-screen">
      <section className="hero-panel home-hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Task Entry</span>
          <h1>先选 Task，再推进 Run。</h1>
          <p>
            首页只做一件事: 进入一个任务工作区。进入后再处理 run、artifacts、review 与配置，避免首屏同时承担导航和操作。
          </p>
          <div className="hero-metrics">
            <div>
              <strong>{tasks.length}</strong>
              <span>任务数</span>
            </div>
            <div>
              <strong>{totalRuns}</strong>
              <span>运行数</span>
            </div>
            <div>
              <strong>{settings.providers.length}</strong>
              <span>Providers</span>
            </div>
          </div>
          <div className="hero-actions">
            <button className="primary-button hero-primary-action" type="button" onClick={onOpenCreateTask}>
              新建 Task
            </button>
            <button className="ghost-button" type="button" onClick={onRefresh}>
              刷新任务列表
            </button>
          </div>

          {desktopInfo ? (
            <div className="desktop-home-panel">
              <div className="desktop-home-head">
                <span className="eyebrow">Desktop Context</span>
                <span className={classNames("micro-chip", desktopInfo.isPackaged ? "is-success" : "is-warning")}>
                  {desktopInfo.isPackaged ? "packaged" : "development"}
                </span>
              </div>
              <strong>{onboardingTitle}</strong>
              <p>
                当前工作区位于 <strong>{desktopInfo.workspaceRoot}</strong>，backend 运行在{" "}
                <strong>{desktopInfo.backendBaseUrl}</strong>。
              </p>
              <p>{onboardingCopy}</p>
              {workspaceState ? (
                <div className="task-card-meta">
                  <span>{workspaceState.taskCount} tasks</span>
                  <span>{workspaceState.runCount} runs</span>
                  <span>{workspaceState.hasOnlySeedTasks ? "seed only" : "customized"}</span>
                </div>
              ) : null}
              <div className="hero-actions desktop-home-actions">
                <button
                  className="ghost-button desktop-home-action"
                  type="button"
                  onClick={() => onOpenDesktopPath(desktopInfo.workspaceRoot, "工作区")}
                >
                  打开工作区
                </button>
                <button
                  className="ghost-button desktop-home-action"
                  type="button"
                  onClick={() => onOpenDesktopPath(desktopInfo.logFilePath, "日志文件")}
                >
                  打开日志
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="hero-aside">
          <div className="signal-card">
            <span className="eyebrow">Decision Rule</span>
            <strong>已有任务向下选择，没有任务就新建。</strong>
            <p>Task 是工作单元。先确定任务，再决定是否继续已有 run 或新建新的 run。</p>
          </div>
          <div className="home-spotlight">
            <span className="eyebrow">Quick Start</span>
            {spotlightTask ? (
              <>
                <strong>{spotlightTask.name}</strong>
                <p>
                  {spotlightTask.run_count ? "这个 task 已有可继续的 run。" : "这个 task 已准备好，可以直接创建首个 run。"}
                </p>
                <div className="task-card-meta">
                  <span>{`${spotlightTask.run_count || 0} runs`}</span>
                  <span>{`${spotlightTask.labels?.length || 0} labels`}</span>
                  <span>{spotlightTask.task_type || "workflow"}</span>
                </div>
                <button
                  className="ghost-button home-spotlight-action"
                  type="button"
                  onClick={() => onOpenTask(spotlightTask.name)}
                >
                  继续这个 Task
                </button>
              </>
            ) : (
              <>
                <strong>还没有任何 Task</strong>
                <p>先创建一个任务 scaffold，再进入工作台推进数据流水线。</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="task-stage">
        <div className="section-head">
          <div>
            <span className="eyebrow">Task Field</span>
            <h2>选择一个 Task</h2>
          </div>
        </div>

        <div className="task-grid">
          {tasks.map((task, index) => (
            <article
              key={task.name}
              className={classNames("task-card", index % 2 === 0 ? "tilt-left" : "tilt-right")}
            >
              <button className="task-card-hit" type="button" onClick={() => onOpenTask(task.name)}>
                <div className="task-card-head">
                  <span className="task-card-kicker">{task.theme || "task"}</span>
                  <span className="micro-chip subdued">
                    {task.run_count ? "可继续" : "待启动"}
                  </span>
                </div>
                <strong>{task.name}</strong>
                <p>{task.task_type || "workflow"}</p>
                <div className="task-card-meta">
                  <span>{task.language || "zh"}</span>
                  <span>{task.run_count || 0} runs</span>
                  <span>{task.labels?.length || 0} labels</span>
                </div>
                <span className="task-card-entry">进入任务工作台</span>
              </button>
              <button className="danger-link" type="button" onClick={() => onDeleteTask(task.name)}>
                删除
              </button>
            </article>
          ))}

          {!tasks.length && (
            <div className="empty-board">
              <strong>{booting ? "正在读取任务" : "还没有 task"}</strong>
              <p>先创建一个 task scaffold，再进入 run 界面推进数据流水线。</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
