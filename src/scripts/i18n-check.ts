/**
 * bun run i18n:check [--ns <ns>[,<ns>…]] [--unused] [--strict]
 *
 * BLOCKING check of the src/messages/<locale>/*.json catalogs:
 *   1. same files (namespaces) for every language of LOCALES;
 *   2. same flattened keys (missing / extra), same structure (leaf or object);
 *   3. no empty value;
 *   4. valid ICU (@formatjs/icu-messageformat-parser) and argument parity
 *      across languages (names, plural/select/number/date/time types, tags);
 *   5. every literal code `new AppError("x.y")`, `new ApiError("x.y")`,
 *      `apiError("x.y")`, `{ code: "x.y" }` that looks like a key exists in fr;
 *   6. outside the dashboard, the browser only receives part of the catalog
 *      (`SHELL_NAMESPACES`, `AUTH_NAMESPACES` from src/i18n/messages.ts): every
 *      `useTranslations("ns…")` in the import tree of the root,
 *      (auth) and (public) layouts must target a namespace of the relevant list.
 * Warnings (non-blocking, except with --strict):
 *   - unused keys (code literals, useTranslations /
 *     getTranslations prefixes, `// i18n-dynamic: <prefix>.*` comments);
 *   - en value identical to fr and containing an accent (missed translation);
 *   - apostrophe stuck to a brace (`'{`), which escapes the parameter in ICU.
 *
 * Information (never blocking): values of other languages identical to
 * English (possibly a missed translation, or a term that does not translate).
 *
 * --ns: limits checks 1 to 4 and the warnings to the given namespaces
 * (to check only some files). --unused: detailed list.
 * --untranslated: detailed list of the values identical to English.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { FALLBACK_LOCALE, LOCALES, LOCALE_NAMES } from "../i18n/config";
import { blankComments } from "./i18n-scan";
import { AUTH_NAMESPACES, SHELL_NAMESPACES } from "../i18n/messages";

const ENDONYMS = new Set<string>(Object.values(LOCALE_NAMES));

const ROOT = resolve(import.meta.dirname, "../..");
const MESSAGES_DIR = join(ROOT, "src/messages");

type Json = { [k: string]: Json | string };

const args = process.argv.slice(2);
const nsIdx = args.indexOf("--ns");
const onlyNs = nsIdx >= 0 ? new Set((args[nsIdx + 1] ?? "").split(",").filter(Boolean)) : null;
const showUnused = args.includes("--unused");
const strict = args.includes("--strict");
const showUntranslated = args.includes("--untranslated");

const errors: string[] = [];
const warnings: string[] = [];
/** Values of another language identical to English (information, never blocking). */
const sameAsEnglish: string[] = [];

function loadLocale(locale: string): Map<string, Json> {
  const dir = join(MESSAGES_DIR, locale);
  const out = new Map<string, Json>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const ns = f.slice(0, -5);
    try {
      out.set(ns, JSON.parse(readFileSync(join(dir, f), "utf8")) as Json);
    } catch (e) {
      errors.push(`[${locale}/${f}] invalid JSON: ${(e as Error).message}`);
    }
  }
  return out;
}

/** flattened key → value; objects are recorded to detect structure mismatches. */
function flatten(obj: Json, prefix: string, out: Map<string, string | object>) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.includes(".")) errors.push(`key "${prefix}${k}": a segment must not contain a dot`);
    const key = `${prefix}${k}`;
    if (v && typeof v === "object") {
      if (Object.keys(v).length === 0) out.set(key, {});
      flatten(v as Json, `${key}.`, out);
    } else {
      out.set(key, v);
    }
  }
}

/** ICU signature of a message: typed arguments and tags, sorted. */
function icuSignature(message: string): Set<string> {
  const sig = new Set<string>();
  const visit = (els: MessageFormatElement[]) => {
    for (const el of els) {
      switch (el.type) {
        case TYPE.argument: sig.add(`${el.value}:arg`); break;
        case TYPE.number: sig.add(`${el.value}:number`); break;
        case TYPE.date: sig.add(`${el.value}:date`); break;
        case TYPE.time: sig.add(`${el.value}:time`); break;
        case TYPE.select:
          sig.add(`${el.value}:select`);
          for (const opt of Object.values(el.options)) visit(opt.value);
          break;
        case TYPE.plural:
          sig.add(`${el.value}:plural`);
          for (const opt of Object.values(el.options)) visit(opt.value);
          break;
        case TYPE.tag:
          sig.add(`<${el.value}>`);
          visit(el.children);
          break;
        default:
          break;
      }
    }
  };
  visit(parse(message));
  return sig;
}

// ── 1 to 4: catalogs ──────────────────────────────────────────────────────
const catalogs = new Map(LOCALES.map((l) => [l, loadLocale(l)]));
const ref = catalogs.get(FALLBACK_LOCALE)!;
const refNamespaces = [...ref.keys()].sort();
const flatByLocale = new Map<string, Map<string, Map<string, string | object>>>();

