"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Coins, Download, Filter, MessageSquare, MessagesSquare, Timer, Trash2, X, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import {
  aiHistoryParams,
  previewAiHistoryPurge,
  useAiHistoryFilterOptions,
  useAiHistoryList,
  useAiHistorySummary,
  usePurgeAiHistory,
  type AiHistoryFilters,
} from "@/hooks/use-ai-history";
import { usePermissions } from "@/hooks/use-permissions";
import { useDateFormat } from "@/hooks/use-date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorState } from "@/components/shared/error-state";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { FilterMultiSelect } from "@/components/shared/filter-multi-select";
import { PermissionButton } from "@/components/shared/permission-button";
import { ServerPagination } from "@/components/shared/server-pagination";
import { PurgeBeforeDialog } from "@/components/shared/purge-before-dialog";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { StatsKpiCard } from "@/components/stats/stats-kpi-card";
import { ChartCard } from "@/components/stats/chart-card";
import { ChartContainer } from "@/components/stats/chart-container";
import { ChartEmpty } from "@/components/stats/chart-empty";
import { ChartTooltip } from "@/components/stats/chart-tooltip";
import { formatChartDate } from "@/components/stats/chart-utils";
import { ConversationDetailDialog } from "@/components/ai-history/conversation-detail-dialog";
import { QuotaUsageCard } from "@/components/ai-history/quota-usage-card";
import { tDyn } from "@/i18n/dynamic";

// i18n-dynamic: admin.aiHistory.periods.*

const PERIODS = ["7", "30", "90", "all"] as const;
const DEFAULT_FILTERS: AiHistoryFilters = { days: "30", userIds: [], models: [] };

