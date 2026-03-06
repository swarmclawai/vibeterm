const SEARCH_ENGINE_BASE_URL = "https://www.google.com/search?q=";

export function normalizeCompanionUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^(localhost|127(?:\.\d{1,3}){3})(:\d+)?(?:\/.*)?$/i.test(raw)) {
    return `http://${raw}`;
  }
  if (/^[^/\s]+\.[^/\s]+/.test(raw)) return `https://${raw}`;
  return `${SEARCH_ENGINE_BASE_URL}${encodeURIComponent(raw)}`;
}

export function companionLabelForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "google.com" && parsed.pathname === "/search") {
      const query = parsed.searchParams.get("q")?.trim();
      if (query) {
        return query.length > 34 ? `Search: ${query.slice(0, 31)}...` : `Search: ${query}`;
      }
    }
    return host;
  } catch {
    return "Browser";
  }
}
