export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return response.json();
}

export function formatDate(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatArtifactValue(value) {
  if (value == null || value === "") {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.join(", ") || "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function getRejectionReasonLabel(reason) {
  const labels = {
    empty_user_text: "用户文本为空",
    parse_failed: "教师输出解析失败",
    label_not_allowed: "标签不在允许范围",
    text_too_short: "文本过短",
    text_too_long: "文本过长",
    rewrite_without_visible_report: "无可见报告却判为 rewrite_report",
    historical_leakage: "与历史 gold/eval/hard_cases 冲突",
  };
  return labels[reason] || reason || "-";
}

export function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}
