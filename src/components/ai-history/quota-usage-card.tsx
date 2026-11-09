"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAiHistoryQuota } from "@/hooks/use-ai-history";
import { useDateFormat } from "@/hooks/use-date-format";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";

/** Usage of the current quota period per account, read only (managed in Settings → AI). */
export function QuotaUsageCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations("admin.aiHistory.quota");
  const tc = useTranslations("common");
  const { formatDate, formatNumber } = useDateFormat();
  const { can } = usePermissions();
  const { data, isLoading } = useAiHistoryQuota(enabled);
  const usd = (value: number) => formatNumber(value, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const quotaOn = !!data?.settings.enabled && data.settings.amountUsd > 0;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          {data && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("period", { start: formatDate(data.periodStart), next: formatDate(data.nextReset) })}
              {" · "}
              {quotaOn ? t("amount", { amount: usd(data.settings.amountUsd) }) : t("disabled")}
            </p>
          )}
        </div>
        {can("pages:settings") && (
          <Link href="/settings?tab=ai" className="text-xs text-primary hover:underline">
            {t("manage")}
          </Link>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
      ) : !data?.users.length ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.user")}</TableHead>
                <TableHead className="text-right">{t("columns.usage")}</TableHead>
                {quotaOn && <TableHead className="w-[40%] min-w-[160px]">{t("columns.share")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="text-sm">
                    <span className="font-medium">{user.name || user.email}</span>
                    {user.unlimited && <Badge variant="secondary" className="ml-2 text-[10px]">{t("unlimited")}</Badge>}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{usd(user.usageUsd)}</TableCell>
                  {quotaOn && (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", user.percent >= 100 ? "bg-destructive" : user.percent >= 80 ? "bg-amber-500" : "bg-primary")}
                            style={{ width: `${user.unlimited ? 0 : user.percent}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatNumber(user.percent / 100, { style: "percent" })}</span>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
