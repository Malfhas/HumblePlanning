/**
 * Numeric comparison of dotted versions (`1.10.0` > `1.9.3`). A suffix
 * (`1.2.0-debug`) and missing segments are ignored; a non-numeric segment
 * counts as 0. Negative when `a` is older than `b`.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().split("-")[0].split(".").map((s) => parseInt(s, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