export default function AiHistoryPage() {
  const t = useTranslations("admin.aiHistory");
  const tc = useTranslations("common");
  const { formatDateTime, formatNumber, locale } = useDateFormat();
  const { can, isLoading: permLoading } = usePermissions();
  const allowed = !permLoading && can("pages:ai_history");

  const [filters, setFilters] = useState<AiHistoryFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);
  const [openId, setOpenId] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const options = useAiHistoryFilterOptions(allowed);
  const summary = useAiHistorySummary(filters, allowed);
  const list = useAiHistoryList(filters, page, limit, allowed);
  const purge = usePurgeAiHistory();

  const userItems = useMemo(() => (options.data?.users ?? []).map((u) => ({ id: u.id, name: u.name || t("unknownUser") })), [options.data, t]);
  const modelItems = useMemo(() => (options.data?.models ?? []).map((m) => ({ id: m, name: m })), [options.data]);

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:ai_history")) return <ErrorState code={403} compact showBack={false} />;

  const usd = (value: number) => formatNumber(value, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const update = (patch: Partial<AiHistoryFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };
  const hasFilters = filters.userIds.length > 0 || filters.models.length > 0 || filters.days !== DEFAULT_FILTERS.days;
  const kpis = summary.data?.kpis;
  const rows = list.data?.data ?? [];
  const costByDay = summary.data?.costByDay ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <ListToolbar
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/ai-history/export?${aiHistoryParams(filters)}`} download>
                <Download className="h-4 w-4 mr-1" />
                {t("exportCsv")}
              </a>
            </Button>
            <PermissionButton allowed={can("ai_history:purge")} variant="destructive" size="sm" onClick={() => setPurgeOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t("purge")}
            </PermissionButton>
          </>
        }
      >
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filters.days} onValueChange={(days) => update({ days })}>
          <SelectTrigger size="sm" className="h-8 w-[170px] text-xs" aria-label={t("filters.period")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{tDyn(t, `periods.${p}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FilterMultiSelect label={t("filters.user")} items={userItems} selected={filters.userIds} onChange={(userIds) => update({ userIds })} />
        <FilterMultiSelect label={t("filters.model")} items={modelItems} selected={filters.models} onChange={(models) => update({ models })} />
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}>
            <X className="h-3.5 w-3.5 mr-1" />
            {t("clearFilters")}
          </Button>
        )}
      </ListToolbar>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatsKpiCard title={t("kpis.conversations")} value={kpis?.conversations ?? 0} icon={<MessagesSquare className="h-5 w-5" />} />
        <StatsKpiCard title={t("kpis.messages")} value={kpis?.messages ?? 0} icon={<MessageSquare className="h-5 w-5" />} />
        <StatsKpiCard title={t("kpis.promptTokens")} value={kpis?.promptTokens ?? 0} icon={<ArrowDownToLine className="h-5 w-5" />} />
        <StatsKpiCard title={t("kpis.completionTokens")} value={kpis?.completionTokens ?? 0} icon={<ArrowUpFromLine className="h-5 w-5" />} />
        <StatsKpiCard title={t("kpis.cost")} value={usd(kpis?.costUsd ?? 0)} icon={<Coins className="h-5 w-5" />} />
        <StatsKpiCard
          title={t("kpis.errors")}
          value={kpis?.errors ?? 0}
          icon={kpis?.errors ? <AlertTriangle className="h-5 w-5" /> : <Timer className="h-5 w-5" />}
          hint={t("kpis.averageDuration", { seconds: formatNumber((kpis?.averageDurationMs ?? 0) / 1000, { maximumFractionDigits: 1 }) })}
        />
      </div>

      <ChartCard
        title={t("chart.title")}
        description={t("chart.description")}
        loading={summary.isLoading}
        exportData={costByDay}
        exportColumns={[{ key: "day", header: t("chart.day") }, { key: "costUsd", header: t("chart.cost") }]}
      >
        {costByDay.length === 0 ? (
          <ChartEmpty />
        ) : (
          <ChartContainer height={240}>
            <BarChart data={costByDay} margin={{ left: 10, right: 16, top: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatChartDate(d, locale)} minTickGap={24} />
              <YAxis
                tick={{ fontSize: 11 }}
                width={80}
                tickFormatter={(v: number) => formatNumber(v, { style: "currency", currency: "USD", maximumSignificantDigits: 2 })}
              />
              <Tooltip content={<ChartTooltip kind="currency" currency="USD" />} cursor={{ fillOpacity: 0.08 }} />
              <Bar dataKey="costUsd" name={t("chart.cost")} fill="#7c4dff" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ChartContainer>
        )}
      </ChartCard>

      <section className="space-y-3">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">{t("columns.lastActivity")}</TableHead>
                <TableHead>{t("columns.title")}</TableHead>
                <TableHead>{t("columns.user")}</TableHead>
                <TableHead>{t("columns.models")}</TableHead>
                <TableHead className="text-right">{t("columns.messages")}</TableHead>
                <TableHead className="text-right whitespace-nowrap">{t("columns.tokens")}</TableHead>
                <TableHead className="text-right">{t("columns.cost")}</TableHead>
                <TableHead className="text-right">{t("columns.errors")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{tc("states.loading")}</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{t("empty")}</TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setOpenId(row.id)}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDateTime(row.updatedAt)}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex min-w-[10rem] flex-col items-start gap-1">
                        <button type="button" className="min-w-0 text-left font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(row.id); }}>
                          <TruncatedCell value={row.title} maxWidth="max-w-[15rem]" />
                        </button>
                        {row.deletedAt && <Badge variant="secondary" className="shrink-0 text-[10px]">{t("deletedBadge")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{row.userName || t("unknownUser")}</TableCell>
                    <TableCell className="text-xs">
                      {row.models.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : row.models.length === 1 ? (
                        <TruncatedCell value={row.models[0]} maxWidth="max-w-[11rem]" className="font-mono" />
                      ) : (
                        <UiTooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-muted-foreground underline decoration-dotted">{t("modelsCount", { count: row.models.length })}</span>
                          </TooltipTrigger>
                          <TooltipContent className="font-mono text-xs">{row.models.join(", ")}</TooltipContent>
                        </UiTooltip>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatNumber(row.messages)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                      {formatNumber(row.promptTokens)} <span className="text-muted-foreground">/</span> {formatNumber(row.completionTokens)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">{usd(Number(row.costUsd))}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.errors > 0 ? (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {row.errors}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <ServerPagination
          total={list.data?.total ?? 0}
          page={page}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={(value) => { setLimit(value); setPage(1); }}
        />
      </section>

      <QuotaUsageCard enabled={allowed} />

      <ConversationDetailDialog id={openId} onClose={() => setOpenId(null)} />

      <PurgeBeforeDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title={t("purgeDialog.title")}
        description={t("purgeDialog.description")}
        previewKey="ai-history"
        preview={previewAiHistoryPurge}
        renderPreview={(counts) => (
          <span>
            {t("purgeDialog.preview", { conversations: counts.conversations, messages: counts.messages })}
            {counts.ledgerEntries > 0 && <> {t("purgeDialog.ledger", { count: counts.ledgerEntries })}</>}
          </span>
        )}
        onConfirm={(before) => purge.mutateAsync(before)}
        pending={purge.isPending}
      />
    </div>
  );
}
