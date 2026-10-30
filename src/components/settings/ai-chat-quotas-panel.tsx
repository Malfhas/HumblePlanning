"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Loader2, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/shared/data-table";
import { quotaColor } from "@/components/ai-chat/quota-gauge";
import { shortDate, shortDateTime } from "@/components/ai-chat/lib/dates";
import { useDateFormat } from "@/hooks/use-date-format";
import { apiFetch } from "@/lib/api-client";

/**
 * Settings > AI > AI chat quotas: the monthly cap per person,
 * measured on the actual cost of the replies, and each account's usage over
 * the current period. Amounts are only visible here: the user only gets
 * a gauge.
 */

interface QuotaSettings {
  enabled: boolean;
  amountUsd: number;
  resetDay: number;
  resetAt: string | null;
}
interface UserQuotaRow {
  id: string;
  name: string;
  email: string;
  usageUsd: number;
  percent: number;
  unlimited: boolean;
  resetAt: string | null;
}
interface QuotasView {
  settings: QuotaSettings;
  periodStart: string;
  nextReset: string;
  users: UserQuotaRow[];
}
/** The form keeps strings: input is not corrected on the fly. */
interface FormValues {
  enabled: boolean;
  amount: string;
  day: string;
}

const QUERY_KEY = ["ai-chat-admin-quotas"];

/** Amounts in dollars (OpenRouter bills in USD), formatted per the language. */
const DOLLARS: Intl.NumberFormatOptions = { style: "currency", currency: "USD" };

const toFormValues = (r: QuotaSettings): FormValues => ({ enabled: r.enabled, amount: r.amountUsd.toFixed(2), day: String(r.resetDay) });

