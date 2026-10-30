"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCreateResourceAssignment, useUpdateResourceAssignment, useDeleteResourceAssignment, useResourceAssignments } from "@/hooks/use-resource-assignments";
import { useResources } from "@/hooks/use-resources";
import { useProjects } from "@/hooks/use-projects";
import type { PaginatedResponse, TaskWithUsers, ResourceAssignmentWithRelations } from "@/types";
import { usePlanningStore } from "@/stores/planning-store";
import { useBuStore } from "@/stores/bu-store";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateFormat } from "@/hooks/use-date-format";
import { usePermissions } from "@/hooks/use-permissions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { TimePicker } from "@/components/shared/time-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { CalendarDays, ChevronsUpDown, Check, Hash, Lock, Unlock } from "lucide-react";
import { cn, formatProjectName } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { Input } from "@/components/ui/input";
import { calculateEndDateFromDays, calculateDaysFromDates } from "@/lib/utils/dates";

interface ResourceAssignmentFormProps {
  initialData?: ResourceAssignmentWithRelations;
  prefillResourceId?: string;
  prefillDate?: string;
  onClose: () => void;
}

export function ResourceAssignmentForm({ initialData, prefillResourceId, prefillDate, onClose }: ResourceAssignmentFormProps) {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const df = useDateFormat();
  const { can, userId: permUserId, modifyScope } = usePermissions();
  // Can lock if has tasks:lock permission AND (full edit or own-created assignment)
  const canLock = can("tasks:lock") && (
    modifyScope === "all" ||
    modifyScope === "team" ||
    modifyScope === "own_project" ||
    (modifyScope === "own" && initialData?.assignedBy === permUserId)
  );
  const [pendingLock, setPendingLock] = useState<boolean | null>(null);
  const currentLocked = pendingLock !== null ? pendingLock : (initialData?.isLocked ?? false);
  const createAssignment = useCreateResourceAssignment();
  const updateAssignment = useUpdateResourceAssignment();
  const deleteAssignment = useDeleteResourceAssignment();
  const { data: resources } = useResources(true);
  const { data: allProjects } = useProjects();
  const { selectedBuIds } = useBuStore();
  const projects = useMemo(() => {
    if (selectedBuIds.length === 0 || !allProjects) return allProjects;
    return allProjects.filter((p: any) => p.businessUnitId && selectedBuIds.includes(p.businessUnitId));
  }, [allProjects, selectedBuIds]);

  const isEdit = !!initialData;

  const [form, setForm] = useState({
    resourceId: initialData?.resourceId ?? prefillResourceId ?? "",
    type: initialData?.type ?? "reservation",
    projectId: initialData?.projectId ?? "",
    startDate: initialData?.startDate ?? prefillDate ?? "",
    endDate: initialData?.endDate ?? prefillDate ?? "",
    startTime: initialData?.startTime ?? "",
    endTime: initialData?.endTime ?? "",
    notes: initialData?.notes ?? "",
  });
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [endDateMode, setEndDateMode] = useState<"date" | "days">("date");
  const [nbDaysInput, setNbDaysInput] = useState<number | "">("");
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data = {
      resourceId: form.resourceId,
      type: form.type,
      projectId: form.projectId && form.projectId !== "none" ? form.projectId : null,
      startDate: form.startDate,
      endDate: form.endDate || form.startDate,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      notes: form.notes || null,
      ...(pendingLock !== null ? { isLocked: pendingLock } : {}),
    };
    const mutateOpts = {
      onSuccess: () => {
        // Small delay to let invalidation propagate before closing
        setTimeout(onClose, 100);
      },
    };
    if (isEdit && initialData) {
      updateAssignment.mutate({ id: initialData.id, data }, mutateOpts);
    } else {
      createAssignment.mutate(data, mutateOpts);
    }
  }

  const isPending = createAssignment.isPending || updateAssignment.isPending;
  const selectedProject = projects?.find((p) => p.id === form.projectId);

  // Load tasks on the selected date range to suggest projects
  const { data: dayTasksData } = useQuery({
    queryKey: ["tasks", "day-projects", form.startDate, form.endDate || form.startDate],
    queryFn: async () => {
      const sd = form.startDate;
      const ed = form.endDate || form.startDate;
      const res = await fetch(`/api/tasks?startDate=${sd}&endDate=${ed}&limit=100`, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return { data: [] };
      return res.json() as Promise<PaginatedResponse<TaskWithUsers>>;
    },
    enabled: !!form.startDate,
  });

  const suggestedProjects = useMemo(() => {
    if (!dayTasksData?.data || !projects) return [];
    const projectIds = new Set(dayTasksData.data.map((t) => t.projectId));
    return projects.filter((p) => projectIds.has(p.id) && p.status !== "archived");
  }, [dayTasksData, projects]);
  const hasProject = !!(form.projectId && form.projectId !== "none");
  const needsNotes = !hasProject && form.type !== "maintenance";

  // Check for conflicts on the selected resource + dates
  const { data: existingAssignments } = useResourceAssignments(
    form.resourceId || undefined,
    form.startDate || undefined,
    form.startDate ? (form.endDate || form.startDate) : undefined,
  );
  const conflicts = useMemo(() => {
    if (!existingAssignments) return [];
    return existingAssignments.filter((a: ResourceAssignmentWithRelations) =>
      a.id !== initialData?.id
    );
  }, [existingAssignments, initialData?.id]);

  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleDelete = useCallback(() => {
    if (!initialData) return;
    if (deleteConfirming) {
      clearTimeout(deleteTimerRef.current);
      setDeleteConfirming(false);
      onClose();
      usePlanningStore.getState().markTaskDeleting(`ra:${initialData.id}`);
      setTimeout(() => deleteAssignment.mutate(initialData.id), 250);
    } else {
      setDeleteConfirming(true);
      deleteTimerRef.current = setTimeout(() => setDeleteConfirming(false), 2500);
    }
  }, [initialData, deleteConfirming, deleteAssignment, onClose]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {currentLocked && (
        <p className="text-xs text-amber-600 flex items-center gap-1.5">
          <Lock className="size-3" />
          {pendingLock !== null && pendingLock !== (initialData?.isLocked ?? false)
            ? (pendingLock ? t("assignments.willLock") : t("assignments.willUnlock"))
            : t("assignments.locked")}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 min-w-0">
          <Label>{t("assignments.resourceLabel")}</Label>
          <Select name="resourceId" value={form.resourceId} onValueChange={(v) => setForm({ ...form, resourceId: v })}>
            <SelectTrigger className="w-full min-w-0 [&>span]:truncate [&>span]:block [&>span]:min-w-0 [&>span]:flex-1">
              <SelectValue placeholder={tc("actions.select")} />
            </SelectTrigger>
            <SelectContent>
              {resources?.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("assignments.typeLabel")}</Label>
          <Select name="type" value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reservation">{t("assignmentTypes.reservation")}</SelectItem>
              <SelectItem value="maintenance">{t("assignmentTypes.maintenance")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("assignments.startDateLabel")}</Label>
          <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("w-full justify-start text-left font-normal", !form.startDate && "text-muted-foreground")}
              >
                <CalendarDays className="mr-2 h-4 w-4" />
                {form.startDate ? df.format(parseISO(form.startDate), "d MMMM yyyy") : tc("actions.select")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={form.startDate ? parseISO(form.startDate) : undefined}
                onSelect={(date) => {
                  const v = date ? format(date, "yyyy-MM-dd") : "";
                  let newEndDate = form.endDate || v;
                  if (endDateMode === "days" && typeof nbDaysInput === "number" && nbDaysInput >= 1 && v) {
                    newEndDate = calculateEndDateFromDays(v, nbDaysInput);
                  }
                  setForm({ ...form, startDate: v, endDate: newEndDate });
                  setStartDateOpen(false);
                }}
                weekStartsOn={1}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{endDateMode === "date" ? t("assignments.endDateLabel") : t("assignments.durationLabel")}</Label>
            <div className="flex gap-0.5 rounded-md border p-0.5">
              <button type="button" className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors", endDateMode === "date" ? "bg-violet-100 text-violet-700" : "text-muted-foreground hover:text-foreground")} onClick={() => { setEndDateMode("date"); setNbDaysInput(""); }}>
                <CalendarDays className="size-3" />
              </button>
              <button type="button" className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors", endDateMode === "days" ? "bg-violet-100 text-violet-700" : "text-muted-foreground hover:text-foreground")} onClick={() => {
                setEndDateMode("days");
                if (form.startDate && form.endDate) {
                  setNbDaysInput(calculateDaysFromDates(form.startDate, form.endDate));
                } else {
                  setNbDaysInput(1);
                  if (form.startDate) setForm({ ...form, endDate: form.startDate });
                }
              }}>
                <Hash className="size-3" />
              </button>
            </div>
          </div>
          {endDateMode === "date" ? (
            <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !form.endDate && "text-muted-foreground")}>
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {form.endDate ? df.format(parseISO(form.endDate), "d MMMM yyyy") : tc("actions.select")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={form.endDate ? parseISO(form.endDate) : undefined} onSelect={(date) => { setForm({ ...form, endDate: date ? format(date, "yyyy-MM-dd") : "" }); setEndDateOpen(false); }} weekStartsOn={1} />
              </PopoverContent>
            </Popover>
          ) : (
            <Input type="number" min={1} value={nbDaysInput} onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value, 10) : "";
              setNbDaysInput(val);
              if (typeof val === "number" && val >= 1 && form.startDate) {
                setForm({ ...form, endDate: calculateEndDateFromDays(form.startDate, val) });
              }
            }} placeholder={t("assignments.daysPlaceholder")} />
          )}
        </div>

        <div className="space-y-1.5">
          <Label>{t("assignments.startTimeLabel")}</Label>
          <TimePicker value={form.startTime} onChange={(v) => setForm({ ...form, startTime: v })} />
        </div>

        <div className="space-y-1.5">
          <Label>{t("assignments.endTimeLabel")}</Label>
          <TimePicker value={form.endTime} onChange={(v) => setForm({ ...form, endTime: v })} />
        </div>
      </div>

      {form.type === "reservation" && (
        <div className="space-y-1.5">
          <Label>{t("assignments.projectLabel")}</Label>
          <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className={cn(
                  "w-full justify-between min-w-0 font-normal",
                  !form.projectId && "text-muted-foreground"
                )}
              >
                <span className="flex items-center min-w-0">
                  {selectedProject ? (
                    <>
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: selectedProject.color || "#ccc" }}
                      />
                      <span className="truncate">{formatProjectName(selectedProject as any)}</span>
                    </>
                  ) : <span className="truncate">{tc("states.none")}</span>}
                </span>
                <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
              <Command defaultValue={form.projectId || undefined}>
                <CommandInput placeholder={t("assignments.searchProject")} />
                <CommandList onWheel={handleWheel}>
                  <CommandEmpty>{t("assignments.noProjectFound")}</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        setForm({ ...form, projectId: "" });
                        setProjectPopoverOpen(false);
                      }}
                    >
                      {tc("states.none")}
                      {!form.projectId && <Check className="ml-auto h-4 w-4" />}
                    </CommandItem>
                  </CommandGroup>
                  {suggestedProjects.length > 0 && (
                    <CommandGroup heading={t("assignments.dayProjects")}>
                      {suggestedProjects.map((p) => (
                        <CommandItem
                          key={`suggested-${p.id}`}
                          value={`suggested-${p.id}`}
                          keywords={[p.name, (p as any).businessNumber].filter(Boolean) as string[]}
                          onSelect={() => {
                            setForm({ ...form, projectId: p.id });
                            setProjectPopoverOpen(false);
                          }}
                        >
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: p.color || "#ccc" }}
                          />
                          {formatProjectName(p as any)}
                          {form.projectId === p.id && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  <CommandGroup heading={suggestedProjects.length > 0 ? t("assignments.allProjects") : undefined}>
                    {projects?.filter((p) => p.status !== "archived").map((p) => (
                      <CommandItem
                        key={p.id}
                        value={p.id}
                        keywords={[p.name, (p as any).businessNumber].filter(Boolean) as string[]}
                        onSelect={() => {
                          setForm({ ...form, projectId: p.id });
                          setProjectPopoverOpen(false);
                        }}
                      >
                        <span
                          className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: p.color || "#ccc" }}
                        />
                        {formatProjectName(p as any)}
                        {form.projectId === p.id && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="ra-notes">{t("assignments.notesLabel")} {needsNotes && "*"}</Label>
        <Textarea
          id="ra-notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          required={needsNotes}
          placeholder={needsNotes ? t("assignments.notesRequiredPlaceholder") : t("assignments.notesPlaceholder")}
        />
      </div>

      {conflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 animate-pulse" />
          <div>
            <p className="font-medium">{t("assignments.conflictTitle")}</p>
            <p className="text-xs mt-0.5">
              {t("assignments.conflictResource")}
            </p>
            <ul className="text-xs mt-1 space-y-0.5">
              {conflicts.map((c: ResourceAssignmentWithRelations) => (
                <li key={c.id}>
                  {"\u2022"} {c.task?.title || c.project?.name || c.notes || (c.type === "maintenance" ? t("assignmentTypes.maintenance") : t("assignmentTypes.reservation"))}
                  {" "}({df.formatDate(c.startDate)}{c.endDate && c.endDate !== c.startDate ? ` \u2192 ${df.formatDate(c.endDate)}` : ""})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {(createAssignment.error || updateAssignment.error) && (
        <p className="text-sm text-destructive">
          {(createAssignment.error || updateAssignment.error)?.message}
        </p>
      )}

      <div className="flex justify-between pt-2">
        {isEdit && !currentLocked && (
          <Button
            type="button"
            variant={deleteConfirming ? "destructive" : "outline"}
            className={!deleteConfirming ? "text-destructive border-destructive/50 hover:bg-destructive/10" : ""}
            onClick={handleDelete}
          >
            {deleteConfirming ? t("assignments.confirmDelete") : tc("actions.delete")}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {isEdit && canLock && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("h-9 w-9 transition-colors", currentLocked && "text-amber-600 bg-amber-50 hover:bg-amber-100")}
                  onClick={() => {
                    const newVal = !currentLocked;
                    setPendingLock(newVal === (initialData?.isLocked ?? false) ? null : newVal);
                  }}
                >
                  {currentLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{currentLocked ? t("assignments.unlock") : t("assignments.lock")}</TooltipContent>
            </Tooltip>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("actions.cancel")}
          </Button>
          <Button type="submit" disabled={isPending || !form.resourceId || !form.startDate || (needsNotes && !form.notes.trim()) || (initialData?.isLocked && pendingLock !== false)}>
            {isPending ? tc("actions.saving") : isEdit ? tc("actions.edit") : tc("actions.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}
