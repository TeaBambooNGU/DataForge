export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

export function formatDate(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Date(value).toLocaleString("zh-CN");
  } catch {
    return value;
  }
}

export function formatBytes(value) {
  if (!value) {
    return "0 B";
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

export function humanizeLabel(value) {
  return String(value || "-").replaceAll("_", " ");
}

export function shortenText(value, limit = 72) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function normalizeStageName(value) {
  return String(value || "").replaceAll("_", "-");
}

function looksLikeRatio(label) {
  const text = String(label || "").toLowerCase();
  return ["rate", "accuracy", "f1", "precision", "recall", "pass"].some((token) =>
    text.includes(token)
  );
}

export function formatMetricValue(label, value) {
  if (value == null || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    if (looksLikeRatio(label) && value >= 0 && value <= 1) {
      return `${(value * 100).toFixed(1)}%`;
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
