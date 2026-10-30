"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
 * global-error replaces the root layout: no provider (neither next-intl nor
 * theme) is available. Inline mini-dictionary, language chosen after
 * mount: HP_LOCALE cookie, then browser language, then French.
 */
const TEXTS = {
  fr: {
    title: "Erreur critique",
    description: "L'application a rencontré une erreur critique. Veuillez rafraîchir la page.",
    reference: "Référence :",
    reload: "Rafraîchir la page",
  },
  en: {
    title: "Critical error",
    description: "The application encountered a critical error. Please reload the page.",
    reference: "Reference:",
    reload: "Reload the page",
  },
} as const;

type Lang = keyof typeof TEXTS;

function detectLang(): Lang {
  const cookie = /(?:^|;\s*)HP_LOCALE=(fr|en)\b/.exec(document.cookie)?.[1];
  if (cookie === "fr" || cookie === "en") return cookie;
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  return nav === "en" ? "en" : "fr";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // "fr" on the server / during hydration, then the language detected client-side.
  const lang = useSyncExternalStore<Lang>(() => () => {}, detectLang, () => "fr");

  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  const t = TEXTS[lang];

  return (
    <html lang={lang}>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", backgroundColor: "#fafafa", color: "#171717" }}>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "1rem", position: "relative", overflow: "hidden" }}>
          {/* Background circles */}
          <div style={{ position: "absolute", top: "-6rem", right: "-6rem", width: "24rem", height: "24rem", borderRadius: "50%", backgroundColor: "rgba(239,68,68,0.03)" }} />
          <div style={{ position: "absolute", bottom: "-8rem", left: "-8rem", width: "30rem", height: "30rem", borderRadius: "50%", backgroundColor: "rgba(239,68,68,0.03)" }} />

          <div style={{ maxWidth: "32rem", textAlign: "center", position: "relative" }}>
            <div style={{ fontSize: "10rem", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.05em", background: "linear-gradient(to bottom, rgba(239,68,68,0.15), rgba(239,68,68,0.05))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", userSelect: "none" }}>
              500
            </div>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginTop: "1rem" }}>{t.title}</h1>
            <p style={{ color: "#737373", fontSize: "0.875rem", marginTop: "0.5rem", lineHeight: 1.6 }}>
              {t.description}
            </p>
            {error.digest && (
              <p style={{ color: "#a3a3a3", fontSize: "0.75rem", fontFamily: "monospace", marginTop: "0.5rem" }}>
                {t.reference} {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                marginTop: "2rem",
                padding: "0.625rem 1.75rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "1px solid #e5e5e5",
                borderRadius: "0.5rem",
                backgroundColor: "#fff",
                cursor: "pointer",
              }}
            >
              {t.reload}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
