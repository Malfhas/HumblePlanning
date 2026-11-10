"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Clock, Database, HardDrive, Package, Radio, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SystemOverview } from "@/hooks/use-system-health";
import { useDateFormat } from "@/hooks/use-date-format";
import { usePermissions } from "@/hooks/use-permissions";
import { useApiErrorMessage } from "@/hooks/use-api-error-message";
import { tDyn } from "@/i18n/dynamic";
import { formatDate, formatTime, getClientDateSettings } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

// i18n-dynamic: admin.systemHealth.alerts.*
// i18n-dynamic: admin.systemHealth.tasks.names.*
// i18n-dynamic: admin.systemHealth.tasks.descriptions.*
// i18n-dynamic: admin.systemHealth.tasks.status.*
// i18n-dynamic: admin.systemHealth.live.version.status.*
// i18n-dynamic: admin.systemHealth.live.backup.status.*

type Tone = "ok" | "warn" | "error" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
  muted: "text-muted-foreground",
};

function StatusCard({ icon, title, tone, value, detail }: { icon: ReactNode; title: string; tone: Tone; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{title}</span>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted", TONE_CLASS[tone])}>{icon}</span>
      </div>
      <p className={cn("mt-2 text-lg font-semibold", TONE_CLASS[tone])}>{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground break-words">{detail}</p>}
    </div>
  );
}

const VERSION_TONE: Record<string, Tone> = {
  up_to_date: "ok",
  update_available: "warn",
  security_update: "error",
  error: "warn",
  disabled: "muted",
  no_release: "muted",
};

/** UTC offset of a time zone at an instant: "UTC+01:00", "UTC" at zero. */
function utcOffset(at: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return (name ?? "GMT").replace("GMT", "UTC");
}

/** Wall-clock date ("YYYY-MM-DD") and time ("HH:mm") of an instant in a time zone. */
function wallClock(at: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Beyond this gap with the clock of the device, the one of the server is likely off (no NTP). */
const CLOCK_DRIFT_MS = 60_000;

/**
 * The clock of the server, in the time zone of the instance (the one of the e-mails, exports and schedules). It
 * ticks with the clock of the device, shifted by the gap measured when the answer arrived.
 */
function ServerClock({ clock, receivedAt }: { clock: SystemOverview["clock"]; receivedAt: number }) {
  const t = useTranslations("admin.systemHealth.live.clock");
  const { locale } = useDateFormat();
  const gapMs = Date.parse(clock.now) - receivedAt;
  const [deviceNow, setDeviceNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setDeviceNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const serverNow = new Date(deviceNow + gapMs);
  const drift = Math.abs(gapMs) >= CLOCK_DRIFT_MS;
  const { date, time } = wallClock(serverNow, clock.timeZone);
  const settings = getClientDateSettings();
  return (
    <StatusCard
      icon={<Clock className="h-5 w-5" />}
      title={t("title")}
      tone={drift ? "warn" : "ok"}
      value={[formatDate(date, locale, settings.dateFormat), formatTime(time, locale, settings.timeFormat)].join(" ")}
      detail={
        <>
          {t("detail", { zone: clock.timeZone, offset: utcOffset(serverNow, clock.timeZone) })}
          {drift && <>{" · "}{t("drift", { minutes: Math.round(Math.abs(gapMs) / 60_000) })}</>}
        </>
      }
    />
  );
}

export function LiveStatus({ data, receivedAt }: { data: SystemOverview; receivedAt: number }) {
  const t = useTranslations("admin.systemHealth.live");
  const { formatDateTime, formatNumber } = useDateFormat();
  const { can } = usePermissions();
  const errorMessage = useApiErrorMessage();
  const { database, realtime, version, backup } = data;
  const backupTone: Tone = !backup ? "muted" : backup.status === "completed" ? "ok" : backup.status === "failed" ? "error" : "warn";
  const megabytes = (bytes: number) => formatNumber(bytes / 1_048_576, { maximumFractionDigits: 1 });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <StatusCard
        icon={<Database className="h-5 w-5" />}
        title={t("database.title")}
        tone={database.ok ? "ok" : "error"}
        value={database.ok ? t("up") : t("down")}
        detail={database.ok ? t("database.latency", { ms: database.latencyMs }) : database.error}
      />
      <StatusCard
        icon={<Radio className="h-5 w-5" />}
        title={t("realtime.title")}
        tone={realtime.ok ? "ok" : "error"}
        value={realtime.ok ? t("up") : t("down")}
        detail={realtime.ok ? t("realtime.clients", { count: realtime.clients ?? 0 }) : realtime.error}
      />
      <StatusCard
        icon={<Package className="h-5 w-5" />}
        title={t("version.title")}
        tone={VERSION_TONE[version.status] ?? "muted"}
        value={`v${version.currentVersion}`}
        detail={
          <>
            {tDyn(t, `version.status.${version.status}`, { version: version.latestVersion ?? "" })}
            {version.updateAvailable && can("pages:settings") && (
              <>
                {" · "}
                <Link href="/settings?tab=version" className="text-primary hover:underline">{t("version.details")}</Link>
              </>
            )}
          </>
        }
      />
      <StatusCard
        icon={<HardDrive className="h-5 w-5" />}
        title={t("backup.title")}
        tone={backupTone}
        value={backup ? tDyn(t, `backup.status.${backup.status}`) : t("backup.none")}
        detail={
          backup
            ? backup.status === "failed" && backup.errorMessage
              ? `${formatDateTime(backup.createdAt)} · ${errorMessage({ code: backup.errorMessage, message: backup.errorMessage })}`
              : t("backup.detail", { date: formatDateTime(backup.createdAt), size: megabytes(backup.sizeBytes) })
            : undefined
        }
      />
      <ServerClock clock={data.clock} receivedAt={receivedAt} />
    </div>
  );
}

export function ConfigAlerts({ alerts }: { alerts: SystemOverview["alerts"] }) {
  const t = useTranslations("admin.systemHealth.alerts");
  if (alerts.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {t("none")}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {alerts.map((id) => (
        <li key={id} className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">{tDyn(t, `${id}.title`)}</p>
            <p className="text-xs text-muted-foreground">{tDyn(t, `${id}.description`) /* i18n-ignore message key (scanner false positive) */}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

type TaskRow = SystemOverview["tasks"][number];

/** One-line summary of what a successful run did, per task. */
function useRunSummary() {
  const t = useTranslations("admin.systemHealth.tasks.summary");
  const { formatNumber } = useDateFormat();
  const errorMessage = useApiErrorMessage();
  return (row: TaskRow): string | null => {
    const detail = row.lastRun?.detail;
    if (!detail) return null;
    // Errors are message codes (AppError) or technical messages
    if (row.lastRun?.success === false) return typeof detail.error === "string" ? errorMessage({ code: detail.error, message: detail.error }) : null;
    switch (row.task) {
      case "daily_purge": {
        const ai = detail.aiHistory as { conversations?: number } | null;
        return t("dailyPurge", { conversations: ai?.conversations ?? 0, events: Number(detail.systemEvents ?? 0) });
      }
      case "backup":
        return t("backup", { size: formatNumber(Number(detail.sizeBytes ?? 0) / 1_048_576, { maximumFractionDigits: 1 }) });
      case "weekly_summary":
        return t("weeklySummary", { sent: Number(detail.sent ?? 0) });
      default:
        return null;
    }
  };
}

export function ScheduledTasks({ tasks }: { tasks: SystemOverview["tasks"] }) {
  const t = useTranslations("admin.systemHealth.tasks");
  const { formatDateTime } = useDateFormat();
  const summary = useRunSummary();

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.task")}</TableHead>
            <TableHead className="whitespace-nowrap">{t("columns.lastRun")}</TableHead>
            <TableHead>{t("columns.result")}</TableHead>
            <TableHead className="whitespace-nowrap">{t("columns.nextRun")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((row) => {
            const run = row.lastRun;
            const status = !run ? "never" : run.success === null ? "running" : run.success ? "success" : "failed";
            const text = summary(row);
            return (
              <TableRow key={row.task}>
                <TableCell className="min-w-[200px]">
                  <p className="text-sm font-medium">{tDyn(t, `names.${row.task}`)}</p>
                  <p className="text-xs text-muted-foreground">{tDyn(t, `descriptions.${row.task}`)}</p>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{run ? formatDateTime(run.startedAt) : "—"}</TableCell>
                <TableCell className="min-w-[180px]">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[11px]",
                      status === "success" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
                      status === "failed" && "border-destructive/50 text-destructive",
                      status === "running" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {status === "failed" ? <XCircle className="h-3 w-3 mr-1" /> : null}
                    {tDyn(t, `status.${status}`)}
                  </Badge>
                  {text && <p className={cn("mt-1 text-xs break-words", status === "failed" ? "text-destructive" : "text-muted-foreground")}>{text}</p>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {!row.enabled ? t("disabled") : row.nextRunAt ? formatDateTime(row.nextRunAt) : row.task === "update_check" ? t("onDemand") : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
