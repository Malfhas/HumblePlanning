"use client";

import { useTranslations } from "next-intl";
import { useStatsRoi } from "@/hooks/use-stats";
import { usePermissions } from "@/hooks/use-permissions";
import { useDateFormat } from "@/hooks/use-date-format";
import { StatsFilterBar } from "@/components/stats/stats-filter-bar";
import { StatsKpiCard } from "@/components/stats/stats-kpi-card";
import { ChartCard } from "@/components/stats/chart-card";
import { ChartEmpty } from "@/components/stats/chart-empty";
import { CurrencyTooltip } from "@/components/stats/chart-tooltip";
import { formatChartDate } from "@/components/stats/chart-utils";
import { ChartLegend } from "@/components/stats/chart-legend";
import { Euro, TrendingUp, TrendingDown, Percent, DollarSign, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area, Legend, ComposedChart, Line, Label,
} from "recharts";
import { ChartContainer } from "@/components/stats/chart-container";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export default function StatsRoiPage() {
  const t = useTranslations("stats");
  const tc = useTranslations("common");
  const { locale, formatNumber } = useDateFormat();
  const { data, isLoading } = useStatsRoi();
  const { can, isLoading: permLoading } = usePermissions();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:stats_roi")) return <p className="text-center text-muted-foreground p-8">{t("accessDenied")}</p>;

  const formatEur = (n: number) => formatNumber(n, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtDate = (d: string) => formatChartDate(d, locale);
  const fmtThousands = (v: number) => `${formatNumber(v / 1000, { maximumFractionDigits: 0 })}k`;
  const withLaborTypeName = <T extends { laborTypeName: string | null }>(rows: T[]) =>
    rows.map((r) => ({ ...r, laborTypeName: r.laborTypeName ?? tc("states.unknown") }));

  const kpis = data?.kpis;
  const profitByProject = data?.profitByProject ?? [];
  const roiTimeline = data?.roiTimeline ?? [];
  const costByLaborType = withLaborTypeName(data?.costByLaborType ?? []);
  const costByUser = data?.costByUser ?? [];
  const profitColumns = [{ key: "projectName", header: t("columns.project") }, { key: "budgetAmount", header: t("columns.budgetEur") }, { key: "laborCost", header: t("columns.laborCostEur") }, { key: "profit", header: t("columns.profitEur") }, { key: "profitMargin", header: t("columns.marginPercent") }];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("roi.title")}</h1>

      <StatsFilterBar />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKpiCard title={t("roi.kpis.revenue")} value={formatEur(kpis?.totalRevenue ?? 0)} icon={<Euro className="h-5 w-5" />} />
        <StatsKpiCard title={t("roi.kpis.totalLaborCost")} value={formatEur(kpis?.totalCost ?? 0)} icon={<Receipt className="h-5 w-5" />} />
        <StatsKpiCard
          title={t("roi.kpis.grossProfit")}
          value={formatEur(kpis?.totalProfit ?? 0)}
          icon={(kpis?.totalProfit ?? 0) >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          className={(kpis?.totalProfit ?? 0) < 0 ? "border-red-200 dark:border-red-800" : ""}
        />
        <StatsKpiCard title={t("roi.kpis.avgMargin")} value={kpis?.avgProfitMargin ?? 0} suffix="%" icon={<Percent className="h-5 w-5" />} />
      </div>

      {/* Profit by project */}
      <ChartCard title={t("roi.profitByProject.title")} description={t("roi.profitByProject.description")} loading={isLoading}
        exportData={profitByProject} exportColumns={profitColumns}>
        {profitByProject.length === 0 ? <ChartEmpty /> : (
          <ChartContainer height={Math.max(300, profitByProject.length * 45)}>
            <BarChart data={profitByProject} layout="vertical" margin={{ left: 10, right: 30, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.15} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtThousands}>
                <Label value={t("axis.euros")} position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
              </XAxis>
              <YAxis type="category" dataKey="projectName" width={140} tick={{ fontSize: 11 }} />
              <Tooltip content={<CurrencyTooltip />} />
              <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              <Bar dataKey="budgetAmount" name={t("roi.series.budget")} fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="totalCost" name={t("roi.series.cost")} fill="#ef4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </ChartCard>

      {/* ROI timeline */}
      <ChartCard title={t("roi.costTimeline.title")} description={t("roi.costTimeline.description")} loading={isLoading}
        exportData={roiTimeline} exportColumns={[{ key: "month", header: t("columns.month") }, { key: "cost", header: t("columns.costEur") }, { key: "cumulativeCost", header: t("columns.cumulativeEur") }]}>
        {roiTimeline.length === 0 ? <ChartEmpty /> : (
          <ChartContainer height={350}>
            <ComposedChart data={roiTimeline} margin={{ left: 15, right: 20, top: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={fmtDate}>
                <Label value={t("axis.period")} position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtThousands}>
                <Label value={t("axis.euros")} angle={-90} position="insideLeft" offset={10} className="fill-muted-foreground text-xs" />
              </YAxis>
              <Tooltip content={<CurrencyTooltip />} />
              <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              <Area type="monotone" dataKey="cost" name={t("roi.series.costPerMonth")} fill="#ef4444" stroke="#ef4444" fillOpacity={0.2} />
              <Line type="monotone" dataKey="cumulativeCost" name={t("roi.series.cumulative")} stroke="#6366f1" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by labor type */}
        <ChartCard title={t("roi.costByLaborType.title")} loading={isLoading}
          exportData={costByLaborType} exportColumns={[{ key: "laborTypeName", header: t("columns.laborType") }, { key: "hours", header: t("columns.hours") }, { key: "avgRate", header: t("columns.avgRate") }, { key: "totalCost", header: t("columns.costEur") }]}>
          {costByLaborType.length === 0 ? <ChartEmpty /> : (
            <ChartContainer height={300}>
              <PieChart>
                <Pie data={costByLaborType} dataKey="totalCost" nameKey="laborTypeName" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3}>
                  {costByLaborType.map((_: unknown, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CurrencyTooltip />} />
                <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              </PieChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Cost by user */}
        <ChartCard title={t("roi.costByUser.title")} loading={isLoading}
          exportData={costByUser} exportColumns={[{ key: "userName", header: t("columns.user") }, { key: "hours", header: t("columns.hours") }, { key: "totalCost", header: t("columns.costEur") }, { key: "projectCount", header: t("columns.projects") }]}>
          {costByUser.length === 0 ? <ChartEmpty /> : (
            <ChartContainer height={Math.max(300, costByUser.length * 36)}>
              <BarChart data={costByUser.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.15} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${formatNumber(v / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`}>
                  <Label value={t("axis.euros")} position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
                </XAxis>
                <YAxis type="category" dataKey="userName" width={120} tick={{ fontSize: 11 }} />
                <Tooltip content={<CurrencyTooltip />} />
                <Bar dataKey="totalCost" name={t("roi.series.cost")} fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>

      {/* Summary table */}
      <ChartCard title={t("roi.summary.title")} loading={isLoading}
        exportData={profitByProject} exportColumns={profitColumns}>
        {profitByProject.length === 0 ? <ChartEmpty /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2.5 font-medium">{t("roi.summary.columns.project")}</th>
                  <th className="text-right px-3 py-2.5 font-medium">{t("roi.summary.columns.budget")}</th>
                  <th className="text-right px-3 py-2.5 font-medium">{t("roi.summary.columns.laborCost")}</th>
                  <th className="text-right px-3 py-2.5 font-medium">{t("roi.summary.columns.profit")}</th>
                  <th className="text-right px-3 py-2.5 font-medium">{t("roi.summary.columns.margin")}</th>
                </tr>
              </thead>
              <tbody>
                {profitByProject.map((p: any) => (
                  <tr key={p.projectId} className="border-b">
                    <td className="px-3 py-2.5 font-medium">{p.projectName}</td>
                    <td className="text-right px-3 py-2.5">{formatEur(p.budgetAmount)}</td>
                    <td className="text-right px-3 py-2.5">{formatEur(p.laborCost)}</td>
                    <td className={`text-right px-3 py-2.5 font-medium ${p.profit < 0 ? "text-red-500" : "text-emerald-500"}`}>
                      {formatEur(p.profit)}
                    </td>
                    <td className="text-right px-3 py-2.5">
                      <Badge variant={p.profitMargin < 0 ? "destructive" : "outline"} className="text-xs">
                        {formatNumber(p.profitMargin)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 font-semibold border-t-2">
                  <td className="px-3 py-2.5">{tc("table.total")}</td>
                  <td className="text-right px-3 py-2.5">{formatEur(kpis?.totalRevenue ?? 0)}</td>
                  <td className="text-right px-3 py-2.5">{formatEur(kpis?.totalCost ?? 0)}</td>
                  <td className={`text-right px-3 py-2.5 ${(kpis?.totalProfit ?? 0) < 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {formatEur(kpis?.totalProfit ?? 0)}
                  </td>
                  <td className="text-right px-3 py-2.5">
                    <Badge variant={(kpis?.avgProfitMargin ?? 0) < 0 ? "destructive" : "outline"} className="text-xs">
                      {formatNumber(kpis?.avgProfitMargin ?? 0)}%
                    </Badge>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
