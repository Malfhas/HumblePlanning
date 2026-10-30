/**
 * Escaping for injecting data into hand-built HTML
 * (email templates). Apply to ANY user-entered data
 * (task title, project name, notes, name, login…), including the
 * parameters passed to `t.markup()`, which does not escape them.
 */
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Multi-line text: escaped, then line breaks converted to `<br>`. */
export function escapeHtmlMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/** Safe CSS color for a `style` attribute (#rgb, #rrggbb, #rrggbbaa), otherwise the fallback value. */
export function safeCssColor(value: unknown, fallback = "#a1a1aa"): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}
