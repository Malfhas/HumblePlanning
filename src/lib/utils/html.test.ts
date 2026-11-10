import { describe, expect, test } from "bun:test";
import { escapeHtml, escapeHtmlMultiline, safeCssColor } from "./html";
import {
  taskCreatedTemplate,
  taskUpdatedTemplate,
  weeklySummaryTemplate,
  passwordResetTemplate,
} from "@/lib/services/email-templates";
import { DEFAULT_DATE_SETTINGS } from "@/lib/utils/dates";

const OPTIONS = { dates: { ...DEFAULT_DATE_SETTINGS } };

describe("escapeHtml", () => {
  test("special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
  test("multi-line", () => {
    expect(escapeHtmlMultiline("a<b>\nc")).toBe("a&lt;b&gt;<br>c");
  });
  test("CSS color", () => {
    expect(safeCssColor("#3b82f6")).toBe("#3b82f6");
    expect(safeCssColor("red;background:url(x)")).toBe("#a1a1aa");
    expect(safeCssColor(undefined, "#000")).toBe("#000");
  });
});

describe("email templates: user data escaped", () => {
  const evil = `<script>alert(1)</script>`;
  test("task creation", () => {
    const { subject, html } = taskCreatedTemplate(
      { title: evil, startDate: "2026-11-03", notes: `ligne1\n<img src=x onerror=alert(1)>` },
      { name: `<b>Projet</b>`, color: `red" onmouseover="x` },
      `<i>Jean</i>`,
      `App <x>`,
      "",
      "fr",
      OPTIONS,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Projet</b>");
    expect(html).not.toContain("onmouseover");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("ligne1<br>&lt;img");
    expect(html).toContain("App &lt;x&gt;");
    // The subject is plain text (header), not escaped
    expect(subject).toContain(evil);
  });
  test("update: the list of changes is escaped (and \"<vide>\" becomes visible)", () => {
    const { html } = taskUpdatedTemplate({ title: "T", startDate: "2026-11-03" }, null, ["Titre : <vide> → A"], "Jean", "App", "", "fr", OPTIONS);
    expect(html).toContain("Titre : &lt;vide&gt; → A");
  });
  test("password reset: URL escaped in the attribute", () => {
    const { html } = passwordResetTemplate("Jean", `https://x/reset?token=a"b`, 10, "App", "", "fr", OPTIONS);
    expect(html).toContain(`href="https://x/reset?token=a&quot;b"`);
    expect(html).toContain(`<html lang="fr" `);
  });
  test("recipient language: <html lang>", () => {
    const { html } = passwordResetTemplate("Jean", "https://x/r", 10, "App", "", "en", OPTIONS);
    expect(html).toContain(`<html lang="en" `);
  });
  test("weekly summary", () => {
    const tasks = new Map([["2026-11-02", [{ title: evil, project: { name: evil, color: "javascript:1" }, placeText: evil }]]]);
    const { html } = weeklySummaryTemplate(evil, tasks, new Date(2026, 10, 2), new Date(2026, 10, 8), "App", "", "fr", OPTIONS);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:1");
  });
});

describe("email layout", () => {
  const task = { title: "T", startDate: "2026-11-03" };
  test("theme colour, logo, button and automatic notice", () => {
    const brand = { color: "#0d9488", logo: { url: "https://planning.example.com/api/branding/email-logo?v=1", width: 99, height: 48 } };
    const { html } = taskCreatedTemplate(task, null, "Jean", "App", "https://planning.example.com/", "fr", { ...OPTIONS, brand });
    expect(html).toContain(`src="https://planning.example.com/api/branding/email-logo?v=1" width="99" height="48" alt="App"`);
    expect(html).toContain("background:#0d9488");
    expect(html).toContain(`href="https://planning.example.com/planning"`);
    expect(html).toContain("Merci de ne pas y répondre");
    expect(html).not.toContain("#7c3aed");
  });
  test("without the address of the instance: the name instead of the logo, no button; violet by default", () => {
    const { html } = taskCreatedTemplate(task, null, "Jean", "App", "", "en", OPTIONS);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/planning\"");
    expect(html).toContain("background:#7c3aed");
    expect(html).toContain("Please do not reply to it.");
  });
  test("a light theme colour: dark text on the button, darker accent text", () => {
    const { html } = passwordResetTemplate("Jean", "https://x/r", 10, "App", "", "fr", { ...OPTIONS, brand: { color: "#facc15", logo: null } });
    expect(html).toContain("color:#18181b;text-decoration:none;border-radius:999px;");
    expect(html).not.toContain("color:#facc15");
  });
});
