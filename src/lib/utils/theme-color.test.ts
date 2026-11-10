import { describe, expect, it } from "bun:test";
import { DEFAULT_THEME_COLOR, contrastRatio, hexToRgb, readableOnWhite, textOn, themeColor, tint } from "./theme-color";

describe("themeColor", () => {
  it("normalises a colour, else gives the violet", () => {
    expect(themeColor("#7C3AED")).toBe("#7c3aed");
    expect(themeColor("0ea5e9")).toBe("#0ea5e9");
    expect(themeColor("#f0a")).toBe("#ff00aa");
    expect(themeColor("")).toBe(DEFAULT_THEME_COLOR);
    expect(themeColor(null)).toBe(DEFAULT_THEME_COLOR);
    expect(themeColor("red;background:url(x)")).toBe(DEFAULT_THEME_COLOR);
  });
});

describe("shades of the colour", () => {
  it("tint: mixed with white", () => {
    expect(tint("#7c3aed", 1)).toBe("#7c3aed");
    expect(tint("#7c3aed", 0)).toBe("#ffffff");
    expect(hexToRgb(tint("#7c3aed", 0.25))).toEqual([222, 206, 251]);
  });

  it("textOn: white on the violet and on a teal, black on a yellow", () => {
    expect(textOn("#7c3aed")).toBe("#ffffff");
    expect(textOn("#0d9488")).toBe("#ffffff");
    expect(textOn("#facc15")).toBe("#18181b");
  });

  it("readableOnWhite: the violet stays, a yellow is darkened until readable", () => {
    expect(readableOnWhite("#7c3aed")).toBe("#7c3aed");
    const yellow = readableOnWhite("#facc15");
    expect(yellow).not.toBe("#facc15");
    expect(contrastRatio(yellow, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
