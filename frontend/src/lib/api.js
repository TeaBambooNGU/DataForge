export function resolveApiUrl(path) {
  const baseUrl =
    window.dataforgeDesktop?.backendBaseUrl ||
    import.meta.env.VITE_API_BASE_URL ||
    "";
  if (!baseUrl) {
    return path;
  }
  return `${String(baseUrl).replace(/\/$/, "")}${path}`;
}

export function api(path, options = {}) {
  return fetch(resolveApiUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (response) => {
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
  });
}
