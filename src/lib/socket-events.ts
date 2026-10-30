type TaskAction = "created" | "updated" | "deleted" | "moved" | "resized" | "copied" | "bulk-updated" | "bulk-deleted";

interface TaskEvent {
  action: TaskAction;
  taskId?: string;
  taskIds?: string[];
  userId?: string;
}

const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:3001";
const SOCKET_SECRET = process.env.SOCKET_SECRET || "humbleplanning-internal";

export function emitTaskEvent(event: TaskEvent) {
  // POST to the standalone Socket.io server — returns promise so callers can await if needed
  return fetch(`${SOCKET_URL}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SOCKET_SECRET}`,
    },
    body: JSON.stringify(event),
  }).catch(() => {
    // Silent: socket server may not be running (e.g. during build or tests)
  });
}

export function emitSessionRevoked(targetUserId: string) {
  fetch(`${SOCKET_URL}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SOCKET_SECRET}`,
    },
    body: JSON.stringify({ channel: "session:revoked", targetUserId }),
  }).catch(() => {});
}

/**
 * Notifies one or more users that their effective permissions have
 * changed (role edit, roleId/teamId/buId change, archiving).
 * The client must then invalidate its `auth-permissions` and `users` queries
 * to refresh the UI without F5. The server cache was already purged by the caller
 * (see invalidatePermissionsCache).
 */
export function emitPermissionsChanged(targetUserIds: string[]) {
  if (targetUserIds.length === 0) return;
  fetch(`${SOCKET_URL}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SOCKET_SECRET}`,
    },
    body: JSON.stringify({ channel: "permissions:changed", targetUserIds }),
  }).catch(() => {});
}

export function emitPushNotification(targetUserId: string, notification: unknown) {
  fetch(`${SOCKET_URL}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SOCKET_SECRET}`,
    },
    body: JSON.stringify({ channel: "notification:new", targetUserId, notification }),
  }).catch(() => {});
}

export function emitAuditEvent() {
  fetch(`${SOCKET_URL}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SOCKET_SECRET}`,
    },
    body: JSON.stringify({ channel: "audit:changed" }),
  }).catch(() => {});
}
