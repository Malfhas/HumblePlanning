"use client";

import { useTranslations } from "next-intl";
import { useStatsUsers } from "@/hooks/use-stats";
import { usePermissions } from "@/hooks/use-permissions";
import { useDateFormat } from "@/hooks/use-date-format";
import { StatsFilterBar } from "@/components/stats/stats-filter-bar";
import { StatsKpiCard } from "@/components/stats/stats-kpi-card";
import { ChartCard } from "@/components/stats/chart-card";
import { ChartEmpty } from "@/components/stats/chart-empty";
import { HoursTooltip, PercentTooltip } from "@/components/stats/chart-tooltip";
import { formatChartDate } from "@/components/stats/chart-utils";
import { ChartLegend } from "@/components/stats/chart-legend";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, TrendingUp, Percent, CalendarDays, Target } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area, Legend, Label,
  ReferenceLine,
} from "recharts";
import { ChartContainer } from "@/components/stats/chart-container";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6"];

function occupancyColor(rate: number) {
  if (rate > 100) return "#ef4444";
  if (rate > 85) return "#f59e0b";
  if (rate > 50) return "#10b981";
  return "#94a3b8";
}

// i18n-dynamic: stats.users.occupancyLevel.*
function occupancyLevel(rate: number) {
  if (rate > 100) return "overload" as const;
  if (rate > 85) return "high" as const;
  if (rate > 50) return "normal" as const;
  return "low" as const;
}

