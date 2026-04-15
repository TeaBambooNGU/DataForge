import React from "react";

export default function CreateTaskModal({
  createTaskDraft,
  setCreateTaskDraft,
  onClose,
  onSubmit,
}) {
  return (
    <div className="overlay">
      <div className="modal-card">
        <div className="section-head">
          <div>
            <span className="eyebrow">Create Task</span>
            <h2>新建 Task</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <form className="editor-stack" onSubmit={onSubmit}>
          <label>
            <span>Name</span>
            <input
              type="text"
              value={createTaskDraft.name}
              onChange={(event) =>
                setCreateTaskDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="new-task-name"
            />
          </label>
          <label>
            <span>Theme</span>
            <input
              type="text"
              value={createTaskDraft.theme}
              onChange={(event) =>
                setCreateTaskDraft((current) => ({ ...current, theme: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Language</span>
            <input
              type="text"
              value={createTaskDraft.language}
              onChange={(event) =>
                setCreateTaskDraft((current) => ({ ...current, language: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Task Type</span>
            <input
              type="text"
              value={createTaskDraft.task_type}
              onChange={(event) =>
                setCreateTaskDraft((current) => ({ ...current, task_type: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Entry Schema</span>
            <input
              type="text"
              value={createTaskDraft.entry_schema}
              onChange={(event) =>
                setCreateTaskDraft((current) => ({ ...current, entry_schema: event.target.value }))
              }
            />
          </label>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" type="submit">
              创建并进入
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
