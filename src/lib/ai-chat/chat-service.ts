import { randomUUID } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  aiChatConversations,
  aiChatMessages,
  aiChatQuotaLedger,
  aiChatToolCalls,
  businessUnits,
  projects,
  users,
} from "@/db/schema";
import type { AiChatMessageStatus } from "@/db/schema/ai-chat";
import { getConfigValues } from "@/lib/services/config-service";
import { createPushNotification } from "@/lib/services/push-notification-service";
import { getVisibleProjectIds, hasPermission, type UserPermissions } from "@/lib/services/permission-service";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { LOCALE_NAMES, type AppLocale } from "@/i18n/config";
import { resolveRecipientLocale, resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, type ServerTranslator } from "@/i18n/server-translator";
import { effectiveDefaultModel, type AiChatConfig, type AiChatReasoning } from "./config";
import { getInstanceTimezone } from "@/lib/services/config-service";
import { documentsNotice, resolveSystemPrompt, TITLE_PROMPT, TYPOGRAPHY_RULE } from "./prompts";
import { emitToUser } from "./realtime";
import {
  abortOutcome,
  Cadence,
  cleanTitle,
  notificationTitle,
  phaseOfChunk,
  tooManyRepliesError,
  withoutDashes,
  type ReplyStep,
} from "./reply-logic";
import { runningReplies } from "./running";
import { buildChatTools } from "./tools";

/**
 * AI chat: the model works with the MCP server tools, no more, no less.
 * A single data access surface, hence a single place where permissions
 * are checked, and every write tool asks for the user's consent before
 * running (`needsApproval`).
 *
 * The reply does not depend on the client: it is consumed here to the end,
 * saved as it goes and broadcast to the user in real time. Leaving the
 * page does not stop it; only the « Arrêter » button and the maximum
 * duration do.
 */

/** Projects listed upfront in the context of the « Tout le planning » scope. */
const PROJECT_LIST_LIMIT = 60;

/**
 * OpenRouter API URL. `OPENROUTER_BASE_URL` exists only for development
 * and tests (mock server compatible with OpenRouter): read only when it is
 * set, never exposed in the UI.
 */
export function openRouterBaseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

