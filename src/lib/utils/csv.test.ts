import { describe, expect, it } from "bun:test";
import { escapeCsvCell } from "./csv";

describe("escapeCsvCell", () => {
  it("neutralises text cells that a spreadsheet would run as a formula", () => {
    expect(escapeCsvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(escapeCsvCell("+1+1")).toBe("'+1+1");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("\t=1")).toBe("'\t=1");
    expect(escapeCsvCell("\r=1")).toBe("\"'\r=1\"");
  });

  it("keeps numbers numeric, negative ones included", () => {
    expect(escapeCsvCell(-12.5)).toBe("-12.5");
    expect(escapeCsvCell(0)).toBe("0");
  });

  it("leaves ordinary text alone and quotes separators", () => {
    expect(escapeCsvCell("Chantier A")).toBe("Chantier A");
    expect(escapeCsvCell("a = b")).toBe("a = b");
    expect(escapeCsvCell("a;b")).toBe("\"a;b\"");
    expect(escapeCsvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(escapeCsvCell("line1\nline2")).toBe("\"line1\nline2\"");
  });

  it("writes empty cells for missing values", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell("")).toBe("");
  });
});
