"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useAuditLogs, useRestoreAudit, usePurgeAudit, type AuditLog } from "@/hooks/use-audit";
import { useSocket } from "@/hooks/use-socket";
import { socket } from "@/lib/socket-client";
import { useQueryClient } from "@tanstack/react-query";
import { useUsers } from "@/hooks/use-users";
import { useProjects } from "@/hooks/use-projects";
import { useStatuses } from "@/hooks/use-statuses";
import { usePlaces } from "@/hooks/use-places";
import { useResources } from "@/hooks/use-resources";
import { usePermissions } from "@/hooks/use-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { useAuditLabels } from "@/hooks/use-audit-labels";
import { tDyn } from "@/i18n/dynamic";
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw, Search, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PermissionButton } from "@/components/shared/permission-button";
import { cn } from "@/lib/utils";
import {
  ACTION_STYLES,
  getProjectId,
  getUserIds,
  type LookupMaps,
} from "@/lib/constants/audit-labels";
import { RestoreConfirmDialog } from "@/components/shared/restore-confirm-dialog";
import { AuditDetailPopover } from "@/components/shared/audit-detail-popover";
import { FilterDropdown } from "@/components/shared/filter-dropdown";
import { ErrorState } from "@/components/shared/error-state";
import { TruncatedCell } from "@/components/shared/truncated-cell";

// i18n-dynamic: admin.audit.entityFilter.*
// i18n-dynamic: admin.audit.sources.*

/** Filterable entity types (plural labels: `admin.audit.entityFilter.<id>`). */
const ENTITY_FILTER_IDS = [
  "task", "project", "user", "team", "status", "holiday", "qualification",
  "vehicle", "vehicle_type", "resource", "resource_type", "labor_type",
  "project_group", "role", "place", "config", "api_key", "mcp_key", "session",
] as const;

const SOURCE_IDS = ["all", "web", "mcp", "api"] as const;

const ACTION_IDS = Object.keys(ACTION_STYLES);

