import { describe, expect, it } from "bun:test";
import { DEFAULT_SYSTEM_PROMPT, TITLE_PROMPT, TYPOGRAPHY_RULE, documentsNotice, resolveSystemPrompt } from "./prompts";

describe("chat prompts", () => {
  it("the default prompt is in English, without em or en dashes", () => {
    expect(DEFAULT_SYSTEM_PROMPT.startsWith("You are the AI assistant built into {{appName}}")).toBe(true);
    for (const text of [DEFAULT_SYSTEM_PROMPT, TITLE_PROMPT, TYPOGRAPHY_RULE]) {
      expect(/[–—]/.test(text)).toBe(false);
    }
  });

  it("announces that every write is confirmed and that a refusal is not retried", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Every change is held until the user explicitly approves it");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("do not try again unless asked");
  });

  it("leaves the optional task fields empty (default values: no invented times or duration)", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Optional task fields (title, notes, start and end times, duration, place, resource) stay empty");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("When the user asks for the default values, leave every optional field empty");
  });

  it("replaces {{appName}} and falls back to the original prompt when the custom one is empty", () => {
    const p = resolveSystemPrompt("   ", "Humble Planning");
    expect(p.includes("{{appName}}")).toBe(false);
    expect(p).toContain("built into Humble Planning");
    expect(resolveSystemPrompt("Custom {{appName}}", "X")).toBe("Custom X");
  });

  it("the documents notice repeats the random token of both delimiters", () => {
    const notice = documentsNotice("ab12cd34");
    expect(notice).toContain("<<<DOC-ab12cd34>>>");
    expect(notice).toContain("<<<END-ab12cd34>>>");
  });
});
