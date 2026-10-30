"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useProfile } from "@/hooks/use-profile";

/**
 * Syncs the active next-themes value with the theme stored in the user's
 * profile preferences. Runs once per session (first load after login).
 *
 * Why: next-themes persists its own "theme" localStorage key. After a logout
 * we clear all localStorage, so next-themes falls back to "system" and the
 * user's chosen theme is lost until they re-save it from /profile. This
 * re-hydrates it from the DB-stored preference (`user.preferences.theme`).
 *
 * We skip the sync if the stored theme already matches the active one, and
 * once applied we set a ref so subsequent profile refetches don't override
 * user toggles made later in the same session.
 */
export function UserThemeSync() {
  const { data: profile } = useProfile();
  const { theme, setTheme } = useTheme();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current) return;
    const stored = (profile?.preferences as { theme?: string } | undefined)?.theme;
    if (!stored) return;
    if (stored !== theme) {
      setTheme(stored);
    }
    synced.current = true;
  }, [profile, theme, setTheme]);

  return null;
}
