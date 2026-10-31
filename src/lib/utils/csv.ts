/** First characters a spreadsheet reads as the start of a formula (OWASP CSV injection list). */
const FORMULA_START_RE = /^[=+\-@\t\r]/;

/**
 * One cell of a `;`-separated CSV export opened in a spreadsheet.
 *
 * A text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is
 * prefixed with `'`, so the spreadsheet shows it as text instead of running it
 * as a formula. Numbers are written as they are: a negative value stays numeric.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  const str = FORMULA_START_RE.test(value) ? `'${value}` : value;
  if (/[;"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
