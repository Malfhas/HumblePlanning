"use client";

import { useTranslations } from "next-intl";
import { hasDyn, tDyn } from "@/i18n/dynamic";
import { useDateFormat } from "@/hooks/use-date-format";
import { ACTION_STYLES, type AuditLogEntry, type LookupMaps } from "@/lib/constants/audit-labels";

// i18n-dynamic: audit.actions.*
// i18n-dynamic: audit.entities.*
// i18n-dynamic: audit.fields.*
// i18n-dynamic: audit.projectStatus.*
// i18n-dynamic: audit.passwordMethods.*

/** Date (ISO "yyyy-MM-dd") and time ("HH:mm[:ss]") fields, formatted according to the settings. */
const DATE_FIELDS = new Set(["startDate", "endDate", "deliveryDate"]);
const TIME_FIELDS = new Set(["startTime", "endTime"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * Audit labels in the current language (`audit` catalog). The badge CSS classes
 * stay in `ACTION_STYLES` (`src/lib/constants/audit-labels.ts`).
 *
 *   const audit = useAuditLabels();
 *   audit.actionLabel(log.action); audit.formatChanges(log, maps);
 */
export function useAuditLabels() {
  const t = useTranslations("audit");
  const tc = useTranslations("common");
  const { formatDate, formatTime } = useDateFormat();

  const lookup = (prefix: string, id: string, fallback: string) => {
    const key = `${prefix}.${id}`;
    return hasDyn(t, key) ? tDyn(t, key) : fallback;
  };

  const actionLabel = (action: string) => lookup("actions", action, action);
  const actionClassName = (action: string) => ACTION_STYLES[action] ?? "";
  const entityLabel = (entityType: string) => lookup("entities", entityType, entityType);
  const fieldLabel = (field: string) => lookup("fields", field, field);

  function resolveValue(field: string, v: unknown, maps: LookupMaps): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? tc("boolean.yes") : tc("boolean.no");
    if (field === "status" && typeof v === "string") return lookup("projectStatus", v, v);
    if (DATE_FIELDS.has(field) && typeof v === "string" && ISO_DATE_RE.test(v)) return formatDate(v);
    if (TIME_FIELDS.has(field) && typeof v === "string" && TIME_RE.test(v)) return formatTime(v);
    if (field === "projectId" && typeof v === "string") return maps.projectMap.get(v) ?? v.slice(0, 8);
    if (field === "statusId" && typeof v === "string") return maps.statusMap.get(v) ?? v.slice(0, 8);
    if (field === "placeId" && typeof v === "string") return maps.placeMap.get(v) ?? v.slice(0, 8);
    if (field === "resourceId" && typeof v === "string") return maps.resourceMap.get(v) ?? v.slice(0, 8);
    if (field === "parentId" && typeof v === "string") return v.slice(0, 8);
    if ((field === "ownerId" || field === "creatorId" || field === "lastModifierId") && typeof v === "string")
      return maps.userMap.get(v) ?? v.slice(0, 8);
    if (field === "userIds" && Array.isArray(v)) {
      if (v.length === 0) return "—";
      return v.map((id) => maps.userMap.get(String(id)) ?? String(id).slice(0, 8)).join(", ");
    }
    return String(v);
  }

  function getEntityName(log: AuditLogEntry, maps?: LookupMaps): string {
    const old = log.oldValues as Record<string, unknown> | null;
    const nw = log.newValues as Record<string, unknown> | null;
    const meta = log.metadata as Record<string, unknown> | null;

    if (log.action === "login" || log.action === "login_fail" || log.action === "bruteforce_lock") {
      const identifier = (meta?.identifier || meta?.email || meta?.targetUser) as string | undefined;
      if (identifier) return identifier;
      if (log.entityId && maps?.userMap?.get(log.entityId)) return maps.userMap.get(log.entityId)!;
    }

    if (log.entityType === "config" && log.action === "config_change") {
      const keys = meta?.changedKeys;
      if (Array.isArray(keys) && keys.length > 0) return keys.length <= 2 ? keys.join(", ") : t("changes.settingsCount", { count: keys.length });
      return t("changes.settings");
    }

    return (
      (old?.title as string) || (nw?.title as string) || (old?.name as string) || (nw?.name as string) || (meta?.title as string)
      || (meta?.name as string) || (meta?.targetUser as string)
      || (log.entityId && maps?.entityNameMap[log.entityId])
      || "—"
    ) as string;
  }

  function formatChanges(log: AuditLogEntry, maps: LookupMaps): string {
    const meta = log.metadata as Record<string, unknown> | null;
    const metaStr = (k: string) => (typeof meta?.[k] === "string" ? (meta[k] as string) : undefined);

    if (log.action === "login" || log.action === "login_fail") {
      const id = metaStr("identifier") || metaStr("email");
      const ip = metaStr("ip");
      const parts: string[] = [];
      if (id) parts.push(id);
      if (ip) parts.push(t("changes.ip", { ip }));
      const reason = metaStr("reason");
      if (reason) parts.push(reason === "account_inactive" ? t("changes.accountDisabled") : reason);
      return parts.join(" — ") || t("changes.login");
    }
    if (log.action === "email_sent") {
      return t("changes.recipients", { count: Number(meta?.recipientCount ?? 0) });
    }
    if (log.action === "file_upload") {
      const nw = log.newValues as Record<string, unknown> | null;
      return nw?.fileName ? t("changes.fileAddedNamed", { name: String(nw.fileName) }) : t("changes.fileAdded");
    }
    if (log.action === "file_delete") {
      const old = log.oldValues as Record<string, unknown> | null;
      return old?.fileName ? t("changes.fileDeletedNamed", { name: String(old.fileName) }) : t("changes.fileDeleted");
    }
    if (log.action === "password_change") {
      const targetLogin = metaStr("targetLogin") ?? "";
      const targetUser = metaStr("targetUser") ?? "";
      const method = metaStr("method") ?? "";
      const methodLabel = method ? lookup("passwordMethods", method, method) : "";
      const userLabel = targetLogin ? `${targetUser} (${targetLogin})` : targetUser;
      return userLabel ? `${userLabel} — ${methodLabel}` : methodLabel;
    }
    if (log.action === "config_change") {
      if (log.oldValues && log.newValues) {
        const keys = Object.keys(log.newValues as Record<string, unknown>);
        if (keys.length === 0) return t("changes.configChanged");
        if (keys.length <= 3) return keys.join(", ");
        return t("changes.settingsChanged", { count: keys.length });
      }
      const keys = meta?.changedKeys;
      if (Array.isArray(keys) && keys.length > 0) return t("changes.settingsChanged", { count: keys.length });
      return t("changes.configChanged");
    }
    if (log.action === "archive") {
      return meta?.archived === false ? t("changes.itemReactivated") : t("changes.itemArchived");
    }
    if (log.action === "api_key_create" || log.action === "mcp_key_create") {
      const name = metaStr("name");
      return name ? t("changes.keyNamed", { name }) : t("changes.keyCreated");
    }
    if (log.action === "api_key_delete" || log.action === "mcp_key_delete") {
      const name = metaStr("name");
      return name ? t("changes.keyNamed", { name }) : t("changes.keyDeleted");
    }
    if (log.action === "2fa_enable") return t("changes.twoFactorEnabled");
    if (log.action === "2fa_disable") return t("changes.twoFactorDisabled");
    if (log.action === "2fa_fail") return metaStr("reason") || t("changes.twoFactorFailed");
    if (log.action === "bruteforce_lock") {
      return t("changes.lockedAfter", { attempts: String(meta?.attempts ?? "?") });
    }
    if (log.action === "session_revoke") {
      const name = metaStr("targetUser");
      return name ? t("changes.sessionsRevokedFor", { name }) : t("changes.sessionsRevoked");
    }
    if (log.action === "create") return t("changes.itemCreated");
    if (log.action === "delete") return t("changes.itemDeleted");
    if (log.action === "copy") return t("changes.copyCreated");
    if (log.action === "restore") return t("changes.stateRestored");
    if (log.action === "purge" && typeof meta?.count === "number") return t("changes.purged", { count: meta.count });
    if (!log.oldValues || !log.newValues) return "";
    const oldV = log.oldValues as Record<string, unknown>;
    const newV = log.newValues as Record<string, unknown>;
    return Object.keys(newV)
      .map((k) => `${fieldLabel(k)}: ${resolveValue(k, oldV[k], maps)} → ${resolveValue(k, newV[k], maps)}`)
      .join(", ");
  }

  return { actionLabel, actionClassName, entityLabel, fieldLabel, resolveValue, getEntityName, formatChanges };
}
