/**
 * Application logger.
 *
 * - Every message goes to the standard output (`docker logs`); DEBUG only
 *   when `LOG_DEBUG=true` in the environment.
 * - WARN and ERROR are also stored in `system_events` (System health page),
 *   grouped by fingerprint, without ever blocking or failing the caller: the
 *   write is buffered and flushed in the background (system-event-service).
 *   Only inside the Next.js server: scripts and tests stay on stdout.
 *
 * The logger itself holds no state: the write buffer and its flush timer
 * live on `globalThis` (system-event-service), so the several copies of this
 * module that Next bundles (instrumentation, route handlers, server
 * components) share one buffer per process.
 */
import type { LogCategory, LogLevel, StoredLevel } from "@/lib/system-health/categories";

export type { LogCategory, LogLevel };

/** Context of a stored event: the error (for its real stack) and the request, when known. */
export interface LogContext {
  error?: unknown;
  route?: string | null;
  method?: string | null;
  userId?: string | null;
}

type Meta = Record<string, unknown>;

function persistEnabled(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs";
}

/** Stack of the error when there is one, otherwise of the code that called the logger (3 frames). */
function stackOf(context: LogContext | undefined, meta: Meta | undefined): string | undefined {
  const error = context?.error ?? meta?.error;
  if (error instanceof Error && error.stack) return error.stack;
  // Skipped: the "Error" line, stackOf, Logger.store, Logger.error / warn
  return new Error().stack?.split("\n").slice(4, 7).join("\n");
}

class Logger {
  private store(level: StoredLevel, category: LogCategory, message: string, meta?: Meta, context?: LogContext) {
    if (!persistEnabled()) return;
    const event = {
      level,
      category,
      message,
      metadata: meta ?? null,
      stack: level === "ERROR" || context?.error ? stackOf(context, meta) ?? null : null,
      route: context?.route ?? null,
      method: context?.method ?? null,
      userId: context?.userId ?? null,
    };
    import("@/lib/services/system-event-service")
      .then(({ queueSystemEvent }) => queueSystemEvent(event))
      .catch(() => {});
  }

  error(category: LogCategory, message: string, meta?: Meta, context?: LogContext) {
    console.error(`[${category.toUpperCase()}] ${message}`, meta ?? "");
    this.store("ERROR", category, message, meta, context);
  }

  warn(category: LogCategory, message: string, meta?: Meta, context?: LogContext) {
    console.warn(`[${category.toUpperCase()}] ${message}`, meta ?? "");
    this.store("WARN", category, message, meta, context);
  }

  info(category: LogCategory, message: string, meta?: Meta) {
    console.info(`[${category.toUpperCase()}] ${message}`, meta ?? "");
  }

  debug(category: LogCategory, message: string, meta?: Meta) {
    if (process.env.LOG_DEBUG === "true") console.debug(`[${category.toUpperCase()}] ${message}`, meta ?? "");
  }
}

export const logger = new Logger();
