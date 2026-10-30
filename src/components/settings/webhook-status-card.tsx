"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWebhookStatus } from "@/hooks/use-webhook-logs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, AlertTriangle, CircleCheck, Webhook } from "lucide-react";
import { useDateFormat } from "@/hooks/use-date-format";

export function WebhookStatusCard() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const { data, isLoading } = useWebhookStatus();
  const [copied, setCopied] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        {t("webhookStatus.loading")}
      </div>
    );
  }

  const lastReceived = data.lastReceivedAt ? new Date(data.lastReceivedAt) : null;
  const recent = lastReceived && Date.now() - lastReceived.getTime() < 24 * 60 * 60 * 1000;
  const healthy = data.secretConfigured && recent && data.errors24h === 0;

  const copyUrl = async () => {
    if (!data.webhookUrl) return;
    await navigator.clipboard.writeText(data.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">{t("webhookStatus.title")}</h4>
        </div>
        {healthy ? (
          <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30">
            <CircleCheck className="h-3 w-3 mr-1" /> {t("webhookStatus.healthy")}
          </Badge>
        ) : !data.secretConfigured ? (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
            <AlertTriangle className="h-3 w-3 mr-1" /> {t("webhookStatus.secretMissing")}
          </Badge>
        ) : !recent ? (
          <Badge variant="outline" className="bg-slate-500/10 text-slate-600 border-slate-500/30">
            {t("webhookStatus.waiting")}
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/30">
            <AlertTriangle className="h-3 w-3 mr-1" /> {t("webhookStatus.errors")}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">{t("webhookStatus.urlLabel")}</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all">
            {data.webhookUrl || t("webhookStatus.urlMissing")}
          </code>
          {data.webhookUrl && (
            <Button size="sm" variant="outline" onClick={copyUrl} className="gap-1.5 shrink-0">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? t("webhookStatus.copied") : tc("actions.copy")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-md bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground">{t("webhookStatus.lastEvent")}</p>
          <p className="text-sm font-medium mt-0.5">
            {lastReceived ? formatDateTime(lastReceived) : tc("time.never")}
          </p>
        </div>
        <div className="rounded-md bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground">{t("webhookStatus.events24h")}</p>
          <p className="text-sm font-medium mt-0.5">{data.events24h}</p>
        </div>
        <div className="rounded-md bg-muted/30 p-2">
          <p className="text-xs text-muted-foreground">{t("webhookStatus.errors24h")}</p>
          <p className={`text-sm font-medium mt-0.5 ${data.errors24h > 0 ? "text-red-600" : ""}`}>{data.errors24h}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("webhookStatus.help")}
      </p>
    </div>
  );
}
