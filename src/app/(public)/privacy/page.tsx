"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isValid, parseISO } from "date-fns";
import { ArrowLeft, Shield, FileText, Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { sanitizeHtml } from "@/lib/utils/sanitize-html";
import { formatWithLocale } from "@/lib/utils/dates";
import type { AppLocale } from "@/i18n/config";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function PrivacyPage() {
  const t = useTranslations("public.privacy");
  const locale = useLocale() as AppLocale;
  const tCommon = useTranslations("common.actions");
  const [config, setConfig] = useState<Record<string, string | null>>({});
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  // Title and content entered by the admin: single-language; only the default texts are translated.
  const title = config.PRIVACY_POLICY_TITLE || t("defaultTitle");
  const content = config.PRIVACY_POLICY_CONTENT || "";
  // ISO date (yyyy-MM-dd) formatted in the reader's language; legacy text
  // value (« 30 octobre 2026 ») displayed as is.
  const lastUpdatedRaw = config.PRIVACY_POLICY_LAST_UPDATED?.trim() || "";
  const lastUpdatedDate = ISO_DATE_RE.test(lastUpdatedRaw) ? parseISO(lastUpdatedRaw) : null;
  const lastUpdated = lastUpdatedDate && isValid(lastUpdatedDate)
    ? formatWithLocale(lastUpdatedDate, "d MMMM yyyy", locale)
    : lastUpdatedRaw;
  const enabled = config.PRIVACY_POLICY_ENABLED === "true";
  const companyName = config.LEGAL_COMPANY_NAME || "";
  const contactEmail = config.LEGAL_CONTACT_EMAIL || "";
  const retentionDays = config.LEGAL_DATA_RETENTION_DAYS || "365";

  // Replace variables in content
  const retentionCount = Number(retentionDays);
  const retentionLabel = Number.isFinite(retentionCount) ? t("placeholders.retention", { count: retentionCount }) : retentionDays;
  const renderedContent = content
    .replace(/\{\{SOCIETE\}\}/g, companyName || t("placeholders.company"))
    .replace(/\{\{EMAIL_DPO\}\}/g, contactEmail ? `<a href="mailto:${contactEmail}" class="text-primary underline">${contactEmail}</a>` : t("placeholders.dpoEmail"))
    .replace(/\{\{DUREE_CONSERVATION\}\}/g, retentionLabel);
  const appTitle = config.APP_TITLE || "HumblePlanning";
  const copyright = config.FOOTER_COPYRIGHT_TEXT || "";
  const logoPath = resolveThemedAsset(config, "APP_LOGO", resolvedTheme);

  if (!enabled) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-lg text-center space-y-4">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <p className="text-muted-foreground">{t("unavailable")}</p>
          <Link href="/login">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tCommon("back")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Navbar */}
      <nav className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <span className="flex items-center gap-2">
            {logoPath ? (
              <img src={`/api/${logoPath.startsWith("branding/") ? "" : "files/"}${logoPath}`} alt={appTitle} className="h-7 object-contain" />
            ) : (
              <span className="text-sm font-semibold">{appTitle}</span>
            )}
          </span>
          <Link href="/login">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tCommon("back")}
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="border-b bg-muted/30">
        <div className="max-w-5xl mx-auto px-6 py-10 md:py-14">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 mb-2">
              <FileText className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {lastUpdated && <span>{t("lastUpdated", { date: lastUpdated })}</span>}
              {companyName && lastUpdated && <span>·</span>}
              {companyName && <span>{companyName}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        {content ? (
          <article className="rounded-xl border bg-card p-8 md:p-12 shadow-sm">
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderedContent) }}
            />
          </article>
        ) : (
          <div className="rounded-xl border bg-card p-12 text-center">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{t("empty")}</p>
          </div>
        )}

        {/* Contact card */}
        {contactEmail && (
          <div className="mt-8 rounded-xl border bg-muted/30 p-6 flex items-center gap-4">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 shrink-0">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("dpo.title")}</p>
              <p className="text-sm text-muted-foreground">
                {t.rich("dpo.contact", {
                  email: contactEmail,
                  link: (chunks) => <a href={`mailto:${contactEmail}`} className="text-primary underline">{chunks}</a>,
                })}
              </p>
            </div>
          </div>
        )}

        {/* Cookie preferences */}
        {config.COOKIE_BANNER_ENABLED === "true" && <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Open cookie consent preferences if available
              import("vanilla-cookieconsent").then((CC) => CC.showPreferences()).catch(() => {});
            }}
          >
            <Cookie className="mr-1.5 h-4 w-4" />
            {t("manageCookies")}
          </Button>
        </div>}
      </div>

      {/* Footer */}
      <footer className="border-t mt-10">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>{copyright || appTitle}</span>
          <Link href="/login" className="hover:text-foreground transition-colors">{t("signIn")}</Link>
        </div>
      </footer>
    </>
  );
}
