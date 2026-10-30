"use client";

import { useTranslations } from "next-intl";
import { hasDyn, tDyn } from "@/i18n/dynamic";

/**
 * Message of an API error in the current language.
 *
 * By default, `err.message` is ALREADY translated by the server (language of the
 * request): displaying it is enough. This hook is for re-translating from the
 * stable code (`ApiClientError.code` + `params`), e.g. for an error cached
 * before a language change, or for a code produced on the client.
 *
 *   const errorMessage = useApiErrorMessage();
 *   toast.error(errorMessage(err));
 */
export function useApiErrorMessage() {
  const t = useTranslations();
  return (error: unknown, fallbackKey = "errors.unknown"): string => {
    if (error && typeof error === "object") {
      const e = error as { code?: unknown; params?: Record<string, string | number>; message?: unknown };
      if (typeof e.code === "string" && hasDyn(t, e.code)) return tDyn(t, e.code, e.params);
      if (typeof e.message === "string" && e.message) return e.message;
    }
    if (typeof error === "string" && error) return error;
    return tDyn(t, fallbackKey);
  };
}
