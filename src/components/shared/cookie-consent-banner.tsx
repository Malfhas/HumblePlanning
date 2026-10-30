"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { escapeHtml } from "@/lib/utils/html";

export function CookieConsentBanner() {
  const t = useTranslations("public.cookies");
  const tPrivacy = useTranslations("public.privacy");
  const tA11y = useTranslations("common.a11y");
  const locale = useLocale();
  const [config, setConfig] = useState<Record<string, string | null> | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!config || config.COOKIE_BANNER_ENABLED !== "true") return;
    if (initializedRef.current) return;
    initializedRef.current = true;

    import("vanilla-cookieconsent").then((CookieConsent) => {
      // Sync dark mode
      if (document.documentElement.classList.contains("dark")) {
        document.documentElement.classList.add("cc--darkmode");
      }
      const observer = new MutationObserver(() => {
        document.documentElement.classList.toggle(
          "cc--darkmode",
          document.documentElement.classList.contains("dark")
        );
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

      const categories: Record<string, any> = {
        necessary: { enabled: true, readOnly: true },
      };

      // Titles and descriptions entered by the admin: single-language (translated fallback).
      const consentTitle = config.COOKIE_BANNER_TITLE || t("consent.title");
      const consentDescription = config.COOKIE_BANNER_DESCRIPTION || t("consent.description");

      const sections: any[] = [
        {
          title: consentTitle,
          description: consentDescription,
        },
        {
          title: t("necessary.title"),
          description: t("necessary.description"),
          linkedCategory: "necessary",
        },
      ];

      if (config.COOKIE_ANALYTICS_ENABLED === "true") {
        categories.analytics = {};
        sections.push({
          title: config.COOKIE_ANALYTICS_LABEL || t("analytics.title"),
          description: t("analytics.description"),
          linkedCategory: "analytics",
        });
      }

      if (config.COOKIE_FUNCTIONAL_ENABLED === "true") {
        categories.functional = {};
        sections.push({
          title: config.COOKIE_FUNCTIONAL_LABEL || t("functional.title"),
          description: t("functional.description"),
          linkedCategory: "functional",
        });
      }

      const privacyLink = config.PRIVACY_POLICY_ENABLED === "true"
        ? `<a href="/privacy" target="_blank">${escapeHtml(tPrivacy("defaultTitle"))}</a>`
        : "";

      CookieConsent.run({
        guiOptions: {
          consentModal: {
            layout: "box wide",
            position: (config.COOKIE_BANNER_POSITION as any) || "bottom center",
            equalWeightButtons: true,
          },
          preferencesModal: {
            layout: "box",
          },
        },
        categories,
        // A single translation: the interface language (changing the
        // language = full page reload).
        language: {
          default: locale,
          translations: {
            [locale]: {
              consentModal: {
                title: consentTitle,
                description: consentDescription,
                acceptAllBtn: t("acceptAll"),
                acceptNecessaryBtn: t("rejectAll"),
                showPreferencesBtn: t("customize"),
                footer: privacyLink,
              },
              preferencesModal: {
                title: t("preferencesTitle"),
                acceptAllBtn: t("acceptAll"),
                acceptNecessaryBtn: t("rejectAll"),
                savePreferencesBtn: t("savePreferences"),
                closeIconLabel: tA11y("close"),
                sections,
              },
            },
          },
        },
      });
    }).catch(() => {
      // Silent fail if import fails
      initializedRef.current = false;
    });
  }, [config, locale, t, tPrivacy, tA11y]);

  return null;
}
