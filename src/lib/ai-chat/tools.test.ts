import { describe, expect, it } from "bun:test";
import { buildChatTools, isUserFacingToolError, mcpResultToJson } from "./tools";
import { listedTools, pageFromPath, toolsForPage } from "./toolsets";
import { ToolDeniedError } from "@/lib/services/mcp-tools";
import { AppError } from "@/lib/errors";
import type { UserPermissions } from "@/lib/services/permission-service";

const WRITE_TOOLS = ["create-task", "update-task", "delete-task", "move-task", "copy-task", "create-project", "update-project"];
const perms = (permissions: string[], isAdmin = false): UserPermissions => ({ userId: "u", roleId: "r", teamId: null, businessUnitId: null, permissions, isAdmin });

describe("chat tools (mcp-tools adapter)", () => {
  it("in read-only mode, no write tool is declared", () => {
    const { tools, writeDescriptions } = buildChatTools({ userId: "u", perms: perms(["ai_chat:use"]), canWrite: false });
    const names = Object.keys(tools);
    expect(names.length).toBeGreaterThanOrEqual(30);
    expect(names.some((n) => WRITE_TOOLS.includes(n))).toBe(false);
    expect(Object.keys(writeDescriptions)).toEqual([]);
  });

  it("with write access, the 7 write tools are declared and all carry needsApproval", () => {
    const { tools, writeDescriptions } = buildChatTools({ userId: "u", perms: perms(["ai_chat:use", "ai_chat:write"]), canWrite: true });
    for (const name of WRITE_TOOLS) {
      expect(tools[name]).toBeDefined();
      expect((tools[name] as { needsApproval?: unknown }).needsApproval).toBe(true);
    }
    expect(Object.keys(writeDescriptions).sort()).toEqual([...WRITE_TOOLS].sort());
    // Reads, on the other hand, run without asking for consent
    expect((tools["list-tasks"] as { needsApproval?: unknown }).needsApproval).toBe(false);
  });

  it("the write permission is the chat one (ai_chat:write), not the MCP server one", () => {
    const { tools } = buildChatTools({ userId: "u", perms: perms(["ai_chat:use", "mcp:write"]), canWrite: true });
    // mcp:write opens nothing here: registerAllTools does not declare writes without ai_chat:write
    expect(Object.keys(tools).some((n) => WRITE_TOOLS.includes(n))).toBe(false);
  });

  it("a refusal is passed on as is, a technical failure is hidden", () => {
    expect(isUserFacingToolError(new ToolDeniedError("mcpTools.errors.permissionRequired", { permission: "pages:tasks" }))).toBe(true);
    // Coded business error thrown by a service (e.g. tasks.errors.notFound), translated into the user's language
    expect(isUserFacingToolError(new AppError("errors.notFound"))).toBe(true);
    // Free-form message (no service throws one anymore): treated as a technical failure
    expect(isUserFacingToolError(new Error("Limit reached: 5 task(s) maximum"))).toBe(false);
    expect(isUserFacingToolError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(false);
    expect(isUserFacingToolError(new Error('duplicate key value violates unique constraint "x"'))).toBe(false);
  });

  it("the MCP result becomes plain JSON", () => {
    expect(mcpResultToJson({ content: [{ type: "text", text: '{"a":1}' }] })).toEqual({ a: 1 });
    expect(mcpResultToJson({ content: [{ type: "text", text: "Tâche supprimée" }] })).toEqual({ result: "Tâche supprimée" });
  });
});

describe("tools per page (floating sphere)", () => {
  const allTools = Object.keys(buildChatTools({ userId: "u", perms: perms([], true), canWrite: true }).tools);

  it("every listed tool exists, and every tool is listed", () => {
    for (const name of listedTools()) expect(allTools).toContain(name);
    for (const name of allTools) expect(listedTools().has(name)).toBe(true);
  });

  it("without a known page, everything is open; otherwise the base set and the page family", () => {
    expect(allTools.every(toolsForPage(null))).toBe(true);
    const logistics = toolsForPage("logistics");
    expect(logistics("list-vehicles")).toBe(true);
    expect(logistics("whoami")).toBe(true);
    expect(logistics("create-task")).toBe(false);
  });

  it("the page is derived from the path, by segment", () => {
    expect(pageFromPath("/planning")).toBe("planning");
    expect(pageFromPath("/tasks")).toBe("planning");
    expect(pageFromPath("/stats/users")).toBe("stats");
    expect(pageFromPath("/vehicle-types")).toBe("logistics");
    expect(pageFromPath("/settings")).toBeNull();
  });
});
