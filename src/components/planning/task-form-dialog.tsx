"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, formatProjectName } from "@/lib/utils";
import { TimePicker } from "@/components/shared/time-picker";
import { CalendarDays, ChevronsUpDown, Check, Sun, Sunset, Paperclip, ChevronDown, History, Hash, Lock, Unlock, Upload, AlertTriangle, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTask, useTasks, useCreateTask, useUpdateTask, useDeleteTask, useRemoveUserFromTask, useRepeatTask } from "@/hooks/use-tasks";
import { parseDailyTaskLimit, wouldExceedDailyLimit } from "@/lib/utils/daily-task-limit";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { FileUpload, uploadFileToServer } from "@/components/shared/file-upload";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TaskRecurringForm } from "./task-recurring-form";
import { useProjects } from "@/hooks/use-projects";
import { useUsers } from "@/hooks/use-users";
import { useBuStore } from "@/stores/bu-store";
import { useStatuses } from "@/hooks/use-statuses";
import { useResources } from "@/hooks/use-resources";
import { useConfig } from "@/hooks/use-config";
import { usePlanningStore, type ViewMode } from "@/stores/planning-store";
import { useSession } from "@/lib/auth-client";
import type { RecurRule } from "@/lib/validators/task";
import { RecurringDeleteDialog } from "./recurring-delete-dialog";
import { Repeat } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { TaskAuditHistory } from "./task-audit-history";
import { TaskLocationSection } from "./task-location-section";
import { calculateEndDateFromDays, calculateDaysFromDates } from "@/lib/utils/dates";

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string | null;
  prefill: { rowId?: string; date?: string; startTime?: string; endTime?: string } | null;
  viewMode: ViewMode;
}

/**
 * Lazy-mount wrapper: the dialog body (which pulls
 * `useProjects`, `useUsers`, `useStatuses`, `useResources`, `useConfig`)
 * is only loaded on the FIRST `open=true`. Without it, the initial mount of /planning
 * fires a ~1 MB `/api/projects` and a `/api/users` even if
 * the user never opens the dialog (plain schedule viewer
 * case). Once mounted, the inside stays mounted to preserve
 * the state between openings (local cache, Sheet animations, etc.).
 */
export function TaskFormDialog(props: TaskFormDialogProps) {
  const [hasBeenOpened, setHasBeenOpened] = useState(props.open);
  useEffect(() => {
    if (props.open && !hasBeenOpened) setHasBeenOpened(true);
  }, [props.open, hasBeenOpened]);
  if (!hasBeenOpened) return null;
  return <TaskFormDialogInner {...props} />;
}