export default function StatsUsersPage() {
  const t = useTranslations("stats");
  const tc = useTranslations("common");
  const { locale, formatNumber } = useDateFormat();
  const { data, isLoading } = useStatsUsers();
  const { can, isLoading: permLoading } = usePermissions();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:stats_users")) return <ErrorState code={403} compact showBack={false} />;

  const fmtDate = (d: string) => formatChartDate(d, locale);
  const fmtTick = (v: number) => formatNumber(v);
  const fmtHours = (h: number) => `${formatNumber(h)}h`;

  const kpis = data?.kpis;
  const hoursByUser = data?.hoursByUser ?? [];
  const hoursByTeam = (data?.hoursByTeam ?? []).map((tm: { teamName: string | null }) => ({ ...tm, teamName: tm.teamName ?? t("noTeam") }));
  const hoursByLaborType = (data?.hoursByLaborType ?? []).map((lt: { laborTypeName: string | null }) => ({ ...lt, laborTypeName: lt.laborTypeName ?? tc("states.unknown") }));
  const workloadTimeline = data?.workloadTimeline ?? [];
  const userNames = hoursByUser.slice(0, 10).map((u: any) => u.userName);
  const capacityHours = hoursByUser.length > 0 ? hoursByUser[0].capacityHours : 0;

  // Chart data: workload vs capacity side by side
  const chargeVsCapacity = hoursByUser.map((u: any) => ({
    userName: u.userName,
    planned: u.totalHours,
    capacity: u.capacityHours,
    available: Math.max(0, u.capacityHours - u.totalHours),
    surplus: Math.max(0, u.totalHours - u.capacityHours),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("users.title")}</h1>

      <StatsFilterBar />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatsKpiCard title={t("users.kpis.activeUsers")} value={kpis?.totalUsers ?? 0} icon={<Users className="h-5 w-5" />} />
        <StatsKpiCard title={t("users.kpis.plannedHours")} value={kpis?.totalHoursWorked ?? 0} suffix="h" icon={<Clock className="h-5 w-5" />} />
        <StatsKpiCard title={t("users.kpis.avgPerUser")} value={kpis?.avgHoursPerUser ?? 0} suffix="h" icon={<TrendingUp className="h-5 w-5" />} />
        <StatsKpiCard title={t("users.kpis.avgOccupancy")} value={kpis?.avgOccupancyRate ?? 0} suffix="%" icon={<Percent className="h-5 w-5" />} />
        <StatsKpiCard title={t("users.kpis.capacityPerUser")} value={Math.round(capacityHours * 10) / 10} suffix="h" icon={<Target className="h-5 w-5" />} />
        <StatsKpiCard title={t("users.kpis.totalCapacity")} value={Math.round(capacityHours * (kpis?.totalUsers ?? 0) * 10) / 10} suffix="h" icon={<CalendarDays className="h-5 w-5" />} />
      </div>

      {/* Workload vs Capacity */}
      <ChartCard title={t("users.chargeVsCapacity.title")} description={t("users.chargeVsCapacity.description")} loading={isLoading}
        exportData={hoursByUser} exportColumns={[{ key: "userName", header: t("columns.user") }, { key: "teamName", header: t("columns.team") }, { key: "totalHours", header: t("columns.plannedHours") }, { key: "capacityHours", header: t("columns.capacity") }, { key: "occupancyRate", header: t("columns.occupancyPercent") }]}>
        {hoursByUser.length === 0 ? <ChartEmpty /> : (
          <ChartContainer height={Math.max(300, chargeVsCapacity.length * 40)}>
            <BarChart data={chargeVsCapacity} layout="vertical" margin={{ left: 10, right: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.15} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtTick}>
                <Label value={t("axis.hours")} position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
              </XAxis>
              <YAxis type="category" dataKey="userName" width={120} tick={{ fontSize: 11 }} />
              <Tooltip content={<HoursTooltip />} />
              <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              <Bar dataKey="planned" name={t("users.series.planned")} fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={14} />
              <Bar dataKey="capacity" name={t("users.series.capacity")} fill="#e2e8f0" radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ChartContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Occupancy rate */}
        <ChartCard title={t("users.occupancy.title")} description={t("users.occupancy.description")} loading={isLoading}
          exportData={hoursByUser} exportColumns={[{ key: "userName", header: t("columns.user") }, { key: "occupancyRate", header: t("columns.occupancyPercent") }]}>
          {hoursByUser.length === 0 ? <ChartEmpty /> : (
            <ChartContainer height={Math.max(300, hoursByUser.length * 36)}>
              <BarChart data={hoursByUser} layout="vertical" margin={{ left: 10, right: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.15} />
                <XAxis type="number" domain={[0, (max: number) => Math.max(120, max + 10)]} tick={{ fontSize: 11 }} tickFormatter={fmtTick}>
                  <Label value="%" position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
                </XAxis>
                <YAxis type="category" dataKey="userName" width={120} tick={{ fontSize: 11 }} />
                <Tooltip content={<PercentTooltip />} />
                <ReferenceLine x={100} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: "100%", position: "top", fontSize: 10, fill: "#ef4444" }} />
                <Bar dataKey="occupancyRate" name={t("users.series.occupancy")} radius={[0, 4, 4, 0]}>
                  {hoursByUser.map((_: any, i: number) => (
                    <Cell key={i} fill={occupancyColor(hoursByUser[i].occupancyRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Summary table */}
        <ChartCard title={t("users.detail.title")} description={t("users.detail.description")} loading={isLoading}
          exportData={hoursByUser} exportColumns={[{ key: "userName", header: t("columns.user") }, { key: "teamName", header: t("columns.team") }, { key: "totalHours", header: t("columns.planned") }, { key: "capacityHours", header: t("columns.capacity") }, { key: "occupancyRate", header: t("columns.occupancyPercent") }]}>
          {hoursByUser.length === 0 ? <ChartEmpty /> : (
            <div className="overflow-auto max-h-[400px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t("columns.user")}</th>
                    <th className="py-2 pr-3 font-medium">{t("columns.team")}</th>
                    <th className="py-2 pr-3 font-medium text-right">{t("columns.planned")}</th>
                    <th className="py-2 pr-3 font-medium text-right">{t("columns.capacity")}</th>
                    <th className="py-2 pr-3 font-medium text-right">{t("users.detail.available")}</th>
                    <th className="py-2 font-medium text-right">{t("users.detail.occupancy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursByUser.map((u: any) => {
                    const available = Math.max(0, u.capacityHours - u.totalHours);
                    return (
                      <tr key={u.userId} className="border-b border-border/30 hover:bg-accent/30">
                        <td className="py-2 pr-3 font-medium">{u.userName}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{u.teamName ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtHours(u.totalHours)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{fmtHours(u.capacityHours)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{available > 0 ? fmtHours(Math.round(available * 10) / 10) : "—"}</td>
                        <td className="py-2 text-right">
                          <Badge
                            variant="outline"
                            className="tabular-nums text-xs"
                            style={{ borderColor: occupancyColor(u.occupancyRate), color: occupancyColor(u.occupancyRate) }}
                          >
                            {formatNumber(u.occupancyRate)}% · {t(`users.occupancyLevel.${occupancyLevel(u.occupancyRate)}`)}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Timeline */}
      <ChartCard title={t("users.timeline.title")} description={t("users.timeline.description")} loading={isLoading}
        exportData={workloadTimeline} exportColumns={[{ key: "date", header: t("columns.period") }, ...userNames.map((n: string) => ({ key: n, header: n }))]}>
        {workloadTimeline.length === 0 ? <ChartEmpty /> : (
          <ChartContainer height={350}>
            <AreaChart data={workloadTimeline} margin={{ left: 15, right: 20, top: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate}>
                <Label value={t("axis.period")} position="insideBottom" offset={-5} className="fill-muted-foreground text-xs" />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtTick}>
                <Label value={t("axis.hours")} angle={-90} position="insideLeft" className="fill-muted-foreground text-xs" />
              </YAxis>
              <Tooltip content={<HoursTooltip />} />
              <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              {userNames.map((name: string, i: number) => (
                <Area key={name} type="monotone" dataKey={name} stackId="1" fill={COLORS[i % COLORS.length]} stroke={COLORS[i % COLORS.length]} fillOpacity={0.6} />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title={t("users.byTeam.title")} loading={isLoading}
          exportData={hoursByTeam} exportColumns={[{ key: "teamName", header: t("columns.team") }, { key: "totalHours", header: t("columns.hours") }, { key: "userCount", header: t("columns.users") }]}>
          {hoursByTeam.length === 0 ? <ChartEmpty /> : (
            <ChartContainer height={300}>
              <PieChart>
                <Pie data={hoursByTeam} dataKey="totalHours" nameKey="teamName" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {hoursByTeam.map((tm: any, i: number) => (
                    <Cell key={i} fill={tm.teamColor || COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<HoursTooltip />} />
                <Legend content={<ChartLegend />} verticalAlign="top" height={30} />
              </PieChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard title={t("users.byLaborType.title")} loading={isLoading}
          exportData={hoursByLaborType} exportColumns={[{ key: "laborTypeName", header: t("columns.laborType") }, { key: "initials", header: t("columns.initials") }, { key: "totalHours", header: t("columns.hours") }]}>
          {hoursByLaborType.length === 0 ? <ChartEmpty /> : (
            <ChartContainer height={300}>
              <BarChart data={hoursByLaborType} margin={{ left: 15, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="initials" tick={{ fontSize: 11 }}>
                  <Label value={t("axis.laborType")} position="insideBottom" offset={-15} className="fill-muted-foreground text-xs" />
                </XAxis>
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtTick}>
                  <Label value={t("axis.hours")} angle={-90} position="insideLeft" className="fill-muted-foreground text-xs" />
                </YAxis>
                <Tooltip content={<HoursTooltip />} />
                <Bar dataKey="totalHours" name={t("users.series.hours")} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