function openRouter(apiKey: string) {
  const baseURL = process.env.OPENROUTER_BASE_URL?.trim();
  return createOpenRouter({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

/** What the public OpenRouter catalog tells us about a model. */
export interface OpenRouterModel {
  name: string;
  /** Accepts a PDF without prior conversion. */
  file: boolean;
  /** Can look at an image. */
  image: boolean;
}

// ─── Startup ───

/**
 * A restart during a reply leaves it RUNNING in the database with nobody left
 * to finish it: we settle it at startup, otherwise it would count forever
 * in the limits and in the list.
 */
export async function markStaleAiChatRepliesInterrupted(): Promise<void> {
  try {
    // The cause is written in the language of the conversation owner, the only one who will read it
    const running = await db
      .select({ id: aiChatMessages.id, locale: users.locale })
      .from(aiChatMessages)
      .innerJoin(aiChatConversations, eq(aiChatConversations.id, aiChatMessages.conversationId))
      .innerJoin(users, eq(users.id, aiChatConversations.userId))
      .where(eq(aiChatMessages.status, "RUNNING"));
    const byLocale = new Map<AppLocale, string[]>();
    for (const row of running) {
      const locale = await resolveRecipientLocale(row.locale);
      byLocale.set(locale, [...(byLocale.get(locale) ?? []), row.id]);
    }
    let total = 0;
    for (const [locale, ids] of byLocale) {
      const t = await getServerTranslator(locale);
      const rows = await db
        .update(aiChatMessages)
        .set({ status: "INTERRUPTED", error: t("aiChat.replyErrors.serverRestarted"), finishedAt: new Date() })
        .where(and(eq(aiChatMessages.status, "RUNNING"), inArray(aiChatMessages.id, ids)))
        .returning({ id: aiChatMessages.id });
      total += rows.length;
    }
    if (total) {
      logger.warn("ai_chat", `${total} chat reply(ies) left running by a previous process, marked as interrupted`);
    }
  } catch (error) {
    logger.warn("ai_chat", "Could not clean up the replies left running", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Model catalog ───

const globalForCatalog = globalThis as unknown as {
  __aiChatModelCatalog?: { expiresAt: number; models: Record<string, OpenRouterModel> } | null;
};

/**
 * OpenRouter catalog: commercial name and input modalities of each model.
 * These modalities decide what happens to an attached PDF (sent as is to a
 * model that can read it, otherwise converted to text on our side). Public
 * data, cached for six hours; a failure is never blocking.
 */
export async function getModelCatalog(): Promise<Record<string, OpenRouterModel>> {
  const cache = globalForCatalog.__aiChatModelCatalog;
  if (cache && cache.expiresAt > Date.now()) return cache.models;
  try {
    const response = await fetch(`${openRouterBaseUrl()}/models`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rawCatalog = (await response.json()) as {
      data: { id: string; name: string; architecture?: { input_modalities?: string[] } }[];
    };
    const models = Object.fromEntries(
      rawCatalog.data.map((model) => {
        // « DeepSeek: DeepSeek V4 Flash » → the provider is already in the identifier
        const separator = model.name.indexOf(": ");
        const modalities = model.architecture?.input_modalities ?? [];
        return [
          model.id,
          {
            name: separator > 0 ? model.name.slice(separator + 2) : model.name,
            file: modalities.includes("file"),
            image: modalities.includes("image"),
          },
        ];
      }),
    );
    globalForCatalog.__aiChatModelCatalog = { expiresAt: Date.now() + 6 * 3_600_000, models };
  } catch (error) {
    logger.warn("ai_chat", `OpenRouter catalog unavailable: ${error instanceof Error ? error.message : String(error)}`);
    // Retry in five minutes, without losing what we already had
    globalForCatalog.__aiChatModelCatalog = { expiresAt: Date.now() + 300_000, models: cache?.models ?? {} };
  }
  return globalForCatalog.__aiChatModelCatalog!.models;
}

// ─── Attached documents ───

/**
 * Isolates the content of attached documents behind a delimiter drawn at
 * random for this request. A file therefore cannot close the tag and pass its
 * own sentences off as instructions: the token is unknown to it at the time
 * it is written.
 */
export function delimitDocuments(messages: UIMessage[]): { messages: UIMessage[]; notice: string } {
  // Without the global flag: otherwise `test` would keep its index from one line to the next
  const marker = /^--- DOCUMENT JOINT : .+ ---$/m;
  const hasDocument = messages.some((message) =>
    (message.parts ?? []).some((part) => part.type === "text" && marker.test(part.text)),
  );
  if (!hasDocument) return { messages, notice: "" };

  const token = randomUUID().slice(0, 8);
  const withTags = (message: UIMessage): UIMessage => ({
    ...message,
    parts: (message.parts ?? []).map((part) =>
      part.type === "text"
        ? {
            ...part,
            text: part.text
              .replace(/^--- DOCUMENT JOINT : (.+?) ---$/gm, `<<<DOC-${token} name="$1">>>`)
              .replace(/^--- FIN DU DOCUMENT ---$/gm, `<<<END-${token}>>>`),
          }
        : part,
    ),
  });

  return {
    messages: messages.map((message) => (message.role === "user" ? withTags(message) : message)),
    notice: documentsNotice(token),
  };
}

/** Does a PDF travel in this conversation? */
function containsPdf(messages: UIMessage[]): boolean {
  return messages.some((message) =>
    (message.parts ?? []).some(
      (part) => part.type === "file" && (part as { mediaType?: string }).mediaType === "application/pdf",
    ),
  );
}

/** The text of the user's last question, without its attachments. */
export function questionText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === "user");
  return (last?.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

// ─── Models and errors ───

/**
 * A provider error, phrased for an administrator. The known case: a model
 * that enforces reasoning rejects the "none" reasoning effort with a terse
 * English message; we name the model and the setting to change, in the
 * user's language. Other provider messages pass through unchanged.
 */
export function explainModelError(message: string, model: string, t: ServerTranslator): string {
  if (/reasoning is mandatory/i.test(message)) {
    return t("aiChat.replyErrors.reasoningMandatory", { model });
  }
  return message;
}

/** A model outside the admin list is rejected: otherwise the client could route anywhere, at any price. */
export function allowedModel(requested: string | undefined, config: Pick<AiChatConfig, "models" | "defaultModel">): string {
  const defaultModel = effectiveDefaultModel(config);
  if (!requested || requested === defaultModel) return defaultModel;
  if (!config.models.includes(requested)) {
    throw new AppError("aiChat.errors.modelNotAllowed");
  }
  return requested;
}

// ─── Scope ───

/** A conversation only targets a project the user can see (null: the whole schedule). */
export async function assertScope(perms: UserPermissions, projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const visibleIds = await getVisibleProjectIds(perms);
  if (visibleIds && !visibleIds.includes(projectId)) throw new AppError("aiChat.errors.projectInaccessible", { status: 403 });
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new AppError("aiChat.errors.projectInaccessible", { status: 403 });
}

/** Projects offered for the scope: visible, not archived. */
export async function scopeProjects(perms: UserPermissions, limit?: number) {
  const visibleIds = await getVisibleProjectIds(perms);
  if (visibleIds && visibleIds.length === 0) return [];
  const query = db
    .select({ id: projects.id, businessNumber: projects.businessNumber, name: projects.name, status: projects.status })
    .from(projects)
    .where(and(ne(projects.status, "archived"), visibleIds ? inArray(projects.id, visibleIds) : undefined))
    .orderBy(asc(projects.businessNumber), asc(projects.name));
  return limit ? query.limit(limit) : query;
}

// ─── Context ───

/** The first name only, for greetings: never the last name. */
async function userFirstName(userId: string): Promise<string> {
  const [user] = await db
    .select({ firstName: users.firstName, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const firstName = user?.firstName?.trim() || user?.name?.trim().split(/\s+/)[0] || "";
  return firstName ? `The user's first name is ${firstName}: greet them with it.` : "";
}

function today(timeZone: string): string {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // i18n-ignore context for the model, in English like the system prompt
  return `Today is ${weekday} ${date}, time zone ${timeZone}.`;
}

async function projectContext(perms: UserPermissions, projectId: string): Promise<string> {
  await assertScope(perms, projectId);
  const [project] = await db
    .select({
      businessNumber: projects.businessNumber,
      name: projects.name,
      status: projects.status,
      bu: businessUnits.name,
      ownerFirstName: users.firstName,
      ownerName: users.name,
    })
    .from(projects)
    .leftJoin(businessUnits, eq(businessUnits.id, projects.businessUnitId))
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(eq(projects.id, projectId))
    .limit(1);
  const owner = [project?.ownerFirstName, project?.ownerName].filter(Boolean).join(" ") || "-";
  // Context for the model, in English like the system prompt (project data as is)
  return [
    `SELECTED PROJECT - technical id: ${projectId}`,
    // i18n-ignore project data (number and name as entered)
    project?.businessNumber ? `${project.businessNumber} - ${project.name}` : (project?.name ?? ""),
    // i18n-ignore context for the model, in English
    `Status: ${project?.status ?? "-"} · Business unit: ${project?.bu ?? "-"} · Owner: ${owner}`,
    "Use this id in every tool call without asking the user for it.",
  ].join("\n");
}

/**
 * « Tout le planning » scope: the assistant works on the projects the user
 * can see. The list is given upfront, which avoids a tool round trip on
 * almost every question.
 */
async function wholePlanningContext(perms: UserPermissions): Promise<string> {
  const projectList = await scopeProjects(perms, PROJECT_LIST_LIMIT);
  return [
    "SCOPE - WHOLE PLANNING",
    "You can work on the projects below (the ones this user can see). Use the technical id in tool calls.",
    ...projectList.map((project) =>
      // i18n-ignore project list for the model (user-entered data)
      `- ${project.businessNumber ? `${project.businessNumber} - ` : ""}${project.name} (${project.status}) · ${project.id}`,
    ),
    // i18n-ignore context for the model, in English
    projectList.length === PROJECT_LIST_LIMIT ? `List truncated to the first ${PROJECT_LIST_LIMIT}: call list-projects for the rest.` : "",
    "If the request does not clearly point to a project, ask which one before acting.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildContext(
  userId: string,
  perms: UserPermissions,
  canWrite: boolean,
  scope: { projectId: string | null; followsNavigation: boolean },
  locale: AppLocale,
): Promise<string> {
  const timeZone = await getInstanceTimezone();
  /**
   * Floating sphere: the scope may have changed since the previous turns,
   * whose tools targeted another project. The model must know that only
   * this one applies to the current question.
   */
  const navigationNote = scope.followsNavigation
    ? "The scope of this conversation follows the user's navigation: it may differ from earlier messages. Only the scope below applies to the current question."
    : "";
  const accessLevel = canWrite
    ? "Access level: read and write (every change still requires the user's explicit approval in the interface)."
    : "Access level: read-only: no write tool is available, you cannot change anything.";
  const scopeContext = scope.projectId ? await projectContext(perms, scope.projectId) : await wholePlanningContext(perms);
  // The reply follows the language of the last message; the UI language settles an ambiguous message
  const languageNote = `The user's interface language is ${LOCALE_NAMES[locale]} (${locale}): reply in the language of their latest message, and use this one when it is unclear.`;
  return [await userFirstName(userId), today(timeZone), languageNote, accessLevel, navigationNote, scopeContext].filter(Boolean).join("\n");
}

// ─── Limits and stop ───

/**
 * Safeguards, checked BEFORE writing the question: a single reply in progress
 * per conversation (thread consistency rule), and N per user across all
 * conversations (setting). Counted in the database: it is the only source
 * that survives the process.
 */
export async function assertReplyLimits(userId: string, conversationId: string, maxPerUser: number): Promise<void> {
  const [[inConversation], [forUser]] = await Promise.all([
    db
      .select({ n: count() })
      .from(aiChatMessages)
      .where(and(eq(aiChatMessages.conversationId, conversationId), eq(aiChatMessages.status, "RUNNING"))),
    db
      .select({ n: count() })
      .from(aiChatMessages)
      .innerJoin(aiChatConversations, eq(aiChatConversations.id, aiChatMessages.conversationId))
      .where(and(eq(aiChatMessages.status, "RUNNING"), eq(aiChatConversations.userId, userId))),
  ]);
  if ((inConversation?.n ?? 0) > 0) {
    throw new AppError("aiChat.errors.replyInProgress", { status: 409 });
  }
  const running = forUser?.n ?? 0;
  if (running >= maxPerUser) throw tooManyRepliesError(running);
}

/** This user's conversation, not deleted, otherwise 404. */
export async function getUserConversation(userId: string, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(aiChatConversations)
    .where(
      and(
        eq(aiChatConversations.id, conversationId),
        eq(aiChatConversations.userId, userId),
        isNull(aiChatConversations.deletedAt),
      ),
    )
    .limit(1);
  if (!conversation) throw new AppError("aiChat.errors.conversationNotFound", { status: 404 });
  return conversation;
}

/**
 * Stops the reply in progress of a conversation: the provider call is cut,
 * the row moves to CANCELLED with what had been written. Without a reply in
 * progress, there is nothing to do, and it is not an error.
 */
export async function stopReply(userId: string, conversationId: string): Promise<void> {
  await getUserConversation(userId, conversationId);
  runningReplies.get(conversationId)?.abort();
}

// ─── Automatic title ───

/**
 * Conversation title, requested from the model after the first question. The
 * question stays the title while the reply runs; then we replace it, but only
 * if the title has not changed in the meantime (renamed by hand, it belongs to
 * the user). A failure here bothers nobody: the temporary title stays.
 */
async function generateTitle(params: {
  conversationId: string;
  userId: string;
  temporaryTitle: string;
  question: string;
  model: string;
  config: AiChatConfig;
}): Promise<void> {
  if (!params.question || !params.config.apiKey) return;
  try {
    const { text } = await generateText({
      model: openRouter(params.config.apiKey)(params.model, {
        provider: {
          data_collection: params.config.dataCollection,
          ...(params.config.zdr ? { zdr: true } : {}),
        },
        reasoning: { effort: "none" },
      }),
      system: TITLE_PROMPT,
      prompt: params.question.slice(0, 2000),
      maxOutputTokens: 40,
      temperature: 0.3,
      abortSignal: AbortSignal.timeout(20_000),
    });
    const title = cleanTitle(text);
    // Empty reply: a model that "thinks" anyway can use up the 40 tokens without writing
    if (!title) {
      logger.warn("ai_chat", `Empty automatic title (model ${params.model})`);
      return;
    }
    if (title === params.temporaryTitle) return;
    const updated = await db
      .update(aiChatConversations)
      .set({ title })
      .where(and(eq(aiChatConversations.id, params.conversationId), eq(aiChatConversations.title, params.temporaryTitle)))
      .returning({ id: aiChatConversations.id });
    if (updated.length) {
      void emitToUser(params.userId, "chat:conversation", { id: params.conversationId, title });
    }
  } catch (error) {
    logger.warn("ai_chat", `Automatic title not obtained (model ${params.model}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── Log ───

/**
 * Closes the row created at the start: content, outcome, tokens and actual cost.
 * Then, if the provider returned a cost, the quota ledger row.
 */
async function recordReply(entry: {
  messageId: string;
  userId: string;
  model: string;
  status: Exclude<AiChatMessageStatus, "RUNNING">;
  text: string;
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  cost?: number;
  durationMs: number;
  toolCalls?: { tool: string; arguments: object; result?: unknown; executed?: boolean }[];
}) {
  try {
    await db
      .update(aiChatMessages)
      .set({
        status: entry.status,
        content: entry.text,
        error: entry.error?.slice(0, 2000) ?? null,
        finishedAt: new Date(),
        promptTokens: entry.usage?.inputTokens ?? null,
        completionTokens: entry.usage?.outputTokens ?? null,
        costUsd: entry.cost != null ? entry.cost.toFixed(6) : null,
        durationMs: entry.durationMs,
      })
      .where(eq(aiChatMessages.id, entry.messageId));
    if (entry.toolCalls?.length) {
      await db.insert(aiChatToolCalls).values(
        entry.toolCalls.map((call) => ({
          messageId: entry.messageId,
          tool: call.tool,
          arguments: call.arguments,
          result: call.result === undefined ? null : (JSON.parse(JSON.stringify(call.result)) as unknown),
          status: call.executed === false ? ("PROPOSED" as const) : ("EXECUTED" as const),
        })),
      );
    }
  } catch (error) {
    // Conversation deleted along the way, or database unavailable: the reply is lost, not the service
    logger.warn("ai_chat", `Chat trace not saved: ${error instanceof Error ? error.message : String(error)}`);
  }
  /**
   * The quota ledger, after the message and whatever happened to it: the
   * cost was incurred at the provider. Every outcome counts as soon as a cost
   * was returned, not only a completed reply.
   */
  if (entry.cost == null) return;
  try {
    await db.insert(aiChatQuotaLedger).values({
      userId: entry.userId,
      costUsd: entry.cost.toFixed(6),
      model: entry.model,
      messageId: entry.messageId,
    });
  } catch (error) {
    logger.warn("ai_chat", `Quota ledger row not written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * In-app notification when the reply ends after the user has left. The body
 * only gives the conversation title: the reply itself is read in the
 * chat.
 */
async function notifyReplyEnd(params: {
  userId: string;
  perms: UserPermissions;
  conversationId: string;
  title: string;
  status: "DONE" | "FAILED" | "INTERRUPTED";
  t: ServerTranslator;
}): Promise<void> {
  if (!hasPermission(params.perms, "notifications:view")) return;
  try {
    await createPushNotification({
      userId: params.userId,
      type: "ai_chat_reply",
      // Title translated at display time in the reader's language (titleKey);
      // the body is the conversation title (data).
      title: params.t(notificationTitle(params.status)),
      titleKey: notificationTitle(params.status),
      message: params.title,
      actionUrl: `/assistant?conversation=${params.conversationId}`,
    });
  } catch (error) {
    // A lost notification must not fail a completed reply
    logger.warn("ai_chat", `Reply-end notification not created: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── One conversation turn ───

/**
 * One conversation turn. The returned stream follows the AI SDK protocol: the
 * client displays tokens as they arrive and the approval requests.
 */
export async function respond(params: {
  userId: string;
  perms: UserPermissions;
  canWrite: boolean;
  config: AiChatConfig;
  conversationId: string;
  messages: UIMessage[];
  model?: string;
  reasoning?: AiChatReasoning;
  /**
   * Client presence: raised when the HTTP connection dropped before the end.
   * The reply continues anyway; this signal only decides, at the end, whether
   * to notify the user in the app.
   */
  clientLeft?: AbortSignal;
  /** Page being viewed (floating sphere): only the base set and its tools are declared. */
  page?: string | null;
}) {
  const { config } = params;
  if (!config.apiKey) throw new AppError("aiChat.errors.unavailable");
  // User language, read while the request is still there: the reply goes on without it
  const locale = await resolveRequestLocale();
  const t = await getServerTranslator(locale);

  const conversation = await getUserConversation(params.userId, params.conversationId);
  // Turn scope, written on the reply as on the question (traceability)
  const scope = { projectId: conversation.projectId };

  const model = allowedModel(params.model, config);
  const ctx = await buildContext(params.userId, params.perms, params.canWrite, conversation, locale);
  const { messages, notice } = delimitDocuments(params.messages);
  const { APP_TITLE } = await getConfigValues(["APP_TITLE"]);
  const { tools } = buildChatTools({
    userId: params.userId,
    perms: params.perms,
    canWrite: params.canWrite,
    page: params.page ?? null,
    locale,
  });

  /**
   * The reply row exists from now on, in progress and empty: it is the one
   * the screen finds again when reopening the conversation, the one the limits
   * count, the one we fill along the way and then close.
   */
  const [replyRow] = await db
    .insert(aiChatMessages)
    .values({ conversationId: conversation.id, ...scope, role: "ASSISTANT", content: "", model, status: "RUNNING" })
    .returning({ id: aiChatMessages.id });

  // First turn: the temporary title (the question) is replaced by a real title,
  // requested from the model in the background; the reply does not wait.
  const [previous] = await db
    .select({ n: count() })
    .from(aiChatMessages)
    .where(
      and(
        eq(aiChatMessages.conversationId, conversation.id),
        eq(aiChatMessages.role, "ASSISTANT"),
        ne(aiChatMessages.id, replyRow.id),
      ),
    );
  if ((previous?.n ?? 0) === 0) {
    void generateTitle({
      conversationId: conversation.id,
      userId: params.userId,
      temporaryTitle: conversation.title,
      question: questionText(params.messages),
      model,
      config,
    });
  }

  // Two ways to abort, to tell apart: the « Arrêter » button, and the maximum duration
  const cancellation = new AbortController();
  const timeout = AbortSignal.timeout(config.maxDurationMinutes * 60_000);
  runningReplies.set(conversation.id, cancellation);

  const startedAt = Date.now();
  let content = "";
  let step: ReplyStep = { phase: "thinking" };
  let concluded = false;
  // Partial content is written at most once per second, never on every token
  const writeCadence = new Cadence(1000);
  // And is broadcast at most every 500 ms, as a full snapshot of the text
  const broadcastCadence = new Cadence(500);

  const broadcast = (status: AiChatMessageStatus, extra: { title?: string; error?: string } = {}) =>
    emitToUser(params.userId, "chat:reply", {
      conversationId: conversation.id,
      messageId: replyRow.id,
      status,
      phase: step.phase,
      tool: step.tool,
      content,
      finished: status !== "RUNNING",
      followsNavigation: conversation.followsNavigation,
      ...extra,
    });

  /**
   * Closing, only once: the first of the three callbacks (finish, abort,
   * error) decides the fate of the reply, the next ones have nothing left to say.
   */
  const conclude = async (
    status: Exclude<AiChatMessageStatus, "RUNNING">,
    outcome: {
      text?: string;
      error?: string;
      usage?: { inputTokens?: number; outputTokens?: number };
      cost?: number;
      toolCalls?: { tool: string; arguments: object; result?: unknown; executed?: boolean }[];
    },
  ) => {
    if (concluded) return;
    concluded = true;
    if (runningReplies.get(conversation.id) === cancellation) runningReplies.delete(conversation.id);
    content = outcome.text ?? content;
    await recordReply({
      messageId: replyRow.id,
      userId: params.userId,
      model,
      status,
      text: content,
      error: outcome.error,
      usage: outcome.usage,
      cost: outcome.cost,
      durationMs: Date.now() - startedAt,
      toolCalls: outcome.toolCalls,
    });
    // Re-read at the end: the title may have changed, and the conversation may be gone
    const [conversationRow] = await db
      .select({ title: aiChatConversations.title, deletedAt: aiChatConversations.deletedAt })
      .from(aiChatConversations)
      .where(eq(aiChatConversations.id, conversation.id))
      .limit(1);
    void broadcast(status, { title: conversationRow?.title, error: outcome.error });
    // Left before the end: we tell them in the app. Not for a stop they requested.
    if (conversationRow && !conversationRow.deletedAt && params.clientLeft?.aborted && status !== "CANCELLED") {
      await notifyReplyEnd({
        userId: params.userId,
        perms: params.perms,
        conversationId: conversation.id,
        title: conversationRow.title,
        status,
        t,
      });
    }
  };

  const result = streamText({
    model: openRouter(config.apiKey)(config.nitro ? `${model}:nitro` : model, {
      // Prefix cache: instructions and tools are the same from one turn to the next
      cache_control: { type: "ephemeral" },
      provider: {
        // Excludes providers that retain or use the exchanges
        data_collection: config.dataCollection,
        // Zero retention: only endpoints that keep nothing
        ...(config.zdr ? { zdr: true } : {}),
      },
      // Reasoning effort. « none » turns off reasoning on hybrid models;
      // a model that does not reason simply ignores the setting.
      reasoning: { effort: params.reasoning ?? config.reasoning },
      /**
       * Attached PDF: we force the « native » engine, reading by the model
       * itself. Without this, OpenRouter could fall back on a third-party OCR
       * service, billed per page and seeing the document go through.
       */
      ...(containsPdf(params.messages)
        ? { extraBody: { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] } }
        : {}),
    }),
    // The typography rule follows the prompt, customized or not: it cannot be removed from the admin
    system: [resolveSystemPrompt(config.systemPrompt, APP_TITLE || "Humble Planning"), TYPOGRAPHY_RULE, notice, ctx]
      .filter(Boolean)
      .join("\n\n"),
    messages: await convertToModelMessages(messages),
    tools,
    // The model can chain several tools before concluding
    stopWhen: stepCountIs(8),
    temperature: config.temperature,
    maxOutputTokens: config.maxTokens,
    abortSignal: AbortSignal.any([cancellation.signal, timeout]),
    // Typography safety net on the stream itself: the screen, the partial write
    // and the final onFinish text all see the filtered text.
    experimental_transform: () =>
      new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
        transform(part, controller) {
          controller.enqueue(part.type === "text-delta" ? { ...part, text: withoutDashes(part.text) } : part);
        },
      }),
    onChunk: async ({ chunk }) => {
      // The kept text is the one of the current step, like the one of a
      // finished reply (onFinish `text`): a tool step starts again empty.
      const type = (chunk as { type: string }).type;
      if (type === "start-step") content = "";
      if (type === "text-delta") content += withoutDashes((chunk as { text: string }).text);
      const next = phaseOfChunk(chunk as { type: string; toolName?: string });
      const changed = next !== null && (next.phase !== step.phase || next.tool !== step.tool);
      if (next) step = next;
      const now = Date.now();
      if (changed || broadcastCadence.isDue(now)) void broadcast("RUNNING");
      if (content && writeCadence.isDue(now)) {
        await db
          .update(aiChatMessages)
          .set({ content })
          .where(eq(aiChatMessages.id, replyRow.id))
          .catch(() => undefined);
      }
    },
    onFinish: async ({ text, totalUsage, steps }) => {
      // An abort that happened between two steps also goes through here: onAbort has concluded
      if (cancellation.signal.aborted || timeout.aborted) return;
      // Tool traceability: the calls actually executed in this turn
      const toolSteps = steps as unknown as {
        toolCalls?: { toolCallId: string; toolName: string; input?: unknown }[];
        toolResults?: { toolCallId: string; output?: unknown }[];
      }[];
      const toolCalls = toolSteps.flatMap((toolStep) => {
        const results = new Map((toolStep.toolResults ?? []).map((r) => [r.toolCallId, r.output]));
        // A write suspended awaiting consent has no result: PROPOSED, not EXECUTED
        return (toolStep.toolCalls ?? []).map((call) => ({
          tool: call.toolName,
          arguments: (call.input ?? {}) as object,
          result: results.get(call.toolCallId),
          executed: results.has(call.toolCallId),
        }));
      });
      /**
       * Actual cost of the turn: the sum of its steps. A tool turn counts
       * several provider calls (the original project only read the last
       * step, which undercounted the quota); same for tokens (totalUsage).
       */
      const costs = (steps as unknown as { providerMetadata?: { openrouter?: { usage?: { cost?: number } } } }[])
        .map((costStep) => costStep.providerMetadata?.openrouter?.usage?.cost)
        .filter((cost): cost is number => typeof cost === "number");
      await conclude("DONE", {
        text: withoutDashes(text),
        usage: totalUsage,
        cost: costs.length ? costs.reduce((total, cost) => total + cost, 0) : undefined,
        toolCalls,
      });
    },
    onAbort: async () => {
      const { status, error } = abortOutcome(cancellation.signal.aborted, config.maxDurationMinutes);
      await conclude(status, { error: error ? t(error.code, error.params) : undefined });
    },
    onError: async ({ error }) => {
      // The cause carries the detail (rejected schema, provider response)
      const cause = error instanceof Error && error.cause ? error.cause : null;
      const detail = cause ? ` - ${cause instanceof Error ? cause.message : JSON.stringify(cause)}` : "";
      const message = `${error instanceof Error ? error.message : String(error)}${detail}`;
      logger.error("ai_chat", `Chat failed: ${message}`);
      await conclude("FAILED", { error: explainModelError(message, model, t) });
    },
  });

  /**
   * The stream is consumed here, independently of the client: this is why
   * a dropped connection does not stop generation and why the finish
   * callbacks still run. The HTTP response reads a copy of the same stream.
   */
  void result.consumeStream({
    onError: (error) =>
      logger.warn("ai_chat", `Chat stream interrupted: ${error instanceof Error ? error.message : String(error)}`),
  });

  await db.update(aiChatConversations).set({ model }).where(eq(aiChatConversations.id, conversation.id));
  return result;
}
