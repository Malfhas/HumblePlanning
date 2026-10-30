"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { useProfile } from "@/hooks/use-profile";

/**
 * Keeps `users.locale` (last effective language, used for emails and
 * notifications) up to date when the language changes without the picker:
 * "Automatic" mode and a change of `APP_LOCALE` by the admin, or of the
 * browser language. One call per session, and only if the value stored
 * in the database differs from the displayed language.
 */
export function LocaleSync() {
  const { data: profile } = useProfile();
  const locale = useLocale();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current || !profile) return;
    synced.current = true;
    if ((profile as { locale?: string | null }).locale === locale) return;
    // No body: leaves the cookie alone, only updates users.locale.
    fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  }, [profile, locale]);

  return null;
}