function TaskFormDialogInner({
  open,
  onOpenChange,
  taskId,
  prefill,
  viewMode,
}: TaskFormDialogProps) {
  const t = useTranslations("taskForm.dialog");
  const tCommon = useTranslations("common");
  const tMultiDelete = useTranslations("taskForm.dialog.multiDelete");
  const { format: formatLocalized } = useDateFormat();
  const isEditing = !!taskId;
  const queryClient = useQueryClient();
  // Disables useTask when the dialog is closed (`open: false`). Without
  // it, the observer stays mounted with the old taskId as long as the parent
  // does not reset `editingTaskId` (which it does not — it keeps the ID
  // for the next opening). On delete, `onSuccess` calls
  // `invalidateQueries(["tasks"])`; the prefix matches `["tasks", id]`
  // → the observer refetches → 404 in the console because the task was just
  // deleted. Purging through removeQueries in useDeleteTask is not
  // enough: invalidateQueries then marks the query as stale
  // and an active observer immediately triggers a refetch.
  //
  // Switching to `null` is delayed by ~250 ms after closing so as
  // not to break the Radix animation: if `existingTask` becomes
  // `undefined` instantly, the `useEffect` that syncs the fields
  // resets all inputs to "" → the dialog visually "shrinks"
  // during `zoom-out-95`. With this delay, the content stays stable
  // until the end of the animation.
  const [delayedOpen, setDelayedOpen] = useState(open);
  useEffect(() => {
    if (open) {
      setDelayedOpen(true);
      return;
    }
    const timer = setTimeout(() => setDelayedOpen(false), 250);
    return () => clearTimeout(timer);
  }, [open]);
  const { data: existingTask } = useTask(delayedOpen ? taskId : null);
  const { data: allProjects } = useProjects();
  const { data: allUsers } = useUsers();
  const { selectedBuIds } = useBuStore();
  // Filter projects and users by selected BU (empty = show all)
  const projects = useMemo(() => {
    if (selectedBuIds.length === 0 || !allProjects) return allProjects;
    return allProjects.filter((p: any) => p.businessUnitId && selectedBuIds.includes(p.businessUnitId));
  }, [allProjects, selectedBuIds]);
  const users = useMemo(() => {
    if (selectedBuIds.length === 0 || !allUsers) return allUsers;
    return allUsers.filter((u: any) => u.businessUnitId && selectedBuIds.includes(u.businessUnitId));
  }, [allUsers, selectedBuIds]);
  const { data: statuses } = useStatuses();
  const { data: resources } = useResources();
  const { data: appConfig } = useConfig();
  const fileUploadEnabled = appConfig?.ENABLE_FILE_UPLOAD !== "false";
  const amStart = appConfig?.AM_START || "08:00";
  const amEnd = appConfig?.AM_END || "12:00";
  const pmStart = appConfig?.PM_START || "14:00";
  const pmEnd = appConfig?.PM_END || "17:00";
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const removeUserFromTask = useRemoveUserFromTask();
  const repeatTask = useRepeatTask();
  const { data: session } = useSession();
  const { can, canCreateAnyTask, canCreateTaskFor, canModifyTask, canLockTask, canDeleteTask: canDeleteTaskFn } = usePermissions();
  const canRestoreAudit = can("audit:restore");

  // Scroll fix: prevent wheel events from leaking to Dialog scroll lock
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) {
      e.stopPropagation();
    }
  }, []);
  // Dialog Delete button: checks modifyScope on the current task.
  const canDeleteTask = !!existingTask && canDeleteTaskFn(existingTask);
  const canViewFiles = can("files:view");
  const canUploadFiles = can("files:upload");
  const canDeleteFiles = can("files:delete");
  const markTaskDeleting = usePlanningStore((s) => s.markTaskDeleting);
  const [multiDeleteOpen, setMultiDeleteOpen] = useState(false);
  const [recurDeleteOpen, setRecurDeleteOpen] = useState(false);
  const [pendingRecurScope, setPendingRecurScope] = useState<"single" | "all" | "after" | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [endDateMode, setEndDateMode] = useState<"date" | "days">("date");
  const [nbDaysInput, setNbDaysInput] = useState<number | "">("");
  const [pendingLock, setPendingLock] = useState<boolean | null>(null);
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const [usersPopoverOpen, setUsersPopoverOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [recurEnabled, setRecurEnabled] = useState(false);
  const [taskFiles, setTaskFiles] = useState<any[]>([]);
  const [pendingFileDeletes, setPendingFileDeletes] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [dropzoneOpen, setDropzoneOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploadState, setUploadState] = useState<{ uploading: boolean; progress: number } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recurRule, setRecurRule] = useState<Partial<RecurRule>>({
    recurType: "daily",
    recurFrequency: 1,
    recurException: "skip",
  });

  const isRecurring = !!existingTask?.parentId;
  const isRootTask = existingTask?.parentId === existingTask?.id;

  const form = useForm({
    defaultValues: {
      title: "",
      projectId: "",
      userIds: [] as string[],
      statusId: "",
      startDate: "",
      endDate: "",
      startTime: "",
      endTime: "",
      placeId: "",
      placeText: "",
      placeTextLat: "",
      placeTextLng: "",
      resourceId: "",
      notes: "",
      isMilestone: false,
    },
  });

  // Populate form when editing or creating
  useEffect(() => {
    if (!open) {
      setFilesOpen(false);
      setHistoryOpen(false);
      setSubmitError(null);
      return;
    }
    setSubmitError(null);
    // Re-arms the double-submit guard each time the dialog reopens.
    // The lock stays in place for the whole duration of a submit (success →
    // dialog closes, or error → releaseOnError). No automatic release
    // on onSettled, to avoid the race window where the server
    // answers fast + a click in the following 50ms.
    submittingRef.current = false;

    if (isEditing && existingTask) {
      form.reset({
        title: existingTask.title || "",
        projectId: existingTask.projectId || "",
        userIds: existingTask.users?.map((u) => u.id) ?? [],
        statusId: existingTask.statusId || "",
        startDate: existingTask.startDate || "",
        endDate: existingTask.endDate || "",
        startTime: existingTask.startTime || "",
        endTime: existingTask.endTime || "",
        placeId: existingTask.placeId || "",
        placeText: (existingTask as any).placeText || "",
        placeTextLat: (existingTask as any).placeTextLat || "",
        placeTextLng: (existingTask as any).placeTextLng || "",
        resourceId: existingTask.resourceId || "",
        notes: existingTask.notes || "",
        isMilestone: existingTask.isMilestone || false,
      });
      // Load files
      setTaskFiles(existingTask.files ?? []);
      setFilesOpen((existingTask.files ?? []).length > 0);
      setDropzoneOpen(false);
      setPendingFileDeletes([]);
      setPendingFiles([]);
      setEndDateMode("date");
      setNbDaysInput("");
      setPendingLock(null);
      // Restore recurrence state if root task
      if (existingTask.parentId === existingTask.id && existingTask.recurType) {
        setRecurEnabled(true);
        setRecurRule({
          recurType: existingTask.recurType as "daily" | "weekly" | "monthly",
          recurFrequency: existingTask.recurFrequency ?? 1,
          recurEndDate: existingTask.recurEndDate ?? undefined,
          recurDayOfWeek: existingTask.recurDayOfWeek ?? undefined,
          recurException: (existingTask.recurException as "skip" | "shift" | "include") ?? "skip",
        });
      } else {
        setRecurEnabled(false);
      }
    } else {
      const defaults: Record<string, unknown> = {
        title: "",
        projectId: "",
        userIds: [] as string[],
        statusId: statuses?.[0]?.id || "",
        startDate: prefill?.date || "",
        endDate: prefill?.date || "",
        startTime: prefill?.startTime || "",
        endTime: prefill?.endTime || "",
        placeId: "",
        placeText: "",
        placeTextLat: "",
        placeTextLng: "",
        resourceId: "",
        notes: "",
        isMilestone: false,
      };

      // Set the prefilled row based on viewMode
      if (prefill?.rowId) {
        switch (viewMode) {
          case "users": defaults.userIds = [prefill.rowId]; break;
          case "projects": defaults.projectId = prefill.rowId; break;
          case "resources": defaults.resourceId = prefill.rowId; break;
          case "vehicles": break;
        }
      }

      form.reset(defaults);
      setTaskFiles([]);
      setPendingFileDeletes([]);
      setPendingFiles([]);
      setFilesOpen(false);
      setEndDateMode("date");
      setNbDaysInput("");
      setPendingLock(null);
      setRecurEnabled(false);
      setRecurRule({ recurType: "daily", recurFrequency: 1, recurException: "skip" });
    }
  }, [open, isEditing, existingTask, prefill, viewMode, statuses, form]);

  // Recalculate endDate when startDate changes in "days" mode
  const watchedStartDate = form.watch("startDate");
  useEffect(() => {
    if (endDateMode === "days" && typeof nbDaysInput === "number" && nbDaysInput >= 1 && watchedStartDate) {
      const newEndDate = calculateEndDateFromDays(watchedStartDate, nbDaysInput);
      form.setValue("endDate", newEndDate);
    }
  }, [watchedStartDate, endDateMode, nbDaysInput, form]);

  // Double-submit guard: protects against multiple clicks on
  // "Create" / "Save". The lock is set on entry to onSubmit and
  // is NEVER released while the dialog stays open — it is only reset
  // when the dialog reopens (useEffect below). On a server
  // error it is released explicitly to allow a retry.
  const submittingRef = useRef(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onSubmit = async (values: any) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const releaseOnError = () => { submittingRef.current = false; };
    const data = {
      ...values,
      placeId: values.placeId && values.placeId !== "none" ? values.placeId : null,
      placeText: values.placeText || null,
      placeTextLat: values.placeTextLat || null,
      placeTextLng: values.placeTextLng || null,
      resourceId: values.resourceId && values.resourceId !== "none" ? values.resourceId : null,
      endDate: values.endDate || undefined,
      startTime: values.startTime || undefined,
      endTime: values.endTime || undefined,
      ...(pendingLock !== null ? { isLocked: pendingLock } : {}),
    };

    if (isEditing && taskId) {
      // Upload pending files first
      if (pendingFiles.length > 0) {
        setUploadState({ uploading: true, progress: 0 });
        try {
          const total = pendingFiles.length;
          for (let i = 0; i < total; i++) {
            await uploadFileToServer(taskId, pendingFiles[i], (fileProgress) => {
              const overall = Math.round(((i * 100 + fileProgress) / total));
              setUploadState({ uploading: true, progress: overall });
            });
          }
          setPendingFiles([]);
        } catch {
          // Upload error handled silently
        }
        setUploadState(null);
      }

      // Execute pending file deletions
      const deletePromises = pendingFileDeletes.map(fileId =>
        fetch(`/api/tasks/${taskId}/files?fileId=${fileId}`, { method: "DELETE" }).catch(() => {})
      );

      setSubmitError(null);
      updateTask.mutate({ id: taskId, data }, {
        onSuccess: () => {
          Promise.all(deletePromises).then(() => {
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            queryClient.invalidateQueries({ queryKey: ["storage-stats"] });
          });
          onOpenChange(false);
          if (recurEnabled && isRootTask && recurRule.recurType && recurRule.recurEndDate) {
            const changed = !existingTask?.recurType
              || recurRule.recurType !== existingTask.recurType
              || recurRule.recurFrequency !== (existingTask.recurFrequency ?? 1)
              || recurRule.recurEndDate !== (existingTask.recurEndDate ?? "")
              || (recurRule.recurDayOfWeek ?? null) !== (existingTask.recurDayOfWeek ?? null)
              || recurRule.recurException !== (existingTask.recurException ?? "skip");
            if (changed) {
              repeatTask.mutate({ id: taskId, data: recurRule as RecurRule });
            }
          }
        },
        onError: (err: unknown) => {
          const status = (err as { status?: number })?.status;
          const msg = (err as Error)?.message || tCommon("toast.error");
          setSubmitError(status === 403 ? msg : msg);
          releaseOnError();
        },
      });
    } else {
      setSubmitError(null);
      createTask.mutate(data, {
        onError: (err: unknown) => {
          const msg = (err as Error)?.message || tCommon("toast.error");
          setSubmitError(msg);
          releaseOnError();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuccess: async (result: any) => {
          const newId = result?.id ?? result?.data?.id;
          // Upload pending files for new task
          if (newId && pendingFiles.length > 0) {
            setUploadState({ uploading: true, progress: 0 });
            try {
              const total = pendingFiles.length;
              for (let i = 0; i < total; i++) {
                await uploadFileToServer(newId, pendingFiles[i], (fileProgress) => {
                  const overall = Math.round(((i * 100 + fileProgress) / total));
                  setUploadState({ uploading: true, progress: overall });
                });
              }
              setPendingFiles([]);
              queryClient.invalidateQueries({ queryKey: ["tasks"] });
              queryClient.invalidateQueries({ queryKey: ["storage-stats"] });
            } catch {
              // Upload error handled silently
            }
            setUploadState(null);
          }
          onOpenChange(false);
          if (recurEnabled && recurRule.recurType && recurRule.recurEndDate && newId) {
            repeatTask.mutate({ id: newId, data: recurRule as RecurRule });
          }
        },
      });
    }
  };

  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isMultiUser = (existingTask?.users?.length ?? 0) > 1;
  const currentUserId = session?.user?.id;
  const isCurrentUserAssigned = isMultiUser && existingTask?.users?.some((u) => u.id === currentUserId);

  const handleDelete = useCallback(() => {
    if (!taskId) return;
    // If recurring, show special dialog
    if (isRecurring) {
      setRecurDeleteOpen(true);
      return;
    }
    if (isMultiUser) {
      setMultiDeleteOpen(true);
      return;
    }
    if (deleteConfirming) {
      clearTimeout(deleteTimerRef.current);
      setDeleteConfirming(false);
      onOpenChange(false);
      markTaskDeleting(taskId);
      setTimeout(() => deleteTask.mutate({ id: taskId }), 170);
    } else {
      setDeleteConfirming(true);
      deleteTimerRef.current = setTimeout(() => setDeleteConfirming(false), 2500);
    }
  }, [taskId, deleteConfirming, onOpenChange, deleteTask, isMultiUser, isRecurring]);

  // Reset confirm state when dialog closes or task changes
  useEffect(() => {
    setDeleteConfirming(false);
    setMultiDeleteOpen(false);
    setRecurDeleteOpen(false);
    setPendingRecurScope(null);
    return () => clearTimeout(deleteTimerRef.current);
  }, [open, taskId]);


  const selectedUserIds = form.watch("userIds");
  const selectedProjectId = form.watch("projectId");
  const selectedStartDate = form.watch("startDate");
  const selectedEndDate = form.watch("endDate");

  // Daily task limit (PLANNING_MAX_TASKS_PER_DAY) — greys out Save if
  // the (users, dates) combination would exceed the limit.
  const dailyLimit = parseDailyTaskLimit(appConfig?.PLANNING_MAX_TASKS_PER_DAY);
  const { data: tasksInRange } = useTasks(
    { startDate: selectedStartDate, endDate: selectedEndDate || selectedStartDate, page: 1, limit: 10000 },
    dailyLimit > 0 && !!selectedStartDate && selectedUserIds.length > 0,
  );

  // Dynamic canSave: requires appropriate permissions
  const canSave = useMemo(() => {
    // Resolve the selected assignees + project owner.
    const selectedProject = allProjects?.find((p: any) => p.id === selectedProjectId);
    const assignedUsers = (allUsers ?? [])
      .filter((u: any) => selectedUserIds.includes(u.id))
      .map((u: any) => ({ id: u.id, teamId: u.teamId ?? null }));
    const projectOwnerId = (selectedProject as any)?.ownerId ?? null;

    // Shared check: PLANNING_MAX_TASKS_PER_DAY limit (if enabled).
    // Applied both on creation and on edit (if users or dates change).
    const violatesDailyLimit = () => {
      if (dailyLimit <= 0 || !selectedStartDate || selectedUserIds.length === 0) return false;
      if (!tasksInRange?.data) return false;
      return wouldExceedDailyLimit(tasksInRange.data, dailyLimit, {
        userIds: selectedUserIds,
        startDate: selectedStartDate,
        endDate: selectedEndDate || selectedStartDate,
        excludeTaskId: isEditing ? taskId : null,
      });
    };

    if (isEditing) {
      if (existingTask?.isLocked && pendingLock !== false) return false;
      if (!existingTask) return canCreateAnyTask;
      if (!canModifyTask(existingTask)) return false;
      const existingUserIdsStr = [...(existingTask.users?.map(u => u.id) ?? [])].sort().join(",");
      const selectedUserIdsStr = [...selectedUserIds].sort().join(",");
      const usersChanged = existingUserIdsStr !== selectedUserIdsStr;
      const projectChanged = (existingTask.projectId ?? null) !== (selectedProjectId || null);
      const datesChanged = (existingTask.startDate !== selectedStartDate)
        || ((existingTask.endDate ?? null) !== (selectedEndDate || null));
      if (usersChanged || projectChanged) {
        if (!canCreateTaskFor({ assignedUsers, projectOwnerId })) return false;
      }
      // If the date or the assignees change, re-check the daily limit
      if ((usersChanged || datesChanged) && violatesDailyLimit()) return false;
      return true;
    }
    // Creation
    if (!canCreateAnyTask) return false;
    if (!canCreateTaskFor({ assignedUsers, projectOwnerId })) return false;
    if (violatesDailyLimit()) return false;
    return true;
  }, [isEditing, existingTask, canModifyTask, canCreateAnyTask, canCreateTaskFor, pendingLock, allProjects, allUsers, selectedProjectId, selectedUserIds, dailyLimit, selectedStartDate, selectedEndDate, tasksInRange, taskId]);

  const toggleUser = useCallback((userId: string) => {
    const current = form.getValues("userIds");
    if (current.includes(userId)) {
      form.setValue("userIds", current.filter(id => id !== userId), { shouldDirty: true });
    } else {
      form.setValue("userIds", [...current, userId], { shouldDirty: true });
    }
  }, [form]);

  const selectedUsersLabel = (() => {
    if (!selectedUserIds || selectedUserIds.length === 0) return tCommon("actions.select");
    if (selectedUserIds.length === 1) {
      const u = users?.find((u) => u.id === selectedUserIds[0]);
      return u ? [(u as any).firstName, u.name].filter(Boolean).join(" ") : t("fields.users.count", { count: 1 });
    }
    return t("fields.users.count", { count: selectedUserIds.length });
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("title.edit") : t("title.create")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? t("description.edit") : t("description.create")}
          </DialogDescription>
          {(pendingLock !== null ? pendingLock : existingTask?.isLocked) && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5 mt-1">
              <Lock className="size-3" />
              {pendingLock !== null && pendingLock !== existingTask?.isLocked
                ? (pendingLock ? t("lock.willLock") : t("lock.willUnlock"))
                : t("lock.locked")}
            </p>
          )}
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.title.label")}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" placeholder={t("fields.title.placeholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="projectId"
                rules={{ required: t("fields.project.required") }}
                render={({ field }) => {
                  const selectedProject = projects?.find((p) => p.id === field.value);
                  return (
                    <FormItem>
                      <FormLabel>{t("fields.project.label")}</FormLabel>
                      <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              className={cn(
                                "w-full justify-start font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {selectedProject && (
                                <span
                                  className="inline-block h-2 w-2 rounded-full shrink-0"
                                  style={{ backgroundColor: selectedProject.color || "#ccc" }}
                                />
                              )}
                              <span className="truncate flex-1 min-w-0 text-left">
                                {selectedProject ? formatProjectName(selectedProject) : tCommon("actions.select")}
                              </span>
                              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                          <Command defaultValue={field.value || undefined}>
                            <CommandInput placeholder={t("fields.project.searchPlaceholder")} />
                            <CommandList className="overscroll-contain" onWheel={handleWheel}>
                              <CommandEmpty>{t("fields.project.empty")}</CommandEmpty>
                              <CommandGroup>
                                {projects?.filter((p) => p.status !== "archived").map((p) => (
                                  <CommandItem
                                    key={p.id}
                                    value={p.id}
                                    keywords={[p.name, p.businessNumber].filter(Boolean) as string[]}
                                    onSelect={() => {
                                      field.onChange(p.id);
                                      setProjectPopoverOpen(false);
                                    }}
                                  >
                                    <span
                                      className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: p.color || "#ccc" }}
                                    />
                                    {formatProjectName(p)}
                                    {field.value === p.id && <Check className="ml-auto h-4 w-4" />}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="userIds"
                rules={{ validate: (v: string[]) => v.length > 0 || t("fields.users.required") }}
                render={() => (
                  <FormItem>
                    <FormLabel>{t("fields.users.label")}</FormLabel>
                    <Popover open={usersPopoverOpen} onOpenChange={(open) => { setUsersPopoverOpen(open); if (!open) setUserSearch(""); }}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "w-full justify-between min-w-0 font-normal",
                              selectedUserIds.length === 0 && "text-muted-foreground"
                            )}
                          >
                            <span className="truncate flex-1 min-w-0 text-left">{selectedUsersLabel}</span>
                            <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                        <div className="p-2 border-b">
                          <Input
                            autoComplete="off"
                            placeholder={tCommon("actions.searchPlaceholder")}
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                            className="h-8"
                          />
                        </div>
                        <div className="max-h-[200px] overflow-y-auto overscroll-contain p-1" onWheel={handleWheel}>
                          {users?.filter((u) => {
                            if (!userSearch) return true;
                            const displayName = [(u as any).firstName, u.name].filter(Boolean).join(" ").toLowerCase();
                            return displayName.includes(userSearch.toLowerCase());
                          }).map((u) => {
                            const isSelected = selectedUserIds.includes(u.id);
                            const displayName = [(u as any).firstName, u.name].filter(Boolean).join(" ");
                            return (
                              <div
                                key={u.id}
                                role="option"
                                aria-selected={isSelected}
                                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
                                onClick={() => toggleUser(u.id)}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleUser(u.id); } }}
                                tabIndex={0}
                              >
                                <div className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs",
                                  isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input"
                                )}>
                                  {isSelected && <Check className="h-3 w-3" />}
                                </div>
                                <span>{displayName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="statusId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.status.label")}</FormLabel>
                  <Select name={field.name} onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={tCommon("actions.select")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {statuses?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: s.color || "#ccc" }}
                          />
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                rules={{ required: t("fields.startDate.required") }}
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    {/* min-h-[28px]: aligns the height of the "label row"
                       with the End date one (which holds the calendar/days
                       toggle buttons). Without it the "End date" input
                       is vertically offset from "Start date". */}
                    <div className="flex items-center min-h-[28px]">
                      <FormLabel>{t("fields.startDate.label")}</FormLabel>
                    </div>
                    <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            <CalendarDays className="mr-2 h-4 w-4" />
                            {field.value
                              ? formatLocalized(parseISO(field.value), "d MMMM yyyy")
                              : tCommon("actions.select")}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value ? parseISO(field.value) : undefined}
                          onSelect={(date) => {
                            field.onChange(date ? format(date, "yyyy-MM-dd") : "");
                            setStartDateOpen(false);
                          }}
                          defaultMonth={field.value ? parseISO(field.value) : undefined}
                          weekStartsOn={1}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <div className="flex items-center justify-between min-h-[28px]">
                      <FormLabel>{endDateMode === "date" ? t("fields.endDate.label") : t("fields.endDate.durationLabel")}</FormLabel>
                      <div className="flex gap-0.5 rounded-md border p-0.5">
                        <button
                          type="button"
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                            endDateMode === "date" ? "bg-violet-100 text-violet-700" : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() => {
                            setEndDateMode("date");
                            // Keep endDate as-is, clear nbDays
                            setNbDaysInput("");
                          }}
                        >
                          <CalendarDays className="size-3" />
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                            endDateMode === "days" ? "bg-violet-100 text-violet-700" : "text-muted-foreground hover:text-foreground"
                          )}
                          onClick={() => {
                            setEndDateMode("days");
                            // Calculate nbDays from current dates
                            const startDate = form.getValues("startDate");
                            const endDate = field.value;
                            if (startDate && endDate) {
                              setNbDaysInput(calculateDaysFromDates(startDate, endDate));
                            } else {
                              setNbDaysInput(1);
                              if (startDate) field.onChange(startDate);
                            }
                          }}
                        >
                          <Hash className="size-3" />
                        </button>
                      </div>
                    </div>

                    {endDateMode === "date" ? (
                      <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              <CalendarDays className="mr-2 h-4 w-4" />
                              {field.value
                                ? formatLocalized(parseISO(field.value), "d MMMM yyyy")
                                : tCommon("actions.select")}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ? parseISO(field.value) : undefined}
                            onSelect={(date) => {
                              field.onChange(date ? format(date, "yyyy-MM-dd") : "");
                              setEndDateOpen(false);
                            }}
                            defaultMonth={field.value ? parseISO(field.value) : undefined}
                            weekStartsOn={1}
                          />
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <FormControl>
                        <Input
                          autoComplete="off"
                          type="number"
                          min={1}
                          value={nbDaysInput}
                          onChange={(e) => {
                            const val = e.target.value ? parseInt(e.target.value, 10) : "";
                            setNbDaysInput(val);
                            if (typeof val === "number" && val >= 1) {
                              const startDate = form.getValues("startDate");
                              if (startDate) {
                                // Client-side approximation (without holidays)
                                const endDate = calculateEndDateFromDays(startDate, val);
                                field.onChange(endDate);
                              }
                            }
                          }}
                          placeholder={t("fields.endDate.daysPlaceholder")}
                        />
                      </FormControl>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button type="button" variant="outline" className="h-12 sm:h-9 text-xs flex-1 min-w-0 px-3"
                onClick={() => { form.setValue("startTime", amStart, { shouldDirty: true }); form.setValue("endTime", amEnd, { shouldDirty: true }); }}>
                <Sun className="h-3.5 w-3.5 mr-1" /> {t("morning")}
              </Button>
              <Button type="button" variant="outline" className="h-12 sm:h-9 text-xs flex-1 min-w-0 px-3"
                onClick={() => { form.setValue("startTime", pmStart, { shouldDirty: true }); form.setValue("endTime", pmEnd, { shouldDirty: true }); }}>
                <Sunset className="h-3.5 w-3.5 mr-1" /> {t("afternoon")}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.startTime.label")}</FormLabel>
                    <FormControl>
                      <TimePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.endTime.label")}</FormLabel>
                    <FormControl>
                      <TimePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Location section (task address) */}
            <TaskLocationSection
              projectId={form.watch("projectId")}
              projects={projects}
              placeText={form.watch("placeText")}
              placeTextLat={form.watch("placeTextLat") ? parseFloat(form.watch("placeTextLat")) : null}
              placeTextLng={form.watch("placeTextLng") ? parseFloat(form.watch("placeTextLng")) : null}
              onPlaceTextChange={(v) => form.setValue("placeText", v, { shouldDirty: true })}
              onPlaceLocationChange={(lat, lng) => {
                form.setValue("placeTextLat", lat.toString(), { shouldDirty: true });
                form.setValue("placeTextLng", lng.toString(), { shouldDirty: true });
              }}
            />

            {/* Recurring task info banner for child occurrences */}
            {isEditing && isRecurring && !isRootTask && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 border rounded-md px-3 py-2">
                <Repeat className="h-4 w-4 shrink-0" />
                <span>{t("recurringOccurrence")}</span>
              </div>
            )}

            {/* Recurring form — shown on creation or when editing root task */}
            {(!isEditing || isRootTask) && (
              <TaskRecurringForm
                enabled={recurEnabled}
                onEnabledChange={setRecurEnabled}
                value={recurRule}
                onChange={setRecurRule}
                taskStartDate={form.watch("startDate")}
              />
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("fields.notes.label")}</FormLabel>
                  <FormControl>
                    <Textarea autoComplete="off" rows={3} placeholder={t("fields.notes.placeholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Files section — always visible (FileUpload hides dropzone when disabled) */}
            {canViewFiles && (fileUploadEnabled || taskFiles.length > 0) && (
              <Collapsible open={filesOpen} onOpenChange={setFilesOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" type="button" className="w-full justify-between px-2 h-8 text-sm">
                    <span className="flex items-center gap-1.5">
                      <Paperclip className="h-4 w-4" />
                      {t("files.title")}
                      {(taskFiles.length + pendingFiles.length) > 0 && (
                        <span className="text-xs text-muted-foreground">({taskFiles.length + pendingFiles.length})</span>
                      )}
                    </span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", filesOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  {(() => {
                    const hasFiles = taskFiles.length + pendingFiles.length > 0;
                    return (
                      <>
                        <FileUpload
                          taskId={taskId || "new"}
                          files={taskFiles}
                          pendingFiles={pendingFiles}
                          deferDelete
                          readOnly={!canUploadFiles}
                          canDelete={canDeleteFiles}
                          hideDropzone={hasFiles && !dropzoneOpen}
                          onPendingFileAdded={(file) => setPendingFiles(prev => [...prev, file])}
                          onPendingFileRemoved={(index) => setPendingFiles(prev => prev.filter((_, i) => i !== index))}
                          onFileDeleted={(fileId) => {
                            setTaskFiles(prev => prev.filter(f => f.id !== fileId));
                            setPendingFileDeletes(prev => [...prev, fileId]);
                          }}
                        />
                        {hasFiles && !dropzoneOpen && fileUploadEnabled && canUploadFiles && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full mt-2 text-xs"
                            onClick={() => setDropzoneOpen(true)}
                          >
                            <Upload className="h-3.5 w-3.5 mr-1.5" />
                            {t("files.add")}
                          </Button>
                        )}
                      </>
                    );
                  })()}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Upload progress overlay */}
            {uploadState?.uploading && (
              <div className="flex items-center justify-center gap-3 py-3 px-4 rounded-lg bg-primary/5 border border-primary/20">
                <svg className="h-10 w-10 shrink-0" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted-foreground/20" />
                  <circle
                    cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3"
                    className="text-primary"
                    strokeDasharray={`${2 * Math.PI * 15}`}
                    strokeDashoffset={`${2 * Math.PI * 15 * (1 - uploadState.progress / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 18 18)"
                    style={{ transition: "stroke-dashoffset 0.3s ease" }}
                  />
                  <text x="18" y="18" textAnchor="middle" dominantBaseline="central" className="fill-primary text-[9px] font-semibold">
                    {uploadState.progress}%
                  </text>
                </svg>
                <span className="text-sm text-primary font-medium">{t("files.uploading")}</span>
              </div>
            )}

            {submitError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">{submitError}</div>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between pt-2">
              {isEditing && (
                canDeleteTask ? (
                  <Button
                    type="button"
                    variant={deleteConfirming ? "destructive" : "outline"}
                    className={!deleteConfirming ? "text-destructive border-destructive/50 hover:bg-destructive/10" : ""}
                    onClick={handleDelete}
                    disabled={!!uploadState?.uploading}
                  >
                    {deleteConfirming ? t("confirmDelete") : tCommon("actions.delete")}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button type="button" variant="outline" className="text-muted-foreground" disabled>
                          {tCommon("actions.delete")}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("permissionDenied")}</TooltipContent>
                  </Tooltip>
                )
              )}
              <div className="flex flex-wrap gap-2 justify-end sm:ml-auto">
                {isEditing && taskId && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn("h-9 w-9", historyOpen && "bg-accent")}
                        onClick={() => can("pages:audit") && setHistoryOpen((v) => !v)}
                        disabled={!can("pages:audit")}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {can("pages:audit") ? t("history.tooltip") : t("history.permissionRequired")}
                    </TooltipContent>
                  </Tooltip>
                )}
                {isEditing && taskId && existingTask && canLockTask(existingTask) && (() => {
                  const isCurrentlyLocked = pendingLock !== null ? pendingLock : existingTask.isLocked;
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-9 w-9 transition-colors",
                            isCurrentlyLocked && "text-amber-600 bg-amber-50 hover:bg-amber-100",
                          )}
                          onClick={() => {
                            const newVal = !isCurrentlyLocked;
                            setPendingLock(newVal === existingTask.isLocked ? null : newVal);
                          }}
                        >
                          {isCurrentlyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isCurrentlyLocked ? t("lock.unlockTask") : t("lock.lockTask")}
                      </TooltipContent>
                    </Tooltip>
                  );
                })()}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={!!uploadState?.uploading}
                >
                  {tCommon("actions.cancel")}
                </Button>
                {canSave ? (
                  <Button
                    type="submit"
                    disabled={createTask.isPending || updateTask.isPending || !!uploadState?.uploading}
                  >
                    {(createTask.isPending || updateTask.isPending || uploadState?.uploading) && (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    )}
                    {uploadState?.uploading
                      ? t("files.uploadingShort")
                      : (createTask.isPending || updateTask.isPending)
                        ? (isEditing ? tCommon("actions.saving") : tCommon("actions.creating"))
                        : (isEditing ? tCommon("actions.save") : tCommon("actions.create"))}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button type="button" disabled>
                          {isEditing ? tCommon("actions.save") : tCommon("actions.create")}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("permissionDenied")}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Audit history — below action buttons */}
            {historyOpen && isEditing && taskId && (
              <div className="border-t pt-2">
                <TaskAuditHistory taskId={taskId} canRestore={canRestoreAudit} />
              </div>
            )}
          </form>
        </Form>
      </DialogContent>

      {/* Multi-user delete dialog */}
      <DeleteConfirmDialog
        open={multiDeleteOpen}
        onOpenChange={setMultiDeleteOpen}
        title={tMultiDelete("title")}
        description={tMultiDelete("description", { count: existingTask?.users?.length ?? 0 })}
        onConfirm={() => {
          if (taskId) {
            markTaskDeleting(taskId);
            setMultiDeleteOpen(false);
            setPendingRecurScope(null);
            onOpenChange(false);
            setTimeout(() => deleteTask.mutate({ id: taskId, scope: pendingRecurScope ?? undefined }), 170);
          }
        }}
        onArchive={isCurrentUserAssigned && currentUserId ? () => {
          if (taskId && currentUserId) {
            removeUserFromTask.mutate({ taskId, userId: currentUserId, scope: pendingRecurScope ?? undefined });
            setMultiDeleteOpen(false);
            setPendingRecurScope(null);
            onOpenChange(false);
          }
        } : undefined}
        confirmLabel={tMultiDelete("confirm")}
        archiveLabel={tMultiDelete("removeUser")}
      />

      {/* Recurring delete dialog */}
      <RecurringDeleteDialog
        open={recurDeleteOpen}
        onOpenChange={setRecurDeleteOpen}
        onDelete={(scope) => {
          if (!taskId) return;
          if (isMultiUser) {
            // Chain: store scope, then show multi-user dialog
            setPendingRecurScope(scope);
            setRecurDeleteOpen(false);
            setMultiDeleteOpen(true);
          } else {
            markTaskDeleting(taskId);
            setRecurDeleteOpen(false);
            onOpenChange(false);
            setTimeout(() => deleteTask.mutate({ id: taskId, scope }), 170);
          }
        }}
      />
    </Dialog>
  );
}