for (const locale of LOCALES) {
  const cat = catalogs.get(locale)!;
  const missingNs = refNamespaces.filter((ns) => !cat.has(ns));
  const extraNs = [...cat.keys()].filter((ns) => !ref.has(ns));
  for (const ns of missingNs) errors.push(`[${locale}] missing file: ${ns}.json`);
  for (const ns of extraNs) errors.push(`[${locale}] extra file (missing in ${FALLBACK_LOCALE}): ${ns}.json`);
  const flat = new Map<string, Map<string, string | object>>();
  for (const [ns, obj] of cat) {
    const m = new Map<string, string | object>();
    flatten(obj, "", m);
    flat.set(ns, m);
  }
  flatByLocale.set(locale, flat);
}

const inScope = (ns: string) => !onlyNs || onlyNs.has(ns);
let messageCount = 0;

for (const ns of refNamespaces) {
  if (!inScope(ns)) continue;
  const refFlat = flatByLocale.get(FALLBACK_LOCALE)!.get(ns)!;
  for (const locale of LOCALES) {
    const flat = flatByLocale.get(locale)!.get(ns);
    if (!flat) continue;
    for (const [key, value] of flat) {
      const where = `[${locale}] ${ns}.${key}`;
      if (typeof value !== "string") continue;
      if (value.trim() === "") errors.push(`${where}: empty value`);
      if (/'[{}]/.test(value)) warnings.push(`${where}: apostrophe stuck to a brace ("'{"): the parameter will be displayed as is`);
      try {
        icuSignature(value);
      } catch (e) {
        errors.push(`${where}: invalid ICU (${(e as Error).message})`);
      }
      if (locale === FALLBACK_LOCALE) messageCount++;
    }
    if (locale === FALLBACK_LOCALE) continue;
    for (const [key, refValue] of refFlat) {
      const value = flat.get(key);
      const where = `[${locale}] ${ns}.${key}`;
      if (value === undefined) {
        errors.push(`${where}: missing key`);
        continue;
      }
      if (typeof refValue !== typeof value) {
        errors.push(`${where}: structure differs from ${FALLBACK_LOCALE} (leaf / object)`);
        continue;
      }
      if (typeof refValue === "string" && typeof value === "string") {
        try {
          const a = [...icuSignature(refValue)].sort().join(", ");
          const b = [...icuSignature(value)].sort().join(", ");
          if (a !== b) errors.push(`${where}: different ICU parameters (${FALLBACK_LOCALE}: ${a || "none"}; ${locale}: ${b || "none"})`);
        } catch {
          /* already reported */
        }
        if (value === refValue && !ENDONYMS.has(value) && /[àâçéèêëîïôùûüÿœæ]/i.test(value)) warnings.push(`${where}: identical to French (missed translation?)`);
        if (locale !== "en" && !ENDONYMS.has(value) && /\p{L}{3}/u.test(value) && value === flatByLocale.get("en")?.get(ns)?.get(key)) {
          sameAsEnglish.push(`${where}: "${value.length > 80 ? `${value.slice(0, 80)}…` : value}"`);
        }
      }
    }
    for (const key of flat.keys()) {
      if (!refFlat.has(key)) errors.push(`[${locale}] ${ns}.${key}: extra key (missing in ${FALLBACK_LOCALE})`);
    }
  }
}

// ── 5 and unused keys: code analysis ─────────────────────────────────────
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) yield p;
  }
}

const allKeys = new Set<string>();
for (const [ns, m] of flatByLocale.get(FALLBACK_LOCALE)!) {
  for (const [k, v] of m) if (typeof v === "string") allKeys.add(`${ns}.${k}`);
}
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/;
const usedLiterals = new Set<string>();
const usedPrefixes: { prefix: string; literals: Set<string> }[] = [];
const dynamicPrefixes = new Set<string>();
const codeRefs: { file: string; code: string }[] = [];