export default function AuditPage() {
  const t = useTranslations("admin.audit");
  const ta = useTranslations("admin.common");
  const tc = useTranslations("common");
  const { format: formatLocalized, formatDateTime } = useDateFormat();
  const audit = useAuditLabels();
  const entityOptions = ENTITY_FILTER_IDS.map((id) => ({ id, name: tDyn(t, `entityFilter.${id}`) }));
  const sourceOptions = SOURCE_IDS.map((id) => ({ id, name: tDyn(t, `sources.${id}`) }));
  const actionOptions = ACTION_IDS.map((id) => ({ id, name: audit.actionLabel(id) }));
  const { connected } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!connected) return;
    const handleAuditChanged = () => {
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    };
    socket.on("audit:changed", handleAuditChanged);
    return () => {
      socket.off("audit:changed", handleAuditChanged);
    };
  }, [connected, queryClient]);

  const [filterEntityTypes, setFilterEntityTypes] = useState<string[]>([]);
  const [filterActions, setFilterActions] = useState<string[]>([]);
  const [filterUsers, setFilterUsers] = useState<string[]>([]);
  const [filterSource, setFilterSource] = useState<"all" | "web" | "mcp" | "api" | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced server-side search
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
      setPage(1);
    }, 400);
  }, []);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDate, setPurgeDate] = useState("");
  const [purgeDateOpen, setPurgeDateOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ log: AuditLog; entityName: string } | null>(null);

  const { can, isLoading: permLoading } = usePermissions();
  const { data: usersData } = useUsers(undefined, false);
  const { data: projectsData } = useProjects(undefined, true);
  const { data: statusesData } = useStatuses();
  const { data: placesData } = usePlaces();
  const { data: resourcesData } = useResources();
  const restoreAudit = useRestoreAudit();
  const purgeAudit = usePurgeAudit();

  const lookupMaps = useMemo<LookupMaps>(() => {
    const projectMap = new Map<string, string>();
    const userMap = new Map<string, string>();
    const statusMap = new Map<string, string>();
    const placeMap = new Map<string, string>();
    const resourceMap = new Map<string, string>();
    if (projectsData) {
      for (const p of projectsData) projectMap.set(p.id, p.name);
    }
    if (usersData) {
      for (const u of usersData) userMap.set(u.id, [u.firstName, u.name].filter(Boolean).join(" ") || ta("unnamedUser"));
    }
    if (statusesData) {
      for (const s of statusesData) statusMap.set(s.id, s.name);
    }
    if (placesData) {
      for (const p of placesData) placeMap.set(p.id, p.name);
    }
    if (resourcesData) {
      for (const r of resourcesData) resourceMap.set(r.id, r.name);
    }
    return { projectMap, userMap, statusMap, placeMap, resourceMap, entityNameMap: {} as Record<string, string> };
  }, [projectsData, usersData, statusesData, placesData, resourcesData, ta]);

  const userOptions = useMemo(() => {
    if (!usersData) return [];
    return usersData.map((u) => ({
      id: u.id,
      name: [u.firstName, u.name].filter(Boolean).join(" ") || ta("unnamedUser"),
    }));
  }, [usersData, ta]);

  const filters = {
    ...(filterEntityTypes.length > 0 && { entityType: filterEntityTypes.join(",") }),
    ...(filterActions.length > 0 && { action: filterActions.join(",") }),
    ...(filterUsers.length > 0 && { userId: filterUsers.join(",") }),
    ...(dateStart && { dateStart }),
    ...(dateEnd && { dateEnd }),
    ...(searchQuery && { search: searchQuery }),
    ...(filterSource && filterSource !== "all" && { source: filterSource }),
    page,
    limit,
  };

  const { data, isLoading } = useAuditLogs(filters);

  const mapsWithEntities = useMemo<LookupMaps>(() => ({
    ...lookupMaps,
    entityNameMap: data?.entityNames ?? {},
  }), [lookupMaps, data?.entityNames]);

  const logs = data?.data ?? [];

  const handleRestore = useCallback((id: string) => {
    restoreAudit.mutate(id, { onSuccess: () => setRestoreTarget(null) });
  }, [restoreAudit]);

  const cascadeLogs = useMemo(() => {
    if (!restoreTarget) return [];
    const { log: rLog } = restoreTarget;
    const allLogs = data?.data ?? [];
    const sameLogs = allLogs.filter(
      (l) => l.entityType === rLog.entityType && l.entityId === rLog.entityId
    );
    const logIndex = sameLogs.findIndex((l) => l.id === rLog.id);
    return logIndex > 0 ? sameLogs.slice(0, logIndex) : [];
  }, [restoreTarget, data?.data]);

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;
  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:audit")) return <ErrorState code={403} compact showBack={false} />;
  const canRestoreAudit = can("audit:restore");
  const hasFilters = filterEntityTypes.length > 0 || filterActions.length > 0 || filterUsers.length > 0 || filterSource || searchQuery || dateStart || dateEnd;

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {!can("audit:purge") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="destructive" size="sm" disabled>{t("purge")}</Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{ta("permissionDenied")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setPurgeOpen(true)}>{t("purge")}</Button>
        )}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tc("actions.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="h-9 pl-8 w-[220px]"
          />
        </div>

        <FilterDropdown
          label={t("filters.type")}
          options={entityOptions}
          selected={filterEntityTypes}
          onChange={(v) => { setFilterEntityTypes(v); setPage(1); }}
        />

        <FilterDropdown
          label={t("filters.action")}
          options={actionOptions}
          selected={filterActions}
          onChange={(v) => { setFilterActions(v); setPage(1); }}
        />

        <FilterDropdown
          label={t("filters.user")}
          options={userOptions}
          selected={filterUsers}
          onChange={(v) => { setFilterUsers(v); setPage(1); }}
        />

        <FilterDropdown
          label={t("filters.source")}
          options={sourceOptions}
          selected={filterSource ? [filterSource] : []}
          onChange={(v) => { setFilterSource((v[0] || "") as typeof filterSource); setPage(1); }}
        />

        <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("h-9 justify-start text-left font-normal", !dateStart && "text-muted-foreground")}>
              <CalendarDays className="mr-2 h-4 w-4" />
              {dateStart ? formatLocalized(parseISO(dateStart), "d MMM yyyy") : t("filters.start")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateStart ? parseISO(dateStart) : undefined} onSelect={(date) => { setDateStart(date ? format(date, "yyyy-MM-dd") : ""); setStartDateOpen(false); setPage(1); }} weekStartsOn={1} />
          </PopoverContent>
        </Popover>

        <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("h-9 justify-start text-left font-normal", !dateEnd && "text-muted-foreground")}>
              <CalendarDays className="mr-2 h-4 w-4" />
              {dateEnd ? formatLocalized(parseISO(dateEnd), "d MMM yyyy") : t("filters.end")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateEnd ? parseISO(dateEnd) : undefined} onSelect={(date) => { setDateEnd(date ? format(date, "yyyy-MM-dd") : ""); setEndDateOpen(false); setPage(1); }} weekStartsOn={1} />
          </PopoverContent>
        </Popover>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-muted-foreground"
            onClick={() => { setFilterEntityTypes([]); setFilterActions([]); setFilterUsers([]); setFilterSource(""); setSearchInput(""); setSearchQuery(""); setDateStart(""); setDateEnd(""); setPage(1); }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            {t("clearFilters")}
          </Button>
        )}
      </div>

      {/* Flat table */}
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <div className="rounded-md border flex-1 min-h-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap sticky top-0 z-10 bg-background">{t("columns.date")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("columns.action")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("columns.type")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("columns.item")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("columns.summary")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("columns.concerned")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("columns.by")}</TableHead>
                <TableHead className="w-[76px] sticky top-0 right-0 z-20 bg-background border-l" />

              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    {tc("states.loading")}
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    {tc("table.noResults")}
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => {
                  const actionInfo = { label: audit.actionLabel(log.action), className: audit.actionClassName(log.action) };
                  const entityLabel = audit.entityLabel(log.entityType);
                  const entityName = audit.getEntityName(log, mapsWithEntities);
                  const projectId = getProjectId(log);
                  const summary = audit.formatChanges(log, mapsWithEntities);
                  const concernedIds = getUserIds(log);
                  const concernedNames = concernedIds
                    .map((uid) => mapsWithEntities.userMap.get(uid))
                    .filter(Boolean)
                    .join(", ");
                  // Action intrinsically restorable (action type + has oldValues)
                  const isActionRestorable =
                    (log.action === "update" || log.action === "delete" || log.action === "move" || log.action === "resize")
                    && !!log.oldValues;

                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.timestamp)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(actionInfo.className, "text-[11px]")}>
                          {actionInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entityLabel}</TableCell>
                      <TableCell className="text-sm">
                        <div className="flex flex-col min-w-0">
                          <TruncatedCell value={entityName} maxWidth="max-w-[200px]" className="font-medium" />
                          {projectId && (
                            <TruncatedCell value={mapsWithEntities.projectMap.get(projectId)} maxWidth="max-w-[200px]" className="text-xs text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <TruncatedCell value={summary} maxWidth="max-w-[300px]" />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <TruncatedCell value={concernedNames} maxWidth="max-w-[150px]" />
                      </TableCell>
                      <TableCell className="text-sm">
                        <TruncatedCell
                          value={log.user ? [(log.user as any).firstName, log.user.name].filter(Boolean).join(" ") : null}
                          maxWidth="max-w-[160px]"
                        />
                      </TableCell>
                      <TableCell className="sticky right-0 bg-background z-10 border-l">
                        <div className="flex items-center gap-1 justify-end">
                          <AuditDetailPopover log={log} maps={mapsWithEntities} />
                          {isActionRestorable ? (
                            <PermissionButton
                              allowed={canRestoreAudit}
                              tooltipAllowed={tc("actions.restore")}
                              onClick={() => setRestoreTarget({ log, entityName })}
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </PermissionButton>
                          ) : (
                            <span className="h-7 w-7 inline-block" aria-hidden />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination — same look as DataTable */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{ta("total", { count: data?.total ?? 0 })}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{ta("perPage")}</span>
              <Select
                value={String(limit)}
                onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50, 100].map((size) => (
                    <SelectItem key={size} value={String(size)} className="text-xs">
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p - 1)}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2">
                {page} / {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Restore confirm dialog */}
      <RestoreConfirmDialog
        log={restoreTarget?.log ?? null}
        entityName={restoreTarget?.entityName ?? "—"}
        onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}
        onConfirm={handleRestore}
        isPending={restoreAudit.isPending}
        maps={mapsWithEntities}
        cascadeLogs={cascadeLogs}
      />

      {/* Purge dialog */}
      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("purgeDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("purgeDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <Popover open={purgeDateOpen} onOpenChange={setPurgeDateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !purgeDate && "text-muted-foreground")}>
                <CalendarDays className="mr-2 h-4 w-4" />
                {purgeDate ? formatLocalized(parseISO(purgeDate), "d MMMM yyyy") : t("purgeDialog.datePlaceholder")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={purgeDate ? parseISO(purgeDate) : undefined} onSelect={(date) => { setPurgeDate(date ? format(date, "yyyy-MM-dd") : ""); setPurgeDateOpen(false); }} weekStartsOn={1} />
            </PopoverContent>
          </Popover>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeAudit.isPending}>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!purgeDate || purgeAudit.isPending}
              onClick={() => { purgeAudit.mutate(purgeDate, { onSuccess: () => { setPurgeOpen(false); setPurgeDate(""); } }); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >{t("purge")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
