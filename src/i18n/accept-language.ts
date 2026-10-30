import { FALLBACK_LOCALE, isLocale, type AppLocale, type LocalePreference } from "./config";

/**
 * First supported language of an `Accept-Language` header, by `q` order
 * (for equal `q`, the header order). Only the base language counts:
 * `en-US` and `en-GB` give `en`. `*` and `q=0` are ignored.
 */
export function matchAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { base: (tag ?? "").trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((r) => r.base && r.base !== "*" && r.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) if (isLocale(r.base)) return r.base;
  return null;
}

/**
 * Pure resolution (testable, usable in `proxy.ts`):
 * browser cookie → instance setting → `Accept-Language` → `fr`.
 */
export function pickLocale(input: {
  cookie?: string | null;
  instance: LocalePreference;
  acceptLanguage?: string | null;
}): AppLocale {
  if (isLocale(input.cookie)) return input.cookie;
  if (input.instance !== "auto") return input.instance;
  return matchAcceptLanguage(input.acceptLanguage) ?? FALLBACK_LOCALE;
}
