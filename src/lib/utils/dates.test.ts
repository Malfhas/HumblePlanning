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
  getTodayInTimezone,
  serverTimezone,
  setDateFormats,
  setTimezone,
} from "./dates";

afterEach(() => {
  setDateFormats("dd/MM/yyyy", "24h");
  setTimezone("auto");
});

const DEC31 = new Date(2026, 11, 31, 14, 30);
/** 31/12/2026 at 14:30 in Paris, as stored: an instant in UTC. */
const DEC31_PARIS = "2026-12-31T13:30:00Z";
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
    expect(formatDateTime(DEC31_PARIS, "fr", S24)).toBe("31/12/2026 à 14h30");
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
  // On the server (these tests), « auto » is the instance time zone: TIMEZONE of the environment, else Europe/Paris
  const savedTimezone = process.env.TIMEZONE;
  afterEach(() => {
    if (savedTimezone === undefined) delete process.env.TIMEZONE;
    else process.env.TIMEZONE = savedTimezone;
  });

  test("auto time zone on the server: the instance one, connector and time per language", () => {
    delete process.env.TIMEZONE;
    expect(formatDateTime(DEC31_PARIS, "fr", S24)).toBe("31/12/2026 à 14h30");
    expect(formatDateTime(DEC31_PARIS, "en", S24)).toBe("31/12/2026, 14:30");
    process.env.TIMEZONE = "America/Montreal";
    expect(formatDateTime(DEC31_PARIS, "fr", S24)).toBe("31/12/2026 à 08h30");
  });
  test("auto time zone, 12 h", () => {
    delete process.env.TIMEZONE;
    expect(formatDateTime(DEC31_PARIS, "en", { dateFormat: "MM/dd/yyyy", timeFormat: "12h", timezone: "auto" })).toBe("12/31/2026 02:30 PM");
  });
  test("fixed time zone: converted, with the configured formats", () => {
    process.env.TIMEZONE = "America/Montreal";
    const tokyo = { ...S24, timezone: "Asia/Tokyo" };
    expect(formatDateTime(DEC31_PARIS, "fr", tokyo)).toBe("31/12/2026 à 22h30");
    expect(formatDateTime(DEC31_PARIS, "en", { ...tokyo, dateFormat: "MM/dd/yyyy", timeFormat: "12h" })).toBe("12/31/2026 10:30 PM");
    // Across midnight: the day of the time zone
    expect(formatDateTime("2026-12-31T23:30:00Z", "fr", { ...S24, timezone: "Europe/Paris" })).toBe("01/01/2027 à 00h30");
    // Daylight saving time: summer offset in July
    expect(formatDateTime("2026-07-01T12:00:00Z", "fr", { ...S24, timezone: "Europe/Paris" })).toBe("01/07/2026 à 14h00");
  });
});

describe("serverTimezone / getTodayInTimezone", () => {
  const savedTimezone = process.env.TIMEZONE;
  afterEach(() => {
    if (savedTimezone === undefined) delete process.env.TIMEZONE;
    else process.env.TIMEZONE = savedTimezone;
  });

  test("TIMEZONE of the environment when valid, else Europe/Paris", () => {
    process.env.TIMEZONE = "America/Montreal";
    expect(serverTimezone()).toBe("America/Montreal");
    process.env.TIMEZONE = "Mars/Olympus";
    expect(serverTimezone()).toBe("Europe/Paris");
    process.env.TIMEZONE = "auto";
    expect(serverTimezone()).toBe("Europe/Paris");
    delete process.env.TIMEZONE;
    expect(serverTimezone()).toBe("Europe/Paris");
  });

  test("today of the instance time zone with « auto », not of UTC", () => {
    process.env.TIMEZONE = "Pacific/Kiritimati"; // UTC+14: often already tomorrow
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(getTodayInTimezone("auto")).toBe(expected);
    expect(getTodayInTimezone("Pacific/Kiritimati")).toBe(expected);
  });
});
