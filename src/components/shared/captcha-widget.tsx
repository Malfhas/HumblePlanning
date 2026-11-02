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

/** Options without an attribute of their own: the logo and the footer are
 *  replaced by the notice under the widget. */
const ALTCHA_CONFIGURATION = JSON.stringify({ hideLogo: true, hideFooter: true });

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
    return () => el.removeEventListener("statechange", handleStateChange);
  }, [ready, onVerify, onExpire]);

  // colorScheme toggles the widget's internal CSS `light-dark()` function,
  // for the few colors not taken from the theme below.
  const widgetStyle = {
    colorScheme: resolvedTheme === "dark" ? "dark" : "light",
  } as React.CSSProperties;

  return (
    <div className="flex w-full flex-col gap-1">
      {ready ? (
        <>
          {/*
            The widget renders in the light DOM: it takes the theme colors
            through its CSS variables and sits like the inputs of the form
            (full width, same height, border and radius). Logo and footer
            are hidden by `configuration`: the attribution is shown below
            the box instead, in the language of the interface.
          */}
          <style>{`
            altcha-widget {
              display: block;
              width: 100%;
              font-size: 0.875rem;
              --altcha-max-width: 100%;
              --altcha-border-width: 1px;
              --altcha-border-radius: calc(var(--radius) - 2px);
              --altcha-border-color: var(--input);
              --altcha-shadow: none;
              --altcha-color-base: transparent;
              --altcha-color-base-content: var(--foreground);
              --altcha-color-neutral: var(--muted);
              --altcha-color-neutral-content: var(--muted-foreground);
              --altcha-color-primary: var(--primary);
              --altcha-color-primary-content: var(--primary-foreground);
              --altcha-color-error: var(--destructive);
              --altcha-checkbox-size: 20px;
              --altcha-checkbox-border-color: var(--ring);
              --altcha-checkbox-border-radius: 4px;
              --altcha-spinner-color: var(--primary);
            }
            .dark altcha-widget {
              --altcha-color-base: color-mix(in oklab, var(--input) 30%, transparent);
            }
            altcha-widget .altcha-main {
              box-sizing: border-box;
              min-height: 2.75rem;
              padding-block: 0;
              justify-content: center;
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
            configuration={ALTCHA_CONFIGURATION}
            style={widgetStyle}
          />
        </>
      ) : (
        <div className="flex h-11 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          {t("captcha.loading")}
        </div>
      )}
      <p className="self-end text-[11px] text-muted-foreground">
        {t.rich("captcha.altchaNotice", {
          link: (chunks) => <a href="https://altcha.org/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">{chunks}</a>,
        })}
      </p>
    </div>
  );
}

/** Global set by the reCAPTCHA v3 script (the part used here). */
type RecaptchaWindow = Window & {
  grecaptcha?: {
    ready: (callback: () => void) => void;
    execute: (siteKey: string, options: { action: string }) => Promise<string>; // i18n-ignore TypeScript type read as JSX text
  };
};

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
    const grecaptcha = (window as RecaptchaWindow).grecaptcha;
    if (!ready || !grecaptcha) return;
    grecaptcha.ready(() => {
      grecaptcha
        .execute(siteKey, { action: "login" })
        .then((token) => onVerify(token));
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
