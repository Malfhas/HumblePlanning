import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { registerAllTools, ToolDeniedError } from "@/lib/services/mcp-tools";
import type { UserPermissions } from "@/lib/services/permission-service";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { FALLBACK_LOCALE, type AppLocale } from "@/i18n/config";
import { getServerTranslator, translateKey } from "@/i18n/server-translator";
import { localizeErrorParams } from "@/lib/utils/error-params";
import { toolsForPage } from "./toolsets";

/**
 * The AI chat tools are those of the MCP server (`mcp-tools.ts`), collected
 * by a registrar that mimics `McpServer.tool()`: a single data access
 * surface, hence a single place where permissions are checked, with the
 * chat-specific write permission (`ai_chat:write`) and the `ai_chat` audit
 * source.
 *
 * Every write carries `needsApproval`: the turn is suspended and the UI asks
 * for the user's explicit consent, whatever their level. In read-only mode,
 * writes are not declared at all: the model cannot even propose
 * them.
 */

interface CollectedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  readOnly: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (args: any, extra: never) => unknown;
}

/** MCP result (`content[0].text`) reduced to plain JSON for the model. */
export function mcpResultToJson(result: unknown): unknown {
  const content = (result as { content?: { type: string; text?: string }[] } | null)?.content;
  const text = content?.find((part) => part.type === "text")?.text;
  if (text === undefined) return JSON.parse(JSON.stringify(result ?? null));
  try {
    return JSON.parse(text);
  } catch {
    return { result: text };
  }
}

/**
 * A permission refusal (or a business rule) is told to the model; a
 * technical failure is not: the trace stays in the server logs. Coded errors
 * (`AppError`, including `ToolDeniedError`) are refusals or business rules
 * by construction (`tasks.errors.notFound`, `tasks.errors.locked`…); any
 * other error (database, network, free-form message) is technical.
 */
export function isUserFacingToolError(error: unknown): boolean {
  return error instanceof ToolDeniedError || error instanceof AppError;
}

/**
 * Message of a tool error, in the user's language. The `mcp-tools`
 * registrar already translates the `AppError`s it sees; a coded error left
 * raw (message = code) is translated here, to be safe.
 */
async function toolErrorMessage(error: unknown, locale: AppLocale): Promise<string> {
  if (error instanceof AppError && error.message === error.code) {
    const params = await localizeErrorParams(error.params, locale).catch(() => error.params);
    return translateKey(await getServerTranslator(locale), error.code, params) ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The tools declared to the model for this turn, and the label of each write. */
export function buildChatTools(params: {
  userId: string;
  perms: UserPermissions;
  canWrite: boolean;
  /** Page being viewed (floating sphere); null in full screen: everything is open. */
  page?: string | null;
  /** Language of refusals and tool messages (request language). */
  locale?: AppLocale;
}): { tools: ToolSet; writeDescriptions: Record<string, string> } {
  const locale = params.locale ?? FALLBACK_LOCALE;
  const collected: CollectedTool[] = [];
  registerAllTools(
    {
      tool: (name, description, schema, annotations, cb) => {
        collected.push({
          name,
          description,
          schema: schema as Record<string, unknown>,
          readOnly: annotations.readOnlyHint === true,
          cb: cb as CollectedTool["cb"],
        });
      },
    },
    { userId: params.userId, permissions: params.perms, writePermission: "ai_chat:write", auditSource: "ai_chat", locale },
  );

  const allowedOnPage = toolsForPage(params.page ?? null);
  const kept = collected.filter((t) => (params.canWrite || t.readOnly) && allowedOnPage(t.name));

  const tools: ToolSet = Object.fromEntries(
    kept.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: z.object(t.schema as z.ZodRawShape),
        // The safeguard: a write suspends execution and waits for consent
        needsApproval: !t.readOnly,
        execute: async (args: Record<string, unknown>) => {
          try {
            return mcpResultToJson(await t.cb(args, {} as never));
          } catch (error) {
            const message = await toolErrorMessage(error, locale);
            logger.warn("ai_chat", `Tool ${t.name} denied or failed`, { message });
            return {
              error: isUserFacingToolError(error) ? message : `The tool ${t.name} is temporarily unavailable.`,
            };
          }
        },
      }),
    ]),
  );

  return {
    tools,
    writeDescriptions: Object.fromEntries(collected.filter((t) => !t.readOnly).map((t) => [t.name, t.description])),
  };
}
