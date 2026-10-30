import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DATE_SETTINGS,
  dateSettingsFromConfig,
  formatDate,
  formatDateTime,
  formatHourLabel,
  formatTime,
  formatWithLocale,
  getClientDateSettings,
  getDateFnsLocale,
  setDateFormats,
  setTimezone,
} from "./dates";

afterEach(() => {
  setDateFormats("dd/MM/yyyy", "24h");
  setTimezone("auto");
});

const DEC31 = new Date(2026, 11, 31, 14, 30);
const S24 = { ...DEFAULT_DATE_SETTINGS };

describe("formatDate: pattern from the setting, names per language", () => {
  test("numeric patterns identical in fr and en", () => {
    for (const fmt of ["dd/MM/yyyy", "dd.MM.yyyy", "dd-MM-yyyy", "yyyy-MM-dd", "MM/dd/yyyy"]) {
      expect(formatDate(DEC31, "fr", fmt)).toBe(formatDate(DEC31, "en", fmt));
    }
    expect(formatDate(DEC31, "en", "dd/MM/yyyy")).toBe("31/12/2026");
    expect(formatDate("2026-12-31", "en", "d MMMM yyyy")).toBe("31 December 2026");
  });
  test("text patterns: days and months translated", () => {
    expect(formatDate(DEC31, "fr", "EEEE d MMMM yyyy")).toBe("jeudi 31 décembre 2026");
    expect(formatDate(DEC31, "en", "EEEE d MMMM yyyy")).toBe("Thursday 31 December 2026");
    expect(formatDate(DEC31, "fr", "d MMM yyyy")).toBe("31 déc. 2026");
    expect(formatDate(DEC31, "en", "d MMM yyyy")).toBe("31 Dec 2026");
  });
  test("formatWithLocale + en-GB: ISO week (Monday)", () => {
    expect(formatWithLocale(DEC31, "EEEEE", "en")).toBe("T");
    expect(getDateFnsLocale("en").options?.weekStartsOn).toBe(1);
  });
});

describe("explicit settings", () => {
  test("dateSettingsFromConfig: empty values → defaults, unknown TIME_FORMAT → 24 h", () => {
    expect(dateSettingsFromConfig({})).toEqual(DEFAULT_DATE_SETTINGS);
    expect(dateSettingsFromConfig({ PLANNING_DATE_FORMAT: "", TIME_FORMAT: "x", TIMEZONE: null })).toEqual(DEFAULT_DATE_SETTINGS);
    expect(dateSettingsFromConfig({ PLANNING_DATE_FORMAT: "MM/dd/yyyy", TIME_FORMAT: "12h", TIMEZONE: "Europe/Paris" })).toEqual({
      dateFormat: "MM/dd/yyyy",
      timeFormat: "12h",
      timezone: "Europe/Paris",
    });
  });
  test("the browser state (DateFormatProvider) does not affect the formatting functions", () => {
    setDateFormats("MM/dd/yyyy", "12h");
    setTimezone("Europe/Paris");
    expect(getClientDateSettings()).toEqual({ dateFormat: "MM/dd/yyyy", timeFormat: "12h", timezone: "Europe/Paris" });
    expect(formatTime("14:30", "fr", "24h")).toBe("14h30");
    expect(formatHourLabel(14, "en", "24h")).toBe("14:00");
    expect(formatDateTime(DEC31, "fr", S24)).toBe("31/12/2026 à 14h30");
  });
});

describe("formatTime / formatHourLabel", () => {
  test("24 h: separator per language", () => {
    expect(formatTime("14:30:00", "fr", "24h")).toBe("14h30");
    expect(formatTime("14:30", "en", "24h")).toBe("14:30");
    expect(formatTime("09:00", "fr", "24h")).toBe("9h");
    expect(formatTime("09:00", "en", "24h")).toBe("09:00");
    expect(formatTime("09:05", "fr", "24h")).toBe("9h05");
    expect(formatHourLabel(9, "fr", "24h")).toBe("9h");
    expect(formatHourLabel(9, "en", "24h")).toBe("09:00");
  });
  test("12 h: identical in both languages", () => {
    expect(formatTime("14:30", "fr", "12h")).toBe("2:30 PM");
    expect(formatTime("14:30", "en", "12h")).toBe("2:30 PM");
    expect(formatHourLabel(14, "en", "12h")).toBe("2PM");
  });
  test("empty value", () => {
    expect(formatTime(null, "en", "24h")).toBe("");
  });
});

describe("formatDateTime", () => {
  test("auto time zone: connector and time per language", () => {
    expect(formatDateTime(DEC31, "fr", S24)).toBe("31/12/2026 à 14h30");
    expect(formatDateTime(DEC31, "en", S24)).toBe("31/12/2026, 14:30");
  });
  test("auto time zone, 12 h", () => {
    expect(formatDateTime(DEC31, "en", { dateFormat: "MM/dd/yyyy", timeFormat: "12h", timezone: "auto" })).toBe("12/31/2026 02:30 PM");
  });
  test("fixed time zone: Intl of the language", () => {
    const paris = { ...S24, timezone: "Europe/Paris" };
    const d = "2026-12-31T13:30:00Z";
    expect(formatDateTime(d, "fr", paris)).toBe("31/12/2026 14:30");
    expect(formatDateTime(d, "en", paris)).toBe("31/12/2026, 14:30");
  });
});
