/**
 * Pure logic for tracking an assistant reply, isolated so it can be tested
 * without model or database: which phase a stream chunk announces, at what
 * pace we write and broadcast, how an abort is named, and what we tell the
 * user when we reject one more question.
 *
 * User-facing texts are returned as keys of the `aiChat` catalog (with
 * parameters): the caller translates them into the user's
 * language.
 */
import { AppError } from "@/lib/errors";

/**
 * Typography safety net: em dashes (U+2014) and en dashes (U+2013) become a
 * hyphen. The instruction asks the model to rephrase; this filter only
 * handles what it lets through, chunk by chunk (a character is never split
 * between two stream chunks), and leaves spaces as the model put
 * them.
 */
export const withoutDashes = (text: string): string => text.replace(/[–—]/g, "-");

/** What the assistant is currently doing, as the screen announces it. */
export type ReplyPhase = "thinking" | "tools" | "writing";

/** Progress announced by the stream: the phase, and the tool consulted if any. */
export interface ReplyStep {
  phase: ReplyPhase;
  tool?: string;
}

/**
 * Phase announced by a stream chunk, or null when it does not change it
 * (step end, metadata, tool result). A tool result does not hand control
 * back to writing: the model may chain another call, and the next chunk
 * will tell.
 */
export function phaseOfChunk(chunk: { type: string; toolName?: string }): ReplyStep | null {
  switch (chunk.type) {
    case "reasoning-start":
    case "reasoning-delta":
      return { phase: "thinking" };
    case "tool-input-start":
    case "tool-call":
      return chunk.toolName ? { phase: "tools", tool: chunk.toolName } : { phase: "tools" };
    case "text-start":
    case "text-delta":
      return { phase: "writing" };
    default:
      return null;
  }
}

/**
 * Pacing: "is it time?". The stream delivers dozens of chunks per second;
 * writing to the database or broadcasting on each one would be absurd. The
 * first tick is immediate, the next ones wait for the interval.
 */
export class Cadence {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs: number) {}

  isDue(now: number): boolean {
    if (now - this.last < this.intervalMs) return false;
    this.last = now;
    return true;
  }
}

/**
 * Cause of a stream abort. Cancelled means the user's action (« Arrêter »
 * button): nothing to explain. Interrupted means the maximum duration: we
 * say so, otherwise the reply seems to have stopped on its own.
 */
export function abortOutcome(
  cancelled: boolean,
  maxDurationMinutes: number,
): { status: "CANCELLED" | "INTERRUPTED"; error?: { code: "aiChat.replyErrors.maxDuration"; params: { minutes: number } } } {
  if (cancelled) return { status: "CANCELLED" };
  return {
    status: "INTERRUPTED",
    error: { code: "aiChat.replyErrors.maxDuration", params: { minutes: maxDurationMinutes } },
  };
}

/** Rejection of one more question: the user has reached their number of replies in progress (409). */
export function tooManyRepliesError(running: number): AppError {
  return new AppError("aiChat.errors.tooManyReplies", { status: 409, params: { count: running } });
}

/** In-app notification title (key), depending on how the reply ended. */
export type NotificationTitleKey =
  "aiChat.notifications.replyDone" | "aiChat.notifications.replyFailed" | "aiChat.notifications.replyInterrupted";

export function notificationTitle(status: "DONE" | "FAILED" | "INTERRUPTED"): NotificationTitleKey {
  if (status === "DONE") return "aiChat.notifications.replyDone";
  if (status === "FAILED") return "aiChat.notifications.replyFailed";
  return "aiChat.notifications.replyInterrupted";
}

/**
 * The title as the model returns it, reduced to a clean line: no quotes,
 * no trailing period, no em dash, 80 characters at most.
 */
export function cleanTitle(raw: string): string {
  const line =
    raw
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line
    // i18n-ignore regular expression (quotes to strip)
    .replace(/^[«"'`\s]+|[»"'`\s.]+$/g, "")
    .replace(/[–—]/g, "-")
    .trim()
    .slice(0, 80);
}
