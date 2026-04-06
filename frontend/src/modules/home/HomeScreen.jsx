import React from "react";

import { classNames } from "../../lib/utils.js";

export default function HomeScreen({
  tasks,
  settings,
  booting,
  onRefresh,
  onOpenTask,
  onOpenCreateTask,
  onDeleteTask,
}) {
  return (
    <main className="home-screen">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Focal Action</span>
          <h1>先进入一个 Task，再启动它的 Run。</h1>
          <p>
            首屏不再是后台导航，而是任务入口场。用户先挑选已有 task 或新建 task，进入后才看到 run、artifacts、review
            与配置。
          </p>
          <div className="hero-metrics">
            <div>
              <strong>{tasks.length}</strong>
              <span>Tasks</span>
            </div>
            <div>
              <strong>{tasks.reduce((sum, item) => sum + (item.run_count || 0), 0)}</strong>
              <span>Runs</span>
            </div>
            <div>
              <strong>{settings.providers.length}</strong>
              <span>Providers</span>
            </div>
          </div>
        </div>

        <div className="hero-aside">
          <div className="signal-card">
            <span className="eyebrow">Launch Surface</span>
            <strong>Open Existing Task</strong>
            <p>直接挑一个任务进入工作舱，继续已有 run 或创建新的 run。</p>
          </div>
          <button className="create-tile" type="button" onClick={onOpenCreateTask}>
            <span className="eyebrow">New Task</span>
            <strong>Create A Fresh Track</strong>
            <p>新 task 会直接 scaffold 出默认配置，然后进入 React 工作台继续编辑。</p>
          </button>
        </div>
      </section>

      <section className="task-stage">
        <div className="section-head">
          <div>
            <span className="eyebrow">Task Field</span>
            <h2>Choose Your Task</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onRefresh}>
            刷新
          </button>
        </div>

        <div className="task-grid">
          {tasks.map((task, index) => (
            <article
              key={task.name}
              className={classNames("task-card", index % 2 === 0 ? "tilt-left" : "tilt-right")}
            >
              <button className="task-card-hit" type="button" onClick={() => onOpenTask(task.name)}>
                <span className="task-card-kicker">{task.theme || "task"}</span>
                <strong>{task.name}</strong>
                <p>
                  {task.language || "zh"} / {task.task_type || "workflow"}
                </p>
                <div className="task-card-meta">
                  <span>{task.run_count || 0} runs</span>
                  <span>{task.labels?.length || 0} labels</span>
                </div>
              </button>
              <button className="danger-link" type="button" onClick={() => onDeleteTask(task.name)}>
                Delete
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
