"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useBuStore } from "@/stores/bu-store";
import { usePlanningStore } from "@/stores/planning-store";
import { type ColumnDef } from "@tanstack/react-table";
import { toDateString } from "@/lib/utils/dates";
import { useDateFormat } from "@/hooks/use-date-format";
import { useTasks, useDeleteTask, useRemoveUserFromTask } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { useUsers } from "@/hooks/use-users";
import { useStatuses } from "@/hooks/use-statuses";
import { useTeams } from "@/hooks/use-teams";
import { useConfig } from "@/hooks/use-config";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DataTable,
  sortableHeader,
} from "@/components/shared/data-table";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskFormDialog } from "@/components/planning/task-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { FilterMultiSelect, type FilterItem } from "@/components/shared/filter-multi-select";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Pencil, Trash2, Plus, UserMinus, Eye, X, Filter } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { usePermissions } from "@/hooks/use-permissions";
import type { TaskWithUsers } from "@/types";
import { ErrorState } from "@/components/shared/error-state";

type Task = TaskWithUsers;

// --- Page ---
export default function TasksPage() {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const { formatDate, formatTime, formatNumber } = useDateFormat();
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);

  // Delete states
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [multiDeleteTask, setMultiDeleteTask] = useState<Task | null>(null);
  const [removeUserTask, setRemoveUserTask] = useState<Task | null>(null);

  // Filter states
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([]);
  const [filterStatusIds, setFilterStatusIds] = useState<string[]>([]);
  const [filterUserIds, setFilterUserIds] = useState<string[]>([]);
  const [filterTeamIds, setFilterTeamIds] = useState<string[]>([]);
  const [taskLimit, setTaskLimit] = useState(500);
  const [searchValue, setSearchValue] = useState("");

  // Shared date range with /planning (same Zustand store + localStorage key)
  const startDate = usePlanningStore((s) => s.startDate);
  const endDate = usePlanningStore((s) => s.endDate);
  const setDateRange = usePlanningStore((s) => s.setDateRange);
  const initFromConfig = usePlanningStore((s) => s.initFromConfig);

  const { data: config } = useConfig();
  const configInit = useRef(false);
  useEffect(() => {
    if (configInit.current || !config) return;
    const raw = config.DEFAULT_NB_MONTHS_DISPLAYED;
    const months = raw ? parseInt(raw as string, 10) : 2;
    if (!isNaN(months) && months > 0) initFromConfig(months);
    configInit.current = true;
  }, [config, initFromConfig]);

  const { data: tasksData, isLoading } = useTasks({
    page: 1,
    limit: taskLimit,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
  });
  const deleteTask = useDeleteTask();
  const removeUserFromTask = useRemoveUserFromTask();
  const { can, userId, user, userScope, canCreateAnyTask, canModifyTask, canDeleteTask, isLoading: permLoading } = usePermissions();

  // Data for filters
  const { data: allProjects } = useProjects();
  const { data: allStatuses } = useStatuses();
  const { data: allUsers } = useUsers(undefined, true);
  const { data: allTeams } = useTeams();

  const defaultStartTime = config?.AM_START || "08:00";
  const defaultEndTime = config?.PM_END || "17:00";
  const { selectedBuIds } = useBuStore();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:tasks")) return <ErrorState code={403} compact showBack={false} />;

  const hasAnyFilter = filterProjectIds.length + filterStatusIds.length + filterUserIds.length + filterTeamIds.length > 0;

  // Permission-filtered options for dropdowns
  const teamOptions: FilterItem[] = (() => {
    if (!allTeams) return [];
    if (userScope === "team") {
      const myTeamId = user?.teamId;
      if (myTeamId) return allTeams.filter((t: any) => t.id === myTeamId).map((t: any) => ({ id: t.id, name: t.name, color: t.color }));
    }
    return allTeams.map((t: any) => ({ id: t.id, name: t.name, color: t.color }));
  })();

  const userOptions: FilterItem[] = (() => {
    if (!allUsers) return [];
    let filtered = allUsers as any[];
    if (userScope === "self") {
      filtered = filtered.filter(u => u.id === userId);
    } else if (userScope === "team") {
      const myTeamId = user?.teamId;
      if (myTeamId) filtered = filtered.filter(u => u.teamId === myTeamId);
    }
    return filtered.map(u => ({ id: u.id, name: u.displayName || u.name, color: null }));
  })();

  const projectOptions: FilterItem[] = (allProjects ?? [])
    .filter((p: any) => p.status !== "archived")
    .map((p: any) => ({ id: p.id, name: p.name, color: p.color }));

  const statusOptions: FilterItem[] = (allStatuses ?? [])
    .map((s: any) => ({ id: s.id, name: s.name, color: s.color }));

  // Permission-based task visibility + filters
  const allTasks: Task[] = tasksData?.data ?? [];

  const filteredTasks = (() => {
    let result = allTasks;

    // Global BU filter from header selector — show task if project OR any assigned user belongs to selected BU
    if (selectedBuIds.length > 0) {
      // Build a project→BU lookup from the projects list (more reliable than t.project which may be partial)
      const projectBuMap = new Map<string, string | null>();
      for (const p of (allProjects ?? []) as any[]) {
        projectBuMap.set(p.id, p.businessUnitId ?? p.businessUnit?.id ?? null);
      }
      result = result.filter(t => {
        const projectBuId = projectBuMap.get(t.projectId) ?? t.project?.businessUnitId ?? null;
        const projectMatch = projectBuId ? selectedBuIds.includes(projectBuId) : false;
        const userMatch = t.users?.some(u => u.businessUnitId && selectedBuIds.includes(u.businessUnitId)) ?? false;
        return projectMatch || userMatch;
      });
    }

    // Permission visibility (derived from userScope) — must match backend filter in
    // task-service getTasks: task visible ONLY IF at least one assigned user is visible.
    // No orphan tasks, no creator-based visibility for scope-restricted users.
    if (userScope === "self") {
      result = result.filter(t => t.users?.some(u => u.id === userId) ?? false);
    } else if (userScope === "team") {
      const myTeamId = user?.teamId;
      if (myTeamId) {
        const teamUserIds = new Set(userOptions.map(u => u.id));
        result = result.filter(t => t.users?.some(u => teamUserIds.has(u.id)) ?? false);
      }
    }

    // User filters
    if (filterProjectIds.length > 0) result = result.filter(t => filterProjectIds.includes(t.projectId));
    if (filterStatusIds.length > 0) result = result.filter(t => filterStatusIds.includes(t.statusId));
    if (filterUserIds.length > 0) result = result.filter(t => t.users?.some(u => filterUserIds.includes(u.id)) ?? false);
    if (filterTeamIds.length > 0) result = result.filter(t => t.users?.some(u => filterTeamIds.includes((u as any).teamId)) ?? false);

    return result;
  })();

  function openDetail(task: Task) { setDetailTask(task); setDetailOpen(true); }
  function openCreate() { setEditTaskId(null); setFormOpen(true); }
  function openEdit(task: Task) { setEditTaskId(task.id); setFormOpen(true); }
  function handleDelete(task: Task) {
    if (task.users && task.users.length > 1) setMultiDeleteTask(task);
    else setDeleteTarget(task.id);
  }
  function clearFilters() {
    setFilterProjectIds([]);
    setFilterStatusIds([]);
    setFilterUserIds([]);
    setFilterTeamIds([]);
  }

  const columns: ColumnDef<Task, unknown>[] = [
    {
      id: "project",
      accessorFn: (row) => row.project?.name,
      header: sortableHeader(t("list.columns.project")),
      cell: ({ row }) => {
        const project = row.original.project;
        if (!project) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: project.color ?? undefined }} />
            <TruncatedCell value={project.name} maxWidth="max-w-[180px]" />
          </div>
        );
      },
    },
    {
      accessorKey: "title",
      header: sortableHeader(t("list.columns.title")),
      size: 200,
      cell: ({ row }) => {
        const title = row.original.title || "—";
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block max-w-[180px] truncate font-medium">{title}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-words">{title}</TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: "users",
      accessorFn: (row) => row.users?.map(u => u.name).join(", "),
      header: sortableHeader(t("list.columns.users")),
      cell: ({ row }) => {
        const users = row.original.users;
        if (!users || users.length === 0) return <span className="text-muted-foreground">—</span>;
        const joined = users.map((u: any) => u.displayName || u.name || "—").join(", ");
        return <TruncatedCell value={joined} maxWidth="max-w-[200px]" />;
      },
    },
    {
      id: "dates",
      accessorFn: (row) => row.startDate,
      header: sortableHeader(t("list.columns.dates")),
      cell: ({ row }) => {
        const s = row.original.startDate;
        const e = row.original.endDate;
        return (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatDate(s)}{e && e !== s ? ` → ${formatDate(e)}` : ""}
          </span>
        );
      },
    },
    {
      id: "times",
      accessorFn: (row) => row.startTime,
      header: sortableHeader(t("list.columns.times")),
      cell: ({ row }) => {
        const start = row.original.startTime;
        const end = row.original.endTime;
        if (!start) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground italic whitespace-nowrap">
                  {formatTime(defaultStartTime)} – {formatTime(defaultEndTime)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("list.defaultHoursTooltip")}</TooltipContent>
            </Tooltip>
          );
        }
        return (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatTime(start)}{end ? ` – ${formatTime(end)}` : ""}
          </span>
        );
      },
    },
    {
      id: "status",
      accessorFn: (row) => row.status?.name,
      header: sortableHeader(t("list.columns.status")),
      cell: ({ row }) => {
        const status = row.original.status;
        if (!status) return "—";
        return (
          <Badge variant="outline" style={{ borderColor: status.color ?? undefined, color: status.color ?? undefined, backgroundColor: status.color ? `${status.color}15` : undefined }}>
            {status.name}
          </Badge>
        );
      },
    },
    {
      id: "place",
      accessorFn: (row) => row.place?.name || (row as any).placeText,
      header: sortableHeader(t("list.columns.place")),
      cell: ({ row }) => {
        const name = row.original.place?.name || (row.original as any).placeText;
        return <TruncatedCell value={name} maxWidth="max-w-[180px]" className="text-sm" />;
      },
    },
    {
      id: "actions",
      header: "",
      size: 130,
      cell: ({ row }) => {
        const canEdit = canModifyTask(row.original);
        const canDel = canDeleteTask(row.original);
        return (
          <RowActions
            actions={[
              { label: t("list.actions.viewDetails"), icon: <Eye className="h-4 w-4" />, onClick: () => openDetail(row.original) },
              { label: tc("actions.edit"), icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(row.original), allowed: canEdit, tooltipDisallowed: t("permissionDenied") },
              { label: tc("actions.delete"), icon: <Trash2 className="h-4 w-4" />, onClick: () => handleDelete(row.original), allowed: canDel, tooltipDisallowed: t("permissionDenied"), destructive: true, separatorBefore: true },
            ]}
          />
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <h1 className="text-2xl font-bold">{t("list.title")}</h1>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <DateRangePicker startDate={startDate} endDate={endDate} onChange={setDateRange} />
        </div>
        <div className="ml-auto">
          {!canCreateAnyTask ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled><Plus className="h-4 w-4 mr-1" />{tc("actions.add")}</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("permissionDenied")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />{tc("actions.add")}</Button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <FilterMultiSelect label={t("list.filters.project")} items={projectOptions} selected={filterProjectIds} onChange={setFilterProjectIds} />
        <FilterMultiSelect label={t("list.filters.status")} items={statusOptions} selected={filterStatusIds} onChange={setFilterStatusIds} />
        <FilterMultiSelect label={t("list.filters.user")} items={userOptions} selected={filterUserIds} onChange={setFilterUserIds} />
        {teamOptions.length > 1 && (
          <FilterMultiSelect label={t("list.filters.team")} items={teamOptions} selected={filterTeamIds} onChange={setFilterTeamIds} />
        )}
        <DataTableSearchToggle
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t("list.searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
        {hasAnyFilter && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" />
            {tc("actions.clear")}
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto flex items-center gap-2">
          {t("list.count", { count: filteredTasks.length })}
          {allTasks.length >= taskLimit && tasksData && tasksData.total > allTasks.length && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-orange-500 cursor-help">
                  {t("list.limited", { limit: taskLimit })}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("list.notLoaded", { count: tasksData.total - allTasks.length })}
              </TooltipContent>
            </Tooltip>
          )}
          <Select value={String(taskLimit)} onValueChange={(v) => setTaskLimit(Number(v))}>
            <SelectTrigger className="h-7 w-[100px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="1000">{formatNumber(1000)}</SelectItem>
              <SelectItem value="5000">{formatNumber(5000)}</SelectItem>
              <SelectItem value="10000">{formatNumber(10000)}</SelectItem>
            </SelectContent>
          </Select>
        </span>
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={filteredTasks}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      {isLoading && <p className="text-center text-muted-foreground">{tc("states.loading")}</p>}

      <TaskDetail
        task={detailTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={(task) => { setDetailOpen(false); openEdit(task); }}
      />

      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} taskId={editTaskId} prefill={null} viewMode="users" />

      {/* Simple delete dialog */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("dialogs.delete.title")}
        onConfirm={() => {
          if (deleteTarget) deleteTask.mutate({ id: deleteTarget }, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteTask.isPending}
      />

      {/* Multi-user delete dialog */}
      <DeleteConfirmDialog
        open={!!multiDeleteTask}
        onOpenChange={(open) => { if (!open) setMultiDeleteTask(null); }}
        title={t("dialogs.multiDelete.title")}
        description={t("dialogs.multiDelete.description", { count: multiDeleteTask?.users?.length ?? 0, names: multiDeleteTask?.users?.map(u => u.name).join(", ") ?? "" })}
        onConfirm={() => {
          if (multiDeleteTask) deleteTask.mutate({ id: multiDeleteTask.id }, { onSuccess: () => setMultiDeleteTask(null) });
        }}
        onArchive={() => {
          if (multiDeleteTask) { setRemoveUserTask(multiDeleteTask); setMultiDeleteTask(null); }
        }}
        confirmLabel={t("dialogs.multiDelete.confirm")}
        archiveLabel={t("dialogs.multiDelete.removeUser")}
        isPending={deleteTask.isPending}
      />

      {/* Select user to remove dialog */}
      <Dialog open={!!removeUserTask} onOpenChange={(open) => { if (!open) setRemoveUserTask(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("dialogs.removeUser.title")}</DialogTitle>
            <DialogDescription>{t("dialogs.removeUser.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {removeUserTask?.users?.map((user) => (
              <Button
                key={user.id}
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => removeUserFromTask.mutate({ taskId: removeUserTask.id, userId: user.id }, { onSuccess: () => setRemoveUserTask(null) })}
                disabled={removeUserFromTask.isPending}
              >
                <UserMinus className="h-4 w-4 text-muted-foreground" />
                {user.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
