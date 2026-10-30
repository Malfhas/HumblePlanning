"use client";

import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { hasDyn, tDyn } from "./dynamic";

export interface TranslatableNotification {
  title: string;
  message: string;
  titleKey?: string | null;
  messageKey?: string | null;
  params?: Record<string, string | number> | null;
}

/** ISO date parameters (`date`, `*Date`) → formatted with the PLANNING_DATE_FORMAT setting. */
const DATE_PARAM_RE = /(^date$|Date$)/;

/**
 * Text of an in-app notification in the language of whoever READS it (bell,
 * home). The key (`notifications.task.assigned`…) and its raw parameters
 * come from the DB; `title` / `message` (text frozen at creation) serve
 * as a fallback for old rows and unknown keys.
 *
 *   const notificationText = useNotificationText();
 *   const { title, message } = notificationText(notif);
 */
export function useNotificationText() {
  const t = useTranslations();
  const { formatDate } = useDateFormat();
  return (n: TranslatableNotification) => {
    const params = Object.fromEntries(
      Object.entries(n.params ?? {}).map(([k, v]) => [k, DATE_PARAM_RE.test(k) && typeof v === "string" ? formatDate(v) : v]),
    );
    return {
      title: n.titleKey && hasDyn(t, n.titleKey) ? tDyn(t, n.titleKey, params) : n.title,
      message: n.messageKey && hasDyn(t, n.messageKey) ? tDyn(t, n.messageKey, params) : n.message,
    };
  };
}