/** Same color code as the user's gauge. */
const TINTS: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400",
};
const BARS: Record<string, string> = { success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500" };

/** JSON call: the thrown error carries the message already translated by the server. */
const callApi = apiFetch;

export function AiChatQuotasPanel() {
  const t = useTranslations("aiChat.quotas");
  const tActions = useTranslations("common.actions");
  const { intlTag, formatNumber } = useDateFormat();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: () => callApi<QuotasView>("/api/ai-chat/admin/quotas") });
  const [draft, setDraft] = useState<FormValues | null>(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [userToReset, setUserToReset] = useState<UserQuotaRow | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // The form starts from the saved settings and only re-syncs with them after a save
  const form = draft ?? (data ? toFormValues(data.settings) : null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const showSuccess = (text: string) => setMessage({ tone: "ok", text });
  const showError = (err: unknown) => setMessage({ tone: "error", text: (err as Error).message });

  const saveSettings = useMutation({
    mutationFn: (values: FormValues) =>
      callApi<{ settings: QuotaSettings }>("/api/ai-chat/admin/quotas/settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: values.enabled,
          amountUsd: Number(values.amount.replace(",", ".")),
          resetDay: Number(values.day),
        }),
      }),
    onSuccess: (result) => {
      showSuccess(t("toast.saved"));
      setDraft(toFormValues(result.settings));
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["ai-chat-access"] });
    },
    onError: showError,
  });

  const resetAll = useMutation({
    mutationFn: () => callApi("/api/ai-chat/admin/quotas/reset", { method: "POST" }),
    onSuccess: () => {
      showSuccess(t("toast.resetAll"));
      setConfirmResetAll(false);
      refresh();
    },
    onError: showError,
  });

  const resetOne = useMutation({
    mutationFn: (id: string) => callApi(`/api/ai-chat/admin/quotas/${id}/reset`, { method: "POST" }),
    onSuccess: (_r, id) => {
      const user = data?.users.find((u) => u.id === id);
      showSuccess(user?.name ? t("toast.resetOne", { name: user.name }) : t("toast.resetOneUnnamed"));
      setUserToReset(null);
      refresh();
    },
    onError: showError,
  });

  const toggleUnlimited = useMutation({
    mutationFn: ({ id, unlimited }: { id: string; unlimited: boolean }) =>
      callApi(`/api/ai-chat/admin/quotas/${id}`, { method: "PATCH", body: JSON.stringify({ unlimited }) }),
    onSuccess: (_r, { unlimited }) => {
      showSuccess(unlimited ? t("toast.unlimitedOn") : t("toast.unlimitedOff"));
      refresh();
    },
    onError: showError,
  });

  const currentCapUsd = data?.settings.amountUsd ?? 0;
  const columns = useMemo<ColumnDef<UserQuotaRow, unknown>[]>(
    () => [
      {
        // Name, email and own last reset combined: the Settings page column is narrow
        id: "user",
        header: t("columns.user"),
        // i18n-ignore search value (account name and email)
        accessorFn: (row) => `${row.name} ${row.email}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            {row.original.email ? <p className="truncate text-xs text-muted-foreground">{row.original.email}</p> : null}
            {row.original.resetAt ? (
              <p className="text-xs text-muted-foreground">
                {t("resetOn", { date: shortDateTime(row.original.resetAt, intlTag) })}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "usage",
        header: t("columns.usage"),
        accessorFn: (row) => row.usageUsd,
        cell: ({ row }) => {
          const tint = quotaColor(row.original.percent);
          return (
            <div className="flex items-center gap-2">
              <span className="tabular-nums">{formatNumber(row.original.usageUsd, DOLLARS)}</span>
              <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
                {row.original.unlimited ? null : (
                  <span className={`block h-full rounded-full ${BARS[tint]}`} style={{ width: `${row.original.percent}%` }} />
                )}
              </span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: t("columns.status"),
        accessorFn: (row) => (row.unlimited ? t("unlimited") : t("percent", { percent: row.percent })),
        cell: ({ row }) =>
          row.original.unlimited ? (
            <Badge variant="outline">{t("unlimited")}</Badge>
          ) : currentCapUsd > 0 ? (
            <Badge variant="outline" className={TINTS[quotaColor(row.original.percent)]}>
              {row.original.percent >= 100 ? t("reached") : t("percent", { percent: row.original.percent })}
            </Badge>
          ) : (
            <Badge variant="outline">{t("noQuota")}</Badge>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title={t("unlimitedTooltip")}>
              <Switch
                checked={row.original.unlimited}
                aria-label={t("unlimitedAriaLabel", { name: row.original.name })}
                disabled={toggleUnlimited.isPending}
                onCheckedChange={(unlimited) => toggleUnlimited.mutate({ id: row.original.id, unlimited })}
              />
              {t("unlimited")}
            </label>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title={t("resetOneTooltip")}
              aria-label={t("resetOneAriaLabel", { name: row.original.name })}
              onClick={() => setUserToReset(row.original)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [toggleUnlimited, currentCapUsd, t, intlTag, formatNumber],
  );

  if (isLoading || !data || !form) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
      </div>
    );
  }
  const isDirty = JSON.stringify(form) !== JSON.stringify(toFormValues(data.settings));
  const day = Number(form.day);
  const amount = Number(form.amount.replace(",", "."));
  const isValid = Number.isInteger(day) && day >= 1 && day <= 28 && amount >= 0;

  const exportCsv = () => {
    const escapeCsv = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csvRows = [
      [t("csv.name"), t("csv.email"), t("csv.usage"), t("csv.percent"), t("csv.unlimited"), t("csv.lastReset")],
      ...data.users.map((u) => [
        u.name,
        u.email,
        u.usageUsd.toFixed(6),
        String(u.percent),
        u.unlimited ? t("csv.yes") : t("csv.no"),
        u.resetAt ?? "",
      ]),
    ];
    const csv = "﻿" + csvRows.map((r) => r.map(escapeCsv).join(";")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    // file name unchanged whatever the language
    link.download = "quotas-chat-ia.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      {message ? (
        <p className={message.tone === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"} role="status">
          {message.text}
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t("settings.title")}</CardTitle>
            <CardDescription>
              {t("settings.period", {
                start: shortDate(data.periodStart, intlTag),
                next: shortDate(data.nextReset, intlTag),
              })}
            </CardDescription>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(enabled) => setDraft({ ...form, enabled })} aria-label={t("settings.enableAriaLabel")} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="quota-amount">{t("settings.amount.label")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="quota-amount"
                type="number"
                min={0}
                step="0.01"
                className="w-32"
                value={form.amount}
                onChange={(e) => setDraft({ ...form, amount: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">{t("settings.amount.unit")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.amount.help")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quota-reset-day">{t("settings.resetDay.label")}</Label>
            <Input
              id="quota-reset-day"
              type="number"
              min={1}
              max={28}
              step={1}
              className="w-32"
              value={form.day}
              onChange={(e) => setDraft({ ...form, day: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t("settings.resetDay.help")}</p>
          </div>
          <div className="flex items-center justify-between gap-3 max-md:flex-wrap">
            <Button variant="outline" onClick={() => setConfirmResetAll(true)} title={t("settings.resetAll.tooltip")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t("settings.resetAll.label")}
            </Button>
            <Button onClick={() => saveSettings.mutate(form)} disabled={!isDirty || !isValid || saveSettings.isPending}>
              {saveSettings.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {tActions("save")}
            </Button>
          </div>
          {data.settings.resetAt ? (
            <p className="text-xs text-muted-foreground">
              {t("settings.lastGlobalReset", { date: shortDateTime(data.settings.resetAt, intlTag) })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={data.users}
        searchPlaceholder={t("searchPlaceholder")}
        toolbar={
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> {t("exportCsv")}
          </Button>
        }
      />

      <AlertDialog open={confirmResetAll} onOpenChange={setConfirmResetAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmResetAll.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmResetAll.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tActions("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetAll.mutate()} disabled={resetAll.isPending}>
              {tActions("reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(userToReset)} onOpenChange={(open) => !open && setUserToReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmResetOne.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("confirmResetOne.description", {
                name: userToReset?.name ?? "",
                b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tActions("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => userToReset && resetOne.mutate(userToReset.id)} disabled={resetOne.isPending}>
              {tActions("reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
