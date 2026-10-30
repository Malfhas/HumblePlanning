/**
 * bun run i18n:scan [paths…] [--list] [--max N] [--json]
 *
 * Detects French left hard-coded in the code (.ts/.tsx): "…", '…',
 * `…` literals and JSX text >…<, after stripping comments, imports and
 * logger.* / console.* lines. TypeScript port of the scan_fr.py prototype.
 *
 * Exceptions: src/i18n/scan-allowlist.json (paths, strings, patterns) and the
 * `// i18n-ignore <reason>` comment on the line itself or the previous
 * line.
 *
 *   bun run i18n:scan                          # all of src/, summary per file
 *   bun run i18n:scan src/components/tasks --list
 *   bun run i18n:scan --max 0                  # fails if there is at least one string
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { looksFrench, FR_ACCENT_RE, FR_WORDS } from "./i18n-fr-detector";

const ROOT = resolve(import.meta.dirname, "../..");
const ALLOWLIST = JSON.parse(readFileSync(join(ROOT, "src/i18n/scan-allowlist.json"), "utf8")) as {
  paths: Record<string, string>;
  strings: string[];
  patterns: string[];
};
const allowPaths = Object.keys(ALLOWLIST.paths);
const allowStrings = new Set(ALLOWLIST.strings);
const allowPatterns = ALLOWLIST.patterns.map((p) => new RegExp(p));

export interface Finding {
  line: number;
  text: string;
}

/** Replaces comments with spaces (line breaks are kept). */
export function blankComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  let state: string | null = null;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (state === null) {
      if (src.startsWith("//", i)) {
        const j = src.indexOf("\n", i);
        const end = j < 0 ? n : j;
        out.push(" ".repeat(end - i));
        i = end;
        continue;
      }
      if (src.startsWith("/*", i)) {
        const j = src.indexOf("*/", i + 2);
        const end = j < 0 ? n : j + 2;
        out.push(src.slice(i, end).replace(/[^\n]/g, " "));
        i = end;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") state = c;
      out.push(c);
      i++;
      continue;
    }
    out.push(c);
    if (c === "\\" && i + 1 < n) {
      out.push(src[i + 1]);
      i += 2;
      continue;
    }
    if (c === state) state = null;
    else if (c === "\n" && (state === '"' || state === "'")) state = null;
    i++;
  }
  return out.join("");
}

