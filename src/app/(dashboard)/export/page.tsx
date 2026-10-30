"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Loader2,
  Copy,
  RefreshCw,
  Check,
  ArrowRight,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePermissions } from "@/hooks/use-permissions";
import { useConfig } from "@/hooks/use-config";
import { ErrorState } from "@/components/shared/error-state";
import { apiFetch, throwIfNotOk, ApiClientError } from "@/lib/api-client";

export default function ExportPage() {
  const t = useTranslations("exports.page");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [icalToken, setIcalToken] = useState<string | null>(null);
  const [icalCopied, setIcalCopied] = useState(false);
  const [icalLoading, setIcalLoading] = useState(false);
  const [icalDeleting, setIcalDeleting] = useState(false);
  const [icalError, setIcalError] = useState<string | null>(null);
  const { can, isLoading: permLoading } = usePermissions();
  const { data: config } = useConfig();

  // Load existing token on mount
  useEffect(() => {
    fetch("/api/export/ical/token")
      .then((r) => r.json())
      .then((data) => { if (data?.token) setIcalToken(data.token); })
      .catch(() => {});
  }, []);

  // Use APP_BASE_URL from settings (falls back to window.location.origin)
  const baseUrl = config?.APP_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "");

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("export:use")) return <ErrorState code={403} compact showBack={false} />;

  // i18n-ignore technical URL, not a text
  const icalUrl = icalToken ? `${baseUrl}/api/export/ical?token=${icalToken}` : "";
  const errorMessage = (err: unknown) => (err instanceof ApiClientError ? err.message : te("network"));

  const handleGenerateIcalToken = async () => {
    setIcalLoading(true);
    setIcalError(null);
    try {
      const data = await apiFetch<{ token: string }>("/api/export/ical", { method: "POST" });
      setIcalToken(data.token);
    } catch (err) {
      setIcalError(errorMessage(err));
    } finally {
      setIcalLoading(false);
    }
  };

  const handleDeleteIcalToken = async () => {
    setIcalDeleting(true);
    setIcalError(null);
    try {
      await throwIfNotOk(await fetch("/api/export/ical/token", { method: "DELETE" }));
      setIcalToken(null);
    } catch (err) {
      setIcalError(errorMessage(err));
    } finally {
      setIcalDeleting(false);
    }
  };

  const handleCopyIcalUrl = () => {
    if (!icalUrl) return;
    navigator.clipboard.writeText(icalUrl);
    setIcalCopied(true);
    setTimeout(() => setIcalCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      {/* Redirect to planning for PDF/Excel/CSV */}
      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10">
            <ArrowRight className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">{t("files.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("files.description")}
        </p>
        <Button asChild>
          <Link href="/planning">
            <ArrowRight className="h-4 w-4 mr-2" />
            {t("files.goToPlanning")}
          </Link>
        </Button>
      </div>

      {/* iCal */}
      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10">
            <CalendarDays className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">{t("ical.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("ical.description")}
        </p>

        <div className="space-y-3">
          {icalToken ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-muted p-2.5 rounded truncate select-all">
                  {icalUrl}
                </code>
                <Button size="sm" variant="outline" onClick={handleCopyIcalUrl} aria-label={t("ical.copyAriaLabel")}>
                  {icalCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleGenerateIcalToken}
                  disabled={icalLoading}
                >
                  {icalLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  {t("ical.regenerate")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDeleteIcalToken}
                  disabled={icalDeleting}
                >
                  {icalDeleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  {tc("actions.delete")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("ical.help")}
              </p>
            </div>
          ) : (
            <Button onClick={handleGenerateIcalToken} disabled={icalLoading}>
              {icalLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <CalendarDays className="h-4 w-4 mr-2" />
              {t("ical.generate")}
            </Button>
          )}
          {icalError && <p className="text-sm text-destructive" role="alert">{icalError}</p>}
        </div>
      </div>
    </div>
  );
}
