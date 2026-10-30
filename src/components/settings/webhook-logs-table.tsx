"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useWebhookLogs } from "@/hooks/use-webhook-logs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Activity, Search } from "lucide-react";
import { useDateFormat } from "@/hooks/use-date-format";

const EVENT_BADGES: Record<string, string> = {
  "email.bounced": "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  "email.complained": "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  "email.delivered": "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  "email.failed": "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  "email.opened": "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  "email.clicked": "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
};

const STATUS_BADGES: Record<string, string> = {
  received: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  processed: "bg-green-500/15 text-green-700 dark:text-green-400",
  error: "bg-red-500/15 text-red-700 dark:text-red-400",
  invalid_signature: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  rate_limited: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

export function WebhookLogsTable() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { intlTag } = useDateFormat();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const { data, isLoading } = useWebhookLogs("nuntly", page);

  const filteredLogs = useMemo(() => {
    if (!data?.data) return [];
    if (!search.trim()) return data.data;
    const q = search.toLowerCase();
    return data.data.filter((log) =>
      log.eventType.toLowerCase().includes(q) ||
      (log.recipient?.toLowerCase().includes(q) ?? false) ||
      log.status.toLowerCase().includes(q) ||
      (log.errorMessage?.toLowerCase().includes(q) ?? false) ||
      (log.eventId?.toLowerCase().includes(q) ?? false)
    );
  }, [data, search]);

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-4 p-4 border-b">
        <div className="flex items-center gap-2 shrink-0">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">{t("webhookLogs.title")}</h4>
          {data && (
            <Badge variant="secondary" className="text-xs">
              {search ? `${filteredLogs.length}/${data.total}` : t("webhookLogs.total", { count: data.total })}
            </Badge>
          )}
        </div>
        {data && data.data.length > 0 && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("webhookLogs.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{tc("states.loading")}</div>
      ) : !data || data.data.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {t("webhookLogs.empty")}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {tc("states.noResultsFor", { search })}
        </div>
      ) : (
        <>
          <div className="max-h-[400px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>{t("webhookLogs.columns.dateTime")}</TableHead>
                <TableHead>{t("webhookLogs.columns.type")}</TableHead>
                <TableHead>{t("webhookLogs.columns.recipient")}</TableHead>
                <TableHead>{t("webhookLogs.columns.status")}</TableHead>
                <TableHead>{t("webhookLogs.columns.error")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {/* seconds matter in a log: the language's short format */}
                    {new Date(log.receivedAt).toLocaleString(intlTag, { dateStyle: "short", timeStyle: "medium" })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={EVENT_BADGES[log.eventType] ?? ""}>
                      {log.eventType}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{log.recipient || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_BADGES[log.status] ?? ""}>
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-red-600 max-w-[200px] truncate" title={log.errorMessage ?? ""}>
                    {log.errorMessage || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t text-xs text-muted-foreground">
              <span>{t("webhookLogs.pageOf", { page, total: totalPages })}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