const STR_RE = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const JSX_TEXT_RE = />\s*([^<>{}]*?[A-Za-zÀ-ÿ][^<>{}]*?)\s*</g;
/** JSX text next to an expression: `>Text {value}<`, `{value} text<`. Braces are also TypeScript code, so stronger evidence is required. */
const JSX_TEXT_BRACE_RE = /(?:>|\})\s*([^<>{}]*?[A-Za-zÀ-ÿ][^<>{}]*?)\s*(?:<|\{)/g;
const LOG_LINE_RE = /\b(logger|console)\.(info|warn|error|debug|log)\(/;

function isAllowed(text: string): boolean {
  const s = text.trim();
  return allowStrings.has(s) || allowPatterns.some((re) => re.test(s));
}

export function scanSource(src: string, isTsx: boolean): Finding[] {
  const originalLines = src.split("\n");
  let code = blankComments(src);
  // imports (possibly multi-line) → spaces
  code = code.replace(/^\s*import[^;]*;/gm, (m) => m.replace(/[^\n]/g, " "));
  const codeLines = code.split("\n");
  // logging lines → blank
  code = codeLines.map((l) => (LOG_LINE_RE.test(l) ? " ".repeat(l.length) : l)).join("\n");

  const lineAt = (() => {
    const starts: number[] = [0];
    for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
    return (pos: number) => {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    };
  })();
  const ignored = (line: number) =>
    /i18n-ignore/.test(originalLines[line - 1] ?? "") || /^\s*\/\/\s*i18n-ignore/.test(originalLines[line - 2] ?? "");

  const found: Finding[] = [];
  for (const m of code.matchAll(STR_RE)) {
    const s = m[1] ?? m[2] ?? m[3] ?? "";
    if (!looksFrench(s) || isAllowed(s)) continue;
    const line = lineAt(m.index ?? 0);
    if (!ignored(line)) found.push({ line, text: s.trim() });
  }
  if (isTsx) {
    // literal contents replaced by spaces (positions kept) to avoid counting twice
    const blank = code.replace(STR_RE, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, " ") + m[m.length - 1]);
    const seen = new Set<number>();
    const matches = [
      ...[...blank.matchAll(JSX_TEXT_RE)].map((m) => ({ m, braces: false })),
      ...[...blank.matchAll(JSX_TEXT_BRACE_RE)].map((m) => ({ m, braces: true })),
    ];
    for (const { m, braces } of matches) {
      const t = m[1].split(/\s+/).join(" ").trim();
      if (!t || t.includes("=>") || t.includes("&&") || /^[/*]/.test(t)) continue;
      if (/[;=]|\)\s*$|^\w+\(/.test(t)) continue;
      const words = t.match(/[A-Za-zÀ-ÿœŒ']+/g) ?? [];
      if (words.length === 0) continue;
      const frWords = words.filter((w) => FR_WORDS.has(w.toLowerCase())).length;
      const fr = braces
        ? FR_ACCENT_RE.test(t) || frWords >= 2
        : FR_ACCENT_RE.test(t) || frWords > 0 || /^[A-ZÀ-Ý]/.test(t);
      if (!fr || isAllowed(t)) continue;
      const line = lineAt(m.index ?? 0);
      if (seen.has(line)) continue;
      seen.add(line);
      if (!ignored(line)) found.push({ line, text: t });
    }
  }
  return found;
}

function* walk(path: string): Generator<string> {
  const st = statSync(path);
  if (st.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry === ".next") continue;
    yield* walk(join(path, entry));
  }
}

function shouldScan(rel: string): boolean {
  if (!/\.(ts|tsx)$/.test(rel) || rel.endsWith(".d.ts") || /\.test\.tsx?$/.test(rel)) return false;
  return !allowPaths.some((p) => rel.startsWith(p));
}

export function scanPaths(paths: string[]): Map<string, Finding[]> {
  const results = new Map<string, Finding[]>();
  for (const p of paths) {
    for (const file of walk(resolve(ROOT, p))) {
      const rel = relative(ROOT, file);
      if (!shouldScan(rel)) continue;
      const found = scanSource(readFileSync(file, "utf8"), rel.endsWith(".tsx"));
      if (found.length) results.set(rel, found);
    }
  }
  return results;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const asJson = args.includes("--json");
  const maxIdx = args.indexOf("--max");
  const max = maxIdx >= 0 ? Number(args[maxIdx + 1]) : null;
  const paths = args.filter((a, i) => !a.startsWith("--") && !(maxIdx >= 0 && i === maxIdx + 1));
  const results = scanPaths(paths.length ? paths : ["src"]);

  let total = 0;
  let unique = 0;
  const rows = [...results.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (asJson) {
    console.log(JSON.stringify(Object.fromEntries(rows.map(([f, v]) => [f, v])), null, 1));
  }
  for (const [file, found] of rows) {
    const u = new Set(found.map((f) => f.text)).size;
    total += found.length;
    unique += u;
    if (asJson) continue;
    console.log(`${String(found.length).padStart(5)} ${String(u).padStart(5)}  ${file}`);
    if (list) for (const f of found) console.log(`        ${file}:${f.line}  ${JSON.stringify(f.text)}`);
  }
  if (!asJson) console.log(`TOTAL files ${results.size}, strings ${total} (unique per file ${unique})`);
  if (max !== null && total > max) {
    console.error(`✘ ${total} hard-coded French string(s) (maximum allowed: ${max})`);
    process.exit(1);
  }
}
