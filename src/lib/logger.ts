// Centralized in-memory logger with ring buffer
// Lightweight replacement for console.error/log across the app
// Respects config: LOGS_ENABLED, LOGS_LEVEL, LOGS_MAX_ENTRIES

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";
export type LogCategory = "system" | "auth" | "api" | "socket" | "db" | "email" | "push" | "sms" | "mcp" | "backup" | "import" | "migration" | "ai_chat";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  metadata?: Record<string, unknown>;
  stack?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

// Settings loaded from DB on first use, refreshed periodically
let configEnabled = true;
let configMinLevel: LogLevel = "INFO";
let configMaxEntries = 500;
let configLoaded = false;
let configLoadedAt = 0;
const CONFIG_RELOAD_INTERVAL = 60_000; // reload config every 60s

async function loadConfig() {
  try {
    // Dynamic import to avoid circular dependencies at module load
    const { getConfigValues } = await import("@/lib/services/config-service");
    const cfg = await getConfigValues(["LOGS_ENABLED", "LOGS_LEVEL", "LOGS_MAX_ENTRIES"]);
    configEnabled = cfg.LOGS_ENABLED !== "false"; // default true
    configMinLevel = (cfg.LOGS_LEVEL as LogLevel) || "INFO";
    configMaxEntries = parseInt(cfg.LOGS_MAX_ENTRIES ?? "500") || 500;
    configLoaded = true;
    configLoadedAt = Date.now();
  } catch {
    // Config service not ready yet (startup) — keep defaults
  }
}

function shouldReloadConfig(): boolean {
  if (!configLoaded) return true;
  return Date.now() - configLoadedAt > CONFIG_RELOAD_INTERVAL;
}

class Logger {
  private buffer: LogEntry[] = [];

  private add(level: LogLevel, category: LogCategory, message: string, meta?: Record<string, unknown>, stack?: string) {
    // Check config asynchronously (non-blocking)
    if (shouldReloadConfig()) {
      loadConfig().catch(() => {});
    }

    if (!configEnabled) return;
    if (LOG_LEVELS[level] > LOG_LEVELS[configMinLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      ...(meta && { metadata: meta }),
      ...(stack && { stack }),
    };
    this.buffer.push(entry);
    if (this.buffer.length > configMaxEntries) {
      this.buffer = this.buffer.slice(-configMaxEntries);
    }
  }

  error(category: LogCategory, message: string, meta?: Record<string, unknown>) {
    const stack = new Error().stack?.split("\n").slice(2, 5).join("\n");
    this.add("ERROR", category, message, meta, stack);
    console.error(`[${category.toUpperCase()}] ${message}`, meta ?? "");
  }

  warn(category: LogCategory, message: string, meta?: Record<string, unknown>) {
    this.add("WARN", category, message, meta);
    console.warn(`[${category.toUpperCase()}] ${message}`, meta ?? "");
  }

  info(category: LogCategory, message: string, meta?: Record<string, unknown>) {
    this.add("INFO", category, message, meta);
  }

  debug(category: LogCategory, message: string, meta?: Record<string, unknown>) {
    this.add("DEBUG", category, message, meta);
  }

  getEntries(filters?: { level?: LogLevel; category?: LogCategory; search?: string; limit?: number }): LogEntry[] {
    let result = [...this.buffer];

    if (filters?.level) {
      const minLevel = LOG_LEVELS[filters.level];
      result = result.filter((e) => LOG_LEVELS[e.level] <= minLevel);
    }
    if (filters?.category) {
      result = result.filter((e) => e.category === filters.category);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.metadata && JSON.stringify(e.metadata).toLowerCase().includes(q))
      );
    }

    // Newest first
    result.reverse();

    if (filters?.limit && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  clear() {
    this.buffer = [];
  }

  /** Force reload config from DB (call after settings change) */
  reloadConfig() {
    loadConfig().catch(() => {});
  }

  get size() {
    return this.buffer.length;
  }

  get enabled() {
    return configEnabled;
  }
}

export const logger = new Logger();
