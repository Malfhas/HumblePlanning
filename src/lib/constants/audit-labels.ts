// Audit constants and helpers, with no displayed text (labels: `useAuditLabels`).

/**
 * Known audit actions (in the Audit page filter order) and their badge.
 * Labels: `audit.actions.*` catalog (`useAuditLabels().actionLabel`).
 */
export const ACTION_STYLES: Record<string, string> = {
  create: "bg-green-500/15 text-green-700 dark:text-green-400",
  update: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  delete: "bg-red-500/15 text-red-700 dark:text-red-400",
  move: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  resize: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  copy: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  login: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
  login_fail: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  restore: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  purge: "bg-red-500/15 text-red-700 dark:text-red-400",
  file_upload: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  file_delete: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  email_sent: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  password_change: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  config_change: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  update_triggered: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  migrate: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  archive: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  api_key_create: "bg-green-500/15 text-green-700 dark:text-green-400",
  api_key_delete: "bg-red-500/15 text-red-700 dark:text-red-400",
  mcp_key_create: "bg-green-500/15 text-green-700 dark:text-green-400",
  mcp_key_delete: "bg-red-500/15 text-red-700 dark:text-red-400",
  "2fa_enable": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "2fa_disable": "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  "2fa_fail": "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  bruteforce_lock: "bg-red-500/15 text-red-700 dark:text-red-400",
  session_revoke: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  email_blocked: "bg-red-500/15 text-red-700 dark:text-red-400",
  email_unblocked: "bg-green-500/15 text-green-700 dark:text-green-400",
  webhook_received: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
};

export type LookupMaps = {
  projectMap: Map<string, string>;
  userMap: Map<string, string>;
  statusMap: Map<string, string>;
  placeMap: Map<string, string>;
  resourceMap: Map<string, string>;
  entityNameMap: Record<string, string>;
};

export type AuditLogEntry = {
  id: string;
  timestamp: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  changeCount: number | null;
  user: { id: string; name: string | null } | null;
};

// Logical display order matching the task form layout
export const FIELD_ORDER: string[] = [
  "title", "projectId", "userIds", "statusId",
  "startDate", "endDate", "startTime", "endTime",
  "duration", "durationDetails", "breakDuration",
  "placeId", "resourceId",
  "isMilestone", "notes", "link", "customField", "parentId",
  // project fields
  "name", "color", "status", "groupId", "ownerId", "description",
  "deliveryDate", "iteration", "budgetAmount", "budgetTime",
  // user fields
  "email", "teamId", "active", "rights",
];

export function sortFieldsByOrder(fields: string[]): string[] {
  return [...fields].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    // Unknown fields go to the end
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

export function getProjectId(log: AuditLogEntry): string | null {
  if (log.entityType !== "task") return null;
  const old = log.oldValues as Record<string, unknown> | null;
  const nw = log.newValues as Record<string, unknown> | null;
  const meta = log.metadata as Record<string, unknown> | null;
  return (old?.projectId ?? nw?.projectId ?? meta?.projectId ?? null) as string | null;
}

export function getUserIds(log: AuditLogEntry): string[] {
  if (log.entityType !== "task") return [];
  const old = log.oldValues as Record<string, unknown> | null;
  const nw = log.newValues as Record<string, unknown> | null;
  const meta = log.metadata as Record<string, unknown> | null;
  const ids = old?.userIds ?? nw?.userIds ?? meta?.userIds;
  if (Array.isArray(ids)) return ids as string[];
  return [];
}
