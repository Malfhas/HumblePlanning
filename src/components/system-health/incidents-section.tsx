"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Filter, RefreshCw, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { FilterMultiSelect } from "@/components/shared/filter-multi-select";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { PermissionButton } from "@/components/shared/permission-button";
import { PurgeBeforeDialog } from "@/components/shared/purge-before-dialog";
import { ServerPagination } from "@/components/shared/server-pagination";
import {
  previewSystemEventsPurge,
  usePurgeSystemEvents,
  useSystemEvents,
  type SystemEvent,
  type SystemEventFilters,
} from "@/hooks/use-system-health";
import { useDateFormat } from "@/hooks/use-date-format";
import { usePermissions } from "@/hooks/use-permissions";
import { LOG_CATEGORIES, STORED_LEVELS } from "@/lib/system-health/categories";
import { tDyn } from "@/i18n/dynamic";
import { cn } from "@/lib/utils";

// i18n-dynamic: admin.systemHealth.categories.*
// i18n-dynamic: admin.systemHealth.levels.*
// i18n-dynamic: admin.systemHealth.periods.*

const PERIODS = ["1", "7", "30", "all"] as const;
const DEFAULT_FILTERS: SystemEventFilters = { days: "7", levels: [], categories: [], search: "" };

const LEVEL_CLASS: Record<string, string> = {
  ERROR: "border-destructive/50 bg-destructive/10 text-destructive",
  WARN: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

function EventDetail({ event }: { event: SystemEvent }) {
  const t = useTranslations("admin.systemHealth.incidents.detail");
  const hasMetadata = event.metadata !== null && event.metadata !== undefined && JSON.stringify(event.metadata) !== "{}";
  return (
    <div className="space-y-3 py-1 text-xs">
      <p className="whitespace-pre-wrap break-words text-sm">{event.message}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        {event.route && (
          <>
            <dt className="text-muted-foreground">{t("route")}</dt>
            <dd className="font-mono break-all">{event.method ? `${event.method} ` : ""}{event.route}</dd>
          </>
        )}
        {event.userId && (
          <>
            <dt className="text-muted-foreground">{t("user")}</dt>
            <dd>{event.userName || event.userId}</dd>
          </>
        )}
      </dl>
      {hasMetadata && (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">{t("metadata")}</p>
          <pre className="max-h-60 overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(event.metadata, null, 2)}</pre>
        </div>
      )}
      {event.stack && (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">{t("stack")}</p>
          <pre className="max-h-60 overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px] whitespace-pre text-destructive/90">{event.stack}</pre>
        </div>
      )}
    </div>
  );
}

/** Grouped warnings and errors: filters, expandable detail, server pagination, purge. */
export function IncidentsSection({ enabled }: { enabled: boolean }) {
  const t = useTranslations("admin.systemHealth");
  const tc = useTranslations("common");
  const { formatDateTime, formatNumber } = useDateFormat();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<SystemEventFilters>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const { data, isLoading } = useSystemEvents(filters, page, limit, enabled);
  const purge = usePurgeSystemEvents();

  const levelItems = useMemo(() => STORED_LEVELS.map((id) => ({ id, name: tDyn(t, `levels.${id}`) })), [t]);
  const categoryItems = useMemo(() => LOG_CATEGORIES.map((id) => ({ id, name: tDyn(t, `categories.${id}`) })), [t]);

  const update = (patch: Partial<SystemEventFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };
  const onSearch = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => update({ search: value.trim() }), 400);
  };
  const hasFilters = filters.levels.length > 0 || filters.categories.length > 0 || !!filters.search || filters.days !== DEFAULT_FILTERS.days;
  const events = data?.data ?? [];

  return (
    <div className="space-y-3">
      <ListToolbar
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              title={tc("actions.refresh")}
              aria-label={tc("actions.refresh")}
              onClick={() => queryClient.invalidateQueries({ queryKey: ["system-health"] })}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <PermissionButton allowed={can("system_health:purge")} variant="destructive" size="sm" onClick={() => setPurgeOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t("incidents.purge")}
            </PermissionButton>
          </>
        }
      >
        <Filter className="h-4 w-4 text-muted-foreground" />
        <FilterMultiSelect label={t("incidents.filters.level")} items={levelItems} selected={filters.levels} onChange={(levels) => update({ levels })} />
        <FilterMultiSelect label={t("incidents.filters.category")} items={categoryItems} selected={filters.categories} onChange={(categories) => update({ categories })} />
        <Select value={filters.days} onValueChange={(days) => update({ days })}>
          <SelectTrigger size="sm" className="w-[160px] text-xs" aria-label={t("incidents.filters.period")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{tDyn(t, `periods.${p}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DataTableSearchToggle value={searchInput} onChange={onSearch} />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => { setFilters(DEFAULT_FILTERS); setSearchInput(""); setPage(1); }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            {t("incidents.clearFilters")}
          </Button>
        )}
      </ListToolbar>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{t("incidents.columns.level")}</TableHead>
              <TableHead>{t("incidents.columns.category")}</TableHead>
              <TableHead>{t("incidents.columns.message")}</TableHead>
              <TableHead className="text-right">{t("incidents.columns.occurrences")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("incidents.columns.lastSeen")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("incidents.columns.firstSeen")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">{tc("states.loading")}</TableCell>
              </TableRow>
            ) : events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">{t("incidents.empty")}</TableCell>
              </TableRow>
            ) : (
              events.map((event) => {
                const open = expanded === event.id;
                return (
                  <Fragment key={event.id}>
                    <TableRow className="cursor-pointer" onClick={() => setExpanded(open ? null : event.id)} aria-expanded={open}>
                      <TableCell className="w-8 pr-0">
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[11px]", LEVEL_CLASS[event.level])}>{tDyn(t, `levels.${event.level}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{tDyn(t, `categories.${event.category}`)}</TableCell>
                      <TableCell className="text-sm">
                        <span className="line-clamp-2 min-w-[14rem] max-w-[28rem] break-words">{event.message}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{formatNumber(event.occurrences)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDateTime(event.lastSeenAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDateTime(event.firstSeenAt)}</TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={6} className="whitespace-normal">
                          <EventDetail event={event} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <ServerPagination
        total={data?.total ?? 0}
        page={page}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={(value) => { setLimit(value); setPage(1); }}
      />

      <PurgeBeforeDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title={t("incidents.purgeDialog.title")}
        description={t("incidents.purgeDialog.description")}
        previewKey="system-health"
        preview={previewSystemEventsPurge}
        renderPreview={(counts) => t("incidents.purgeDialog.preview", { count: counts.events })}
        onConfirm={(before) => purge.mutateAsync(before)}
        pending={purge.isPending}
      />
    </div>
  );
}
