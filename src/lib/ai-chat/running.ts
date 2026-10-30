/**
 * Replies in progress in this process, per conversation: this is what the
 * « Arrêter » button aborts. The map lives on `globalThis`: Next.js may
 * instantiate one module per route bundle, and the `stop` route must see the
 * controller created by the `messages` route. The authoritative status
 * (screen, limits) stays in the database; as in the original project, this
 * assumes a single server process.
 */
const globalForRunning = globalThis as unknown as {
  __aiChatRunning?: Map<string, AbortController>;
};

export const runningReplies: Map<string, AbortController> =
  (globalForRunning.__aiChatRunning ??= new Map<string, AbortController>());
