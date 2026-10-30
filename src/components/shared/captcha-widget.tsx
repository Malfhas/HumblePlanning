"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { Turnstile } from "@marsidev/react-turnstile";
import type { AppLocale } from "@/i18n/config";

/** ALTCHA widget language (codes from `altcha/i18n/*`). */
const ALTCHA_LANGUAGE: Record<AppLocale, string> = { fr: "fr-fr", en: "en", es: "es-es", de: "de" };

/** ALTCHA locale loader (literal paths: the bundler must see them). */
const ALTCHA_LOADERS: Record<AppLocale, () => Promise<unknown>> = { // i18n-ignore TypeScript type read as JSX text
  // @ts-expect-error — the package ships no types for this locale
  fr: () => import("altcha/i18n/fr-fr"),
  en: () => import("altcha/i18n/en"),
  // @ts-expect-error — the package ships no types for this locale
  es: () => import("altcha/i18n/es-es"),
  de: () => import("altcha/i18n/de"),
};

interface CaptchaWidgetProps {
  provider: "altcha" | "turnstile" | "recaptcha";
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

function AltchaCaptcha({ onVerify, onExpire }: Omit<CaptchaWidgetProps, "provider" | "siteKey">) {
  const widgetRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const { resolvedTheme } = useTheme();
  const t = useTranslations("auth");
  const locale = useLocale() as AppLocale;

  useEffect(() => {
    let cancelled = false;
    // `altcha/i18n` registers the custom element AND the i18n store.
    // `altcha/i18n/<language>` adds the interface locale to the store.
    Promise.all([
      import("altcha/i18n"),
      (ALTCHA_LOADERS[locale] ?? ALTCHA_LOADERS.fr)(),
    ])
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        console.error("[ALTCHA] Failed to load the widget:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (!ready) return;
    const el = widgetRef.current;
    if (!el) return;

    const handleStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ state: string; payload?: string }>).detail;
      if (detail?.state === "verified" && detail.payload) {
        onVerify(detail.payload);
      } else if (detail?.state === "expired" || detail?.state === "error") {
        onExpire?.();
      }
    };

    el.addEventListener("statechange", handleStateChange);

    // Upstream widget accessibility bug: the `<a class="altcha-logo">` link
    // is `aria-hidden="true"` but stays clickable, which triggers the browser
    // warning "Blocked aria-hidden on an element because its descendant
    // retained focus" on click. We remove the attribute as soon as it shows up
    // in the widget subtree: `tabindex="-1"` already prevents keyboard
    // navigation, and without aria-hidden screen readers correctly announce
    // the attribution link.
    const stripAriaHiddenOnLogo = () => {
      el.querySelectorAll<HTMLElement>(".altcha-logo[aria-hidden]").forEach((a) => {
        a.removeAttribute("aria-hidden");
      });
    };
    stripAriaHiddenOnLogo();
    const observer = new MutationObserver(stripAriaHiddenOnLogo);
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden"] });

    return () => {
      el.removeEventListener("statechange", handleStateChange);
      observer.disconnect();
    };
  }, [ready, onVerify, onExpire]);

  if (!ready) {
    return (
      <div className="flex h-[58px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
        {t("captcha.loading")}
      </div>
    );
  }

  // colorScheme toggles the widget's internal CSS `light-dark()` function,
  // which aligns its colors with the site's current theme.
  const widgetStyle = {
    colorScheme: resolvedTheme === "dark" ? "dark" : "light",
  } as React.CSSProperties;

  return (
    <div className="flex w-full justify-center">
      {/*
        Visual overrides for the widget (no Shadow DOM, classes reachable
        in the light DOM). We force a single-line layout, the logo is
        right-aligned, the "Protected by ALTCHA" text is hidden and the
        width is fixed (~310 px) to stay more compact than the
        "Sign in" button, like the Turnstile widget.

        The 1st child of .altcha-main holds the checkbox-wrap AND the
        ALTCHA logo (rendered right after in the same flex container).
        Giving it flex-grow:1 and forcing the inner checkbox-wrap
        not to stretch pushes the logo all the way to the right of the
        container — exactly 0.75rem from the edge (the widget padding).
      */}
      <style>{`
        altcha-widget .altcha-main {
          flex-direction: row !important;
          align-items: center !important;
          gap: 0.5rem !important;
          width: 310px;
          max-width: 100%;
        }
        altcha-widget .altcha-main > *:first-child {
          flex-grow: 1 !important;
          width: auto !important;
          justify-content: space-between !important;
        }
        altcha-widget .altcha-main > *:first-child .altcha-checkbox-wrap {
          flex-grow: 0 !important;
        }
        altcha-widget .altcha-footer {
          display: none !important;
        }
      `}</style>
      {/* Web Component provided by the `altcha` package — not typed in JSX by default.
          - `challenge`: URL to fetch the challenge from (the widget detects
            automatically that it is a URL via the regex /^(https?:)?\\//).
          - `auto="onload"`: starts solving the PoW as soon as the widget
            mounts, without waiting for the user to tick the box. The
            check is therefore transparent: by the time the form is
            filled in, the captcha is already solved. */}
      {/* @ts-expect-error custom element */}
      <altcha-widget
        ref={widgetRef as unknown as React.RefObject<HTMLElement>}
        challenge="/api/altcha/challenge"
        auto="onload"
        name="altcha"
        language={ALTCHA_LANGUAGE[locale]}
        style={widgetStyle}
      />
    </div>
  );
}

function RecaptchaWidget({ siteKey, onVerify }: Omit<CaptchaWidgetProps, "provider">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const t = useTranslations("auth");
  const locale = useLocale();

  useEffect(() => {
    if (document.querySelector('script[src*="recaptcha/api.js"]')) {
      setReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}&hl=${locale}`;
    script.async = true;
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, [siteKey, locale]);

  const execute = useCallback(() => {
    if (!ready || !(window as any).grecaptcha) return;
    (window as any).grecaptcha.ready(() => {
      (window as any).grecaptcha
        .execute(siteKey, { action: "login" })
        .then((token: string) => onVerify(token));
    });
  }, [ready, siteKey, onVerify]);

  useEffect(() => {
    execute();
  }, [execute]);

  return (
    <div ref={containerRef}>
      <p className="text-[11px] text-muted-foreground">
        {t.rich("captcha.recaptchaNotice", {
          privacy: (chunks) => <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">{chunks}</a>,
          terms: (chunks) => <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline">{chunks}</a>,
        })}
      </p>
    </div>
  );
}

export function CaptchaWidget({ provider, siteKey, onVerify, onExpire }: CaptchaWidgetProps) {
  const locale = useLocale();
  if (provider === "altcha") {
    return <AltchaCaptcha onVerify={onVerify} onExpire={onExpire} />;
  }

  if (!siteKey) return null;

  if (provider === "turnstile") {
    return (
      <div className="flex justify-center">
        <Turnstile
          siteKey={siteKey}
          onSuccess={onVerify}
          onExpire={() => onExpire?.()}
          options={{ theme: "auto", size: "normal", language: locale }}
        />
      </div>
    );
  }

  if (provider === "recaptcha") {
    return <RecaptchaWidget siteKey={siteKey} onVerify={onVerify} onExpire={onExpire} />;
  }

  return null;
}
