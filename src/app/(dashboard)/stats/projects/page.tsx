"use client";

import { useTranslations } from "next-intl";
import { useStatsProjects } from "@/hooks/use-stats";
import { usePermissions } from "@/hooks/use-permissions";
import { useDateFormat } from "@/hooks/use-date-format";
import { hasDyn, tDyn } from "@/i18n/dynamic";
import { StatsFilterBar } from "@/components/stats/stats-filter-bar";
import { StatsKpiCard } from "@/components/stats/stats-kpi-card";
import { ChartCard } from "@/components/stats/chart-card";
import { ChartEmpty } from "@/components/stats/chart-empty";
import { HoursTooltip } from "@/components/stats/chart-tooltip";
import { formatChartDate } from "@/components/stats/chart-utils";
import { ChartLegend } from "@/components/stats/chart-legend";
import { FolderKanban, Activity, Clock, CheckCircle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area, Legend, ComposedChart, Line, Label,
} from "recharts";
import { ChartContainer } from "@/components/stats/chart-container";

// i18n-dynamic: audit.projectStatus.*

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];
const STATUS_COLORS: Record<string, string> = { todo: "#6b7280", in_progress: "#3b82f6", done: "#10b981", archived: "#f59e0b" };

export default function StatsProjectsPage() {
  const t = useTranslations("stats");
  const tc = useTranslations("common");
  const tAudit = useTranslations("audit");
  const { locale, formatNumber } = useDateFormat();
  const { data, isLoading } = useStatsProjects();
  const { can, isLoading: permLoading } = usePermissions();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:stats_projects")) return <p className="text-center text-muted-foreground p-8">{t("accessDenied")}</p>;

  const fmtDate = (d: string) => formatChartDate(d, locale);
  const fmtTick = (v: number) => formatNumber(v);
  const statusLabel = (status: string) => (hasDyn(tAudit, `projectStatus.${status}`) ? tDyn(tAudit, `projectStatus.${status}`) : status);

  const kpis = data?.kpis;
  const projectProgress = data?.projectProgress ?? [];
  const monthlyBreakdown = data?.monthlyBreakdown ?? [];
  const projectsByStatus = (data?.projectsByStatus ?? []).map((s: { status: string }) => ({ ...s, statusLabel: statusLabel(s.status) }));
  const hoursTimeline = data?.hoursTimeline ?? [];
  const projectNames = projectProgress.slice(0, 8).map((p: any) => p.projectName);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("projects.title")}</h1>

      <StatsFilterBar />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsKpiCard title={t("projects.kpis.projects")} value={kpis?.totalProjects ?? 0} icon={<FolderKanban className="h-5 w-5" />} />
        <StatsKpiCard title={t("projects.kpis.activeProjects")} value={kpis?.activeProjects ?? 0} icon={<Activity className="h-5 w-5" />} />
        <StatsKpiCard title={t("projects.kpis.plannedHours")} value={kpis?.totalPlannedHours ?? 0} suffix="h" icon={<Clock className="h-5 w-5" />} />
        <StatsKpiCard title={t("projects.kpis.globalCompletion")} value={kpis?.globalCompletionRate ?? 0} suffix="%" icon={<CheckCircle className="h-5 w-5" />} />
      </div>

      {/* Progress by project */}
      <ChartCard title={t("projects.progress.title")} description={t("projects.progress.description")} loading={isLoading}
        exportData={projectProgress} exportColumns={[{ key: "projectName", header: t("columns.project") }, { key: "status", header: t("columns.status") }, { key: "budgetHours", header: t("columns.budgetHours") }, { key: "consumedHours", header: t("columns.consumedHours") }, { key: "upcomingHours", header: t("columns.upcomingHours") }, { key: "completionRate", header: t("columns.completionPercent") }]}>
        {projectProgress.length === 0 ? <ChartEmpty /> : (
          <ChartContainer height={Math.max(300, projectProgress.length * 40)}>
            <BarChart
              data={projectProgress.map((p: any) => ({
                ...p,
                remainingHours: Math.max(0, Math.round((p.budgetHours - p.consumedHours - p.upcomingHours) * 100) / 100),
              }))}
              layout="vertical"
              margin={{ left: 10, right: 20, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.15} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtTick}>
                <Label value={t("axis.hours")} position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
              </XAxis>
              <YAxis type="category" dataKey="projectName" width={140} tick={{ fontSize: 11 }} />
              <Tooltip content={<HoursTooltip />} />
              <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              <Bar dataKey="consumedHours" name={t("projects.series.consumed")} stackId="a" fill="#10b981" />
              <Bar dataKey="upcomingHours" name={t("projects.series.upcoming")} stackId="a" fill="#3b82f6" />
              <Bar dataKey="remainingHours" name={t("projects.series.remaining")} stackId="a" fill="#e5e7eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </ChartCard>

      {/* Monthly + Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title={t("projects.monthly.title")} className="lg:col-span-2" loading={isLoading}
          exportData={monthlyBreakdown} exportColumns={[{ key: "date", header: t("columns.period") }, ...projectNames.map((n: string) => ({ key: n, header: n }))]}>
          {monthlyBreakdown.length === 0 ? <ChartEmpty /> : (
            <ChartContainer height={350}>
              <BarChart data={monthlyBreakdown} margin={{ left: 15, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate}>
                  <Label value={t("axis.period")} position="insideBottom" offset={-15} className="fill-muted-foreground text-xs" />
                </XAxis>
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtTick}>
                  <Label value={t("axis.hours")} angle={-90} position="insideLeft" className="fill-muted-foreground text-xs" />
                </YAxis>
                <Tooltip content={<HoursTooltip />} />
                <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
                {projectNames.map((name: string, i: number) => (
                  <Bar key={name} dataKey={name} stackId="a" fill={projectProgress.find((p: any) => p.projectName === name)?.projectColor || COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard title={t("projects.byStatus.title")} loading={isLoading}
          exportData={projectsByStatus} exportColumns={[{ key: "statusLabel", header: t("columns.status") }, { key: "count", header: t("columns.count") }, { key: "totalHours", header: t("columns.hours") }]}>
          {projectsByStatus.length === 0 ? <ChartEmpty /> : (
            <ChartContainer height={300}>
              <PieChart>
                <Pie data={projectsByStatus} dataKey="count" nameKey="statusLabel" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3}>
                  {projectsByStatus.map((s: any, i: number) => (
                    <Cell key={i} fill={STATUS_COLORS[s.status] || COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0];
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-xs">
                      <p className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: d.payload?.fill }} />
                        {d.name}: <span className="font-semibold">{t("projects.byStatus.count", { count: d.value })}</span>
                      </p>
                    </div>
                  );
                }} />
                <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              </PieChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>

      {/* Cumulative hours */}
      <ChartCard title={t("projects.cumulative.title")} description={t("projects.cumulative.description")} loading={isLoading}
        exportData={hoursTimeline} exportColumns={[{ key: "date", header: t("columns.period") }, { key: "consumed", header: t("columns.hoursPerPeriod") }, { key: "cumulative", header: t("columns.cumulative") }]}>
        {hoursTimeline.length === 0 ? <ChartEmpty /> : (
          <ChartContainer height={350}>
            <ComposedChart data={hoursTimeline} margin={{ left: 15, right: 20, top: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate}>
                <Label value={t("axis.period")} position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtTick}>
                <Label value={t("axis.hours")} angle={-90} position="insideLeft" className="fill-muted-foreground text-xs" />
              </YAxis>
              <Tooltip content={<HoursTooltip />} />
              <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              <Area type="monotone" dataKey="consumed" name={t("projects.series.hoursPerPeriod")} fill="#3b82f6" stroke="#3b82f6" fillOpacity={0.3} />
              <Line type="monotone" dataKey="cumulative" name={t("projects.series.cumulative")} stroke="#10b981" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartContainer>
        )}
      </ChartCard>
    </div>
  );
}
