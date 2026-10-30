"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2, Mail, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { throwIfNotOk } from "@/lib/api-client";
import { useDateFormat } from "@/hooks/use-date-format";

interface PeriodStats {
  success: number;
  error: number;
}

interface EmailStatsData {
  today: PeriodStats;
  yesterday: PeriodStats;
  month: PeriodStats;
  lastMonth: PeriodStats;
  total: PeriodStats;
}

function useEmailStats() {
  return useQuery({
    queryKey: ["email-stats"],
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/email/stats");
      await throwIfNotOk(res);
      return (await res.json()) as EmailStatsData;
    },
  });
}

function StatCard({ label, stats }: { label: string; stats: PeriodStats }) {
  const total = stats.success + stats.error;
  return (
    <div className="rounded-lg border p-3 space-y-1.5">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{total}</p>
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          {stats.success}
        </span>
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          {stats.error}
        </span>
      </div>
    </div>
  );
}

export function EmailStats() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { formatNumber } = useDateFormat();
  const { data, isLoading } = useEmailStats();
  const qc = useQueryClient();
  const [resetOpen, setResetOpen] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/email/stats", { method: "DELETE" });
      await throwIfNotOk(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-stats"] });
      setResetOpen(false);
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("stats.loading")}
      </div>
    );
  }

  const totalAll = data.total.success + data.total.error;
  const successPercent = totalAll > 0 ? (data.total.success / totalAll) * 100 : 0;
  const errorPercent = totalAll > 0 ? (data.total.error / totalAll) * 100 : 0;

  return (
    <div className="border rounded-lg p-4 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4" />
          {t("emailStats.title")}
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => setResetOpen(true)}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          {tc("actions.reset")}
        </Button>
      </div>

      {/* Monthly total — detached and highlighted */}
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
        <p className="text-xs text-muted-foreground font-medium">{t("emailStats.monthTotal")}</p>
        <div className="flex items-baseline gap-3">
          <p className="text-3xl font-bold tabular-nums">{data.month.success + data.month.error}</p>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              {t("emailStats.sent", { count: data.month.success })}
            </span>
            {data.month.error > 0 && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <XCircle className="h-3 w-3" />
                {t("emailStats.failed", { count: data.month.error })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Other period cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={tc("time.today")} stats={data.today} />
        <StatCard label={tc("time.yesterday")} stats={data.yesterday} />
        <StatCard label={t("stats.lastMonth")} stats={data.lastMonth} />
        <StatCard label={tc("table.total")} stats={data.total} />
      </div>

      {/* Success/error bar */}
      {totalAll > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("stats.successRate")}</span>
            <span>{formatNumber(successPercent / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
          </div>
          <div className="h-5 w-full rounded-full bg-muted overflow-hidden flex">
            {successPercent > 0 && (
              <div
                className="h-full bg-emerald-500 flex items-center justify-center text-[10px] text-white font-medium shrink-0"
                style={{ width: `${Math.max(successPercent, 2)}%` }}
                title={t("stats.successTitle", { count: data.total.success })}
              />
            )}
            {errorPercent > 0 && (
              <div
                className="h-full bg-red-500 flex items-center justify-center text-[10px] text-white font-medium shrink-0"
                style={{ width: `${Math.max(errorPercent, 2)}%` }}
                title={t("stats.errorTitle", { count: data.total.error })}
              />
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              {t("stats.successLegend", { count: data.total.success })}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />
              {t("stats.errorLegend", { count: data.total.error })}
            </span>
          </div>
        </div>
      )}

      {totalAll === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">
          {t("emailStats.empty")}
        </p>
      )}

      <DeleteConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("stats.resetTitle")}
        description={t("emailStats.resetDescription")}
        onConfirm={() => resetMutation.mutate()}
        isPending={resetMutation.isPending}
      />
    </div>
  );
}
