/**
 * Real-time events addressed to a user (all their connections), through the
 * internal `/emit` endpoint of the Socket.io server. The server broadcasts in
 * the `user:<id>` room: a background tab therefore receives the end of a
 * reply even after the presence purge.
 */
const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:3001";
const SOCKET_SECRET = process.env.SOCKET_SECRET || "humbleplanning-internal";

function post(body: Record<string, unknown>) {
  return fetch(`${SOCKET_URL}/emit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SOCKET_SECRET}` },
    body: JSON.stringify(body),
  }).catch(() => {
    // Silent: the real-time server may be absent (build, tests)
  });
}

export function emitToUser(userId: string, channel: string, payload: Record<string, unknown>) {
  return post({ ...payload, channel, targetUserId: userId });
}

/** Chat availability changed (admin settings): each client re-reads its own. */
export function emitAiChatAvailabilityChanged() {
  return post({ channel: "ai-chat:availability" });
}
