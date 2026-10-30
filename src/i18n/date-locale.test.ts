import { describe, expect, test } from "bun:test";
import { formatDate, formatWithLocale } from "@/lib/utils/dates";
import { localizeDatePattern } from "./date-locale";

describe("date patterns per language", () => {
  const d = new Date(2026, 10, 2); // Monday 2 November 2026

  test("German: dot after the day, comma after the weekday", () => {
    expect(formatWithLocale(d, "EEEE d MMMM yyyy", "de")).toBe("Montag, 2. November 2026");
    expect(formatWithLocale(d, "d MMMM", "de")).toBe("2. November");
  });

  test("Spanish: \"de\" between day, month and year", () => {
    expect(formatWithLocale(d, "EEEE d MMMM yyyy", "es")).toBe("lunes, 2 de noviembre de 2026");
    expect(formatDate(d, "es", "d MMMM yyyy")).toBe("2 de noviembre de 2026");
  });

  test("French, English and numeric patterns unchanged", () => {
    expect(formatWithLocale(d, "EEEE d MMMM yyyy", "fr")).toBe("lundi 2 novembre 2026");
    expect(formatWithLocale(d, "d MMMM yyyy", "en")).toBe("2 November 2026");
    expect(localizeDatePattern("dd/MM/yyyy", "de")).toBe("dd/MM/yyyy");
    expect(localizeDatePattern("EEEE d MMMM", "de-AT")).toBe("EEEE, d. MMMM");
  });
});
