"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2, MessageSquare, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { throwIfNotOk } from "@/lib/api-client";
import { useDateFormat } from "@/hooks/use-date-format";

interface PeriodStats {
  success: number;
  error: number;
}

interface SmsStatsData {
  today: PeriodStats;
  yesterday: PeriodStats;
  month: PeriodStats;
  lastMonth: PeriodStats;
  total: PeriodStats;
}

function useSmsStats() {
  return useQuery({
    queryKey: ["sms-stats"],
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/sms/stats");
      await throwIfNotOk(res);
      return (await res.json()) as SmsStatsData;
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

export function SmsStats() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { formatNumber } = useDateFormat();
  const { data, isLoading } = useSmsStats();
  const qc = useQueryClient();
  const [resetOpen, setResetOpen] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sms/stats", { method: "DELETE" });
      await throwIfNotOk(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sms-stats"] });
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
          <MessageSquare className="h-4 w-4" />
          {t("smsStats.title")}
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

      <div className="grid grid-cols-5 gap-3">
        <StatCard label={tc("time.today")} stats={data.today} />
        <StatCard label={tc("time.yesterday")} stats={data.yesterday} />
        <StatCard label={t("stats.thisMonth")} stats={data.month} />
        <StatCard label={t("stats.lastMonth")} stats={data.lastMonth} />
        <StatCard label={tc("table.total")} stats={data.total} />
      </div>

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
          {t("smsStats.empty")}
        </p>
      )}

      <DeleteConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("stats.resetTitle")}
        description={t("smsStats.resetDescription")}
        onConfirm={() => resetMutation.mutate()}
        isPending={resetMutation.isPending}
      />
    </div>
  );
}
