import { describe, expect, test } from "bun:test";
import { matchAcceptLanguage, pickLocale } from "./accept-language";
import { isLocale, isLocalePreference } from "./config";

describe("matchAcceptLanguage", () => {
  test("missing or empty header", () => {
    expect(matchAcceptLanguage(null)).toBeNull();
    expect(matchAcceptLanguage(undefined)).toBeNull();
    expect(matchAcceptLanguage("")).toBeNull();
  });
  test("base language of regional tags", () => {
    expect(matchAcceptLanguage("en-US")).toBe("en");
    expect(matchAcceptLanguage("fr-CA")).toBe("fr");
    expect(matchAcceptLanguage("EN-gb")).toBe("en");
  });
  test("q-value order, then header order", () => {
    expect(matchAcceptLanguage("fr;q=0.5, en;q=0.9")).toBe("en");
    expect(matchAcceptLanguage("en, fr")).toBe("en");
    expect(matchAcceptLanguage("fr;q=0.8, en;q=0.8")).toBe("fr");
  });
  test("unsupported languages ignored, first supported one kept", () => {
    expect(matchAcceptLanguage("it-IT,it;q=0.9,en;q=0.8")).toBe("en");
    expect(matchAcceptLanguage("it, pt")).toBeNull();
  });
  test("Spanish and German recognized (base language)", () => {
    expect(matchAcceptLanguage("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(matchAcceptLanguage("de-AT, fr;q=0.5")).toBe("de");
  });
  test("* and q=0 ignored, invalid q ignored", () => {
    expect(matchAcceptLanguage("*")).toBeNull();
    expect(matchAcceptLanguage("en;q=0, fr;q=0.1")).toBe("fr");
    expect(matchAcceptLanguage("en;q=abc, fr")).toBe("fr");
  });
});

describe("pickLocale: cookie → APP_LOCALE → Accept-Language → fr", () => {
  test("cookie takes priority", () => {
    expect(pickLocale({ cookie: "en", instance: "fr", acceptLanguage: "fr" })).toBe("en");
    expect(pickLocale({ cookie: "fr", instance: "en", acceptLanguage: "en" })).toBe("fr");
  });
  test("invalid cookie ignored", () => {
    expect(pickLocale({ cookie: "it", instance: "auto", acceptLanguage: "en" })).toBe("en");
    expect(pickLocale({ cookie: "de", instance: "auto", acceptLanguage: "en" })).toBe("de");
  });
  test("APP_LOCALE enforced without a cookie", () => {
    expect(pickLocale({ cookie: null, instance: "en", acceptLanguage: "fr" })).toBe("en");
  });
  test("auto: browser, then French", () => {
    expect(pickLocale({ instance: "auto", acceptLanguage: "en-GB" })).toBe("en");
    expect(pickLocale({ instance: "auto", acceptLanguage: "it" })).toBe("fr");
    expect(pickLocale({ instance: "auto", acceptLanguage: "es-ES" })).toBe("es");
    expect(pickLocale({ instance: "auto" })).toBe("fr");
  });
});

test("isLocale / isLocalePreference", () => {
  expect(isLocale("fr")).toBe(true);
  expect(isLocale("auto")).toBe(false);
  expect(isLocalePreference("auto")).toBe(true);
  expect(isLocale("es")).toBe(true);
  expect(isLocalePreference("de")).toBe(true);
  expect(isLocalePreference("it")).toBe(false);
});
