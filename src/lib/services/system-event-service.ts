/**
 * System events (System health page): warnings and errors of the logger,
 * grouped by fingerprint (level + category + normalized message).
 *
 * The logger never waits for the database: events are coalesced in memory
 * (one entry per fingerprint, with a counter) and flushed a second later, one
 * upsert per fingerprint. The buffer lives on `globalThis` so the copies of
 * this module bundled by Next share it. A failed write is reported on stderr
 * only (never through the logger, which would loop) and the batch dropped.
 */
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { systemEvents, users } from "@/db/schema";
import { eventFingerprint, redactQueryParams } from "@/lib/system-health/fingerprint";
import type { StoredLevel } from "@/lib/system-health/categories";

export interface NewSystemEvent {
  level: StoredLevel;
  category: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  stack?: string | null;
  route?: string | null;
  method?: string | null;
  userId?: string | null;
}

interface PendingEvent extends NewSystemEvent {
  fingerprint: string;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const FLUSH_DELAY_MS = 1000;
/** Distinct incidents waiting for the next flush; beyond, new ones are dropped. */
const MAX_PENDING = 200;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 8000;
const MAX_METADATA_LENGTH = 8000;

type Store = { pending: Map<string, PendingEvent>; timer: ReturnType<typeof setTimeout> | null };
const globalStore = globalThis as unknown as { __hpSystemEvents?: Store };
const store: Store = (globalStore.__hpSystemEvents ??= { pending: new Map(), timer: null });

/** Metadata as storable JSON: errors become { name, message }, query values are redacted, the size is bounded. */
function toJsonSafe(metadata: Record<string, unknown> | null | undefined): unknown {
  if (!metadata) return null;
  try {
    const json = JSON.stringify(metadata, (_key, value) => {
      if (value instanceof Error) return { name: value.name, message: redactQueryParams(value.message) };
      if (typeof value === "string") return redactQueryParams(value);
      if (typeof value === "bigint") return value.toString();
      return value;
    });
    if (!json) return null;
    return json.length > MAX_METADATA_LENGTH ? { truncated: json.slice(0, MAX_METADATA_LENGTH) } : JSON.parse(json);
  } catch {
    return { unserializable: true };
  }
}

/** Buffers an event for the next flush. Never throws, never waits. */
export function queueSystemEvent(input: NewSystemEvent): void {
  const now = new Date();
  const event = { ...input, message: redactQueryParams(input.message), stack: input.stack ? redactQueryParams(input.stack) : input.stack };
  const fingerprint = eventFingerprint(event.level, event.category, event.message);
  const existing = store.pending.get(fingerprint);
  if (existing) {
    // The row keeps the details of the last occurrence
    Object.assign(existing, event, { count: existing.count + 1, lastSeenAt: now });
  } else {
    if (store.pending.size >= MAX_PENDING) return;
    store.pending.set(fingerprint, { ...event, fingerprint, count: 1, firstSeenAt: now, lastSeenAt: now });
  }
  if (!store.timer) {
    store.timer = setTimeout(() => {
      store.timer = null;
      void flushSystemEvents();
    }, FLUSH_DELAY_MS);
    store.timer.unref?.();
  }
}

/** Writes the buffered events (one upsert per fingerprint). Exported for scripts and tests. */
export async function flushSystemEvents(): Promise<void> {
  const batch = [...store.pending.values()];
  store.pending.clear();
  for (const [index, event] of batch.entries()) {
    const values = {
      level: event.level,
      category: event.category.slice(0, 30),
      message: event.message.slice(0, MAX_MESSAGE_LENGTH),
      metadata: toJsonSafe(event.metadata),
      stack: event.stack?.slice(0, MAX_STACK_LENGTH) ?? null,
      route: event.route?.slice(0, 500) ?? null,
      method: event.method?.slice(0, 10) ?? null,
      userId: event.userId ?? null,
    };
    try {
      await db
        .insert(systemEvents)
        .values({ ...values, fingerprint: event.fingerprint, occurrences: event.count, firstSeenAt: event.firstSeenAt, lastSeenAt: event.lastSeenAt })
        .onConflictDoUpdate({
          target: systemEvents.fingerprint,
          set: { ...values, occurrences: sql`${systemEvents.occurrences} + ${event.count}`, lastSeenAt: event.lastSeenAt },
        });
    } catch (err) {
      console.error(
        `[SYSTEM] System events not saved (${batch.length - index} dropped):`,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// Reading and purge (System health page)
// ════════════════════════════════════════════════════════════════════════

export interface SystemEventFilters {
  levels?: StoredLevel[];
  categories?: string[];
  since?: Date | null;
  search?: string;
  page: number;
  limit: number;
}

function eventConditions(filters: Omit<SystemEventFilters, "page" | "limit">): SQL | undefined {
  const search = filters.search?.trim();
  return and(
    filters.levels?.length ? inArray(systemEvents.level, filters.levels) : undefined,
    filters.categories?.length ? inArray(systemEvents.category, filters.categories) : undefined,
    filters.since ? gte(systemEvents.lastSeenAt, filters.since) : undefined,
    search
      ? or(
          ilike(systemEvents.message, `%${search}%`),
          ilike(systemEvents.route, `%${search}%`),
          sql`${systemEvents.metadata}::text ilike ${`%${search}%`}`,
        )
      : undefined,
  );
}

export async function listSystemEvents(filters: SystemEventFilters) {
  const where = eventConditions(filters);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: systemEvents.id,
        level: systemEvents.level,
        category: systemEvents.category,
        message: systemEvents.message,
        metadata: systemEvents.metadata,
        stack: systemEvents.stack,
        route: systemEvents.route,
        method: systemEvents.method,
        occurrences: systemEvents.occurrences,
        firstSeenAt: systemEvents.firstSeenAt,
        lastSeenAt: systemEvents.lastSeenAt,
        userId: systemEvents.userId,
        userFirstName: users.firstName,
        userName: users.name,
      })
      .from(systemEvents)
      .leftJoin(users, eq(users.id, systemEvents.userId))
      .where(where)
      .orderBy(desc(systemEvents.lastSeenAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit),
    db.select({ total: count() }).from(systemEvents).where(where),
  ]);
  return {
    data: rows.map(({ userFirstName, userName, ...row }) => ({
      ...row,
      userName: row.userId ? [userFirstName, userName].filter(Boolean).join(" ") : null,
    })),
    total,
    page: filters.page,
    limit: filters.limit,
  };
}

/** Groups whose last occurrence is older than `before`. */
export async function countSystemEventsBefore(before: Date): Promise<number> {
  const [{ total }] = await db.select({ total: count() }).from(systemEvents).where(lt(systemEvents.lastSeenAt, before));
  return total;
}

export async function purgeSystemEventsBefore(before: Date): Promise<number> {
  const deleted = await db.delete(systemEvents).where(lt(systemEvents.lastSeenAt, before)).returning({ id: systemEvents.id });
  return deleted.length;
}