for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("src/messages/") || rel.startsWith("src/scripts/i18n-")) continue;
  const raw = readFileSync(file, "utf8");
  // Examples in comments count neither as usage nor as error codes;
  // `// i18n-dynamic:` declarations are read from the raw text.
  const src = blankComments(raw);
  const literals = new Set<string>();
  for (const m of src.matchAll(/["'`]([A-Za-z0-9_.-]+)["'`]/g)) literals.add(m[1]);
  for (const l of literals) usedLiterals.add(l);
  for (const m of src.matchAll(/(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?["'`]([A-Za-z0-9_.-]+)["'`]/g)) {
    usedPrefixes.push({ prefix: m[1], literals });
  }
  for (const m of raw.matchAll(/i18n-dynamic:\s*([A-Za-z0-9_.-]+?)\.?\*/g)) dynamicPrefixes.add(m[1]);
  // literal error codes
  if (!rel.endsWith(".test.ts")) {
    for (const m of src.matchAll(/new\s+(?:AppError|ApiError)\(\s*["'`]([^"'`]+)["'`]|apiError\(\s*["'`]([^"'`]+)["'`]|\bcode:\s*["'`]([^"'`]+)["'`]/g)) {
      const code = m[1] ?? m[2] ?? m[3];
      if (code && KEY_SHAPE.test(code)) codeRefs.push({ file: rel, code });
    }
  }
}

for (const { file, code } of codeRefs) {
  const ns = code.split(".")[0];
  if (!ref.has(ns)) continue; // e.g. OAuth codes / other formats without a known namespace
  if (!allKeys.has(code)) errors.push(`${file}: error code "${code}" missing from ${FALLBACK_LOCALE}/${ns}.json`);
}

// ── 6. Namespaces sent outside the dashboard ──────────────────────────────
/** Namespaces of the `useTranslations` calls in the import tree (src/ only) of the given files. */
function clientNamespacesOf(entryFiles: string[]): Map<string, string> {
  const seen = new Set<string>();
  const found = new Map<string, string>(); // namespace → first file that uses it
  const resolveSpec = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
      const p = base + ext;
      if (/\.(ts|tsx)$/.test(p) && existsSync(p) && statSync(p).isFile()) return p;
    }
    return null;
  };
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = blankComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/useTranslations\(\s*["'`]([A-Za-z0-9_]+)/g)) {
      if (!found.has(m[1])) found.set(m[1], relative(ROOT, file));
    }
    for (const m of src.matchAll(/(?:import|export)\s[^"'`;]*?from\s*["'`]([^"'`]+)["'`]|import\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
      const spec = m[1] ?? m[2];
      // catalogs and server translator: not components
      if (!spec || /^@\/(messages|i18n\/(messages|server-translator))/.test(spec)) continue;
      const target = resolveSpec(file, spec);
      if (target) walk(target);
    }
  };
  for (const f of entryFiles) walk(f);
  return found;
}
const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? listFiles(p) : /\.(ts|tsx)$/.test(e) ? [p] : [];
  });
const partialTrees: { label: string; entries: string[]; allowed: readonly string[] }[] = [
  {
    label: "root layout, error pages and (public) → SHELL_NAMESPACES",
    entries: [join(ROOT, "src/app/layout.tsx"), join(ROOT, "src/app/error.tsx"), ...listFiles(join(ROOT, "src/app/(public)"))],
    allowed: SHELL_NAMESPACES,
  },
  { label: "(auth) group → AUTH_NAMESPACES", entries: listFiles(join(ROOT, "src/app/(auth)")), allowed: AUTH_NAMESPACES },
];
if (!onlyNs) {
  for (const { label, entries, allowed } of partialTrees) {
    for (const [ns, file] of clientNamespacesOf(entries)) {
      if (!allowed.includes(ns)) errors.push(`${file}: useTranslations("${ns}…") outside the catalog sent to the browser (${label}): add "${ns}" to the list in src/i18n/messages.ts`);
    }
  }
}

function isUsed(key: string): boolean {
  if (usedLiterals.has(key)) return true;
  for (const p of dynamicPrefixes) if (key === p || key.startsWith(`${p}.`)) return true;
  for (const { prefix, literals } of usedPrefixes) {
    if (!key.startsWith(`${prefix}.`)) continue;
    const rest = key.slice(prefix.length + 1);
    if (literals.has(rest)) return true;
    // t("a.b") with a shorter prefix; t.rich / t.markup / t.has: same literal
    const parts = rest.split(".");
    for (let i = 1; i < parts.length; i++) if (literals.has(parts.slice(i).join(".")) && literals.has(parts.slice(0, i).join("."))) return true;
  }
  return false;
}

const unusedByNs = new Map<string, string[]>();
for (const key of allKeys) {
  const ns = key.split(".")[0];
  if (!inScope(ns) || isUsed(key)) continue;
  if (!unusedByNs.has(ns)) unusedByNs.set(ns, []);
  unusedByNs.get(ns)!.push(key);
}
const unusedTotal = [...unusedByNs.values()].reduce((n, l) => n + l.length, 0);

// ── Output ────────────────────────────────────────────────────────────────
const scope = onlyNs ? ` (namespaces: ${[...onlyNs].join(", ")})` : "";
console.log(`i18n:check — ${LOCALES.join(", ")} — ${refNamespaces.length} namespaces, ${messageCount} messages${scope}`);
if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (unusedTotal) {
  console.log(`\n⚠ ${unusedTotal} unused key(s) (non-blocking${strict ? " except with --strict" : ""}): ${[...unusedByNs].map(([ns, l]) => `${ns} ${l.length}`).join(", ")}`);
  if (showUnused) for (const l of unusedByNs.values()) for (const k of l) console.log(`  - ${k}`);
  else console.log("  (details: --unused)");
}
if (sameAsEnglish.length) {
  console.log(`\nℹ ${sameAsEnglish.length} value(s) identical to English (non-blocking; to translate unless the term is invariable)${showUntranslated ? ":" : " (details: --untranslated)"}`);
  if (showUntranslated) for (const s of sameAsEnglish) console.log(`  - ${s}`);
}
if (errors.length) {
  console.log(`\n✘ ${errors.length} error(s):`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
if (strict && (warnings.length || unusedTotal)) {
  console.log("\n✘ --strict: warnings present");
  process.exit(1);
}
console.log("\n✔ catalogs consistent");
