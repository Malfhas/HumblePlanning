"use client";

import { useDraggable } from "@dnd-kit/core";
import { Lock, Milestone, Paperclip, StickyNote, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, contrastColor } from "@/lib/utils";
import { usePlanningStore } from "@/stores/planning-store";
import { usePermissions } from "@/hooks/use-permissions";
import { useDateFormat } from "@/hooks/use-date-format";
import { stackOf } from "@/lib/utils/calendar-view";
import { endIconsOf, type EndIcon } from "@/lib/canvas/icons";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TaskTooltip } from "./task-tooltip";
import type { TaskWithUsers } from "@/types";

/**
 * Task items of the calendar view: bars over several days (all-day band of
 * the hours view, month grid) and one-line chips (days of the month grid).
 * Same rules as the other calendar blocks: drag allowed when the task can be
 * moved (or copied) and is not locked; click opens the task; right click
 * opens the planning context menu.
 */

export const TASK_FALLBACK_COLOR = "#9ca3af";

/** Darkens a #rrggbb color by `amount` (0-1). */
export function darkenColor(hex: string, amount: number): string {
  const c = hex.replace("#", "");
  const channel = (i: number) =>
    Math.max(0, Math.round(parseInt(c.substring(i, i + 2), 16) * (1 - amount)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Main line of a task: its title, otherwise its project. */
export function taskHeadline(task: TaskWithUsers, untitled: string): string {
  return task.title || task.project?.name || untitled;
}

const PEOPLE_SIZES = {
  xs: { avatar: "size-4", text: "text-[7px]", gap: "gap-0.5" },
  sm: { avatar: "size-5", text: "text-[8px]", gap: "gap-1" },
} as const;

/**
 * Assignees of a task when the calendar shows everyone: colored initials side
 * by side, without a border, at most `max` places (the last one "+N"). The
 * names are in the task tooltip. The `xs` size (16 px) keeps 3 px of the 22 px
 * bars above and below.
 */
export function CalendarPeople({ users, max = 3, size = "xs", className }: {
  users: TaskWithUsers["users"] | null | undefined;
  max?: number;
  size?: keyof typeof PEOPLE_SIZES;
  className?: string;
}) {
  const { shown, more } = stackOf(users ?? [], max);
  if (shown.length === 0 && more === 0) return null;
  const dims = PEOPLE_SIZES[size];
  return (
    <span className={cn("flex shrink-0 items-center", dims.gap, className)} aria-hidden>
      {shown.map((user) => (
        <UserAvatar
          key={user.id}
          user={{ name: user.name, color: user.color }}
          className={dims.avatar}
          fallbackClassName={cn(dims.text, "font-semibold")}
        />
      ))}
      {more > 0 && (
        <span className={cn(dims.avatar, dims.text, "relative inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground")}>
          +{more}
        </span>
      )}
    </span>
  );
}

const END_ICON: Record<EndIcon, typeof Milestone> = { file: Paperclip, note: StickyNote, milestone: Milestone };

/**
 * End of a calendar task, as on the planning bars: attachments (when the display shows them), notes and
 * milestone icons, in the colour of the text, then `after` (lock, assignees). Nothing when all are absent.
 */
export function CalendarTaskEnd({ task, after, iconClassName = "size-2.5", className }: {
  task: TaskWithUsers;
  after?: React.ReactNode;
  iconClassName?: string;
  className?: string;
}) {
  const showFileIcon = usePlanningStore((s) => s.showFileIcon);
  const fileCount = (task as { fileCount?: number }).fileCount ?? task.files?.length ?? 0;
  const icons = endIconsOf(task, showFileIcon && fileCount > 0);
  if (icons.length === 0 && !after) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      {icons.map((key) => {
        const Icon = END_ICON[key];
        return <Icon key={key} className={cn(iconClassName, "shrink-0")} aria-hidden />;
      })}
      {after}
    </span>
  );
}

/** Assignees listed in the calendar tooltip before "+N". */
const TOOLTIP_PEOPLE = 6;

/**
 * Task tooltip of the calendar views: the planning one, with the assignees
 * (avatar and first name + last name) after the project. The planning grid
 * keeps its own.
 */
export function CalendarTaskTooltip({ task, children }: { task: TaskWithUsers; children: React.ReactNode }) {
  const t = useTranslations("planning.calendar");
  const { shown, more } = stackOf(task.users ?? [], TOOLTIP_PEOPLE);
  const people = shown.length > 0 ? (
    <div className="flex items-start gap-1.5">
      <Users className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <ul className="min-w-0 space-y-1">
        {shown.map((user) => (
          <li key={user.id} className="flex min-w-0 items-center gap-1.5">
            <UserAvatar user={{ name: user.name, color: user.color }} className="size-4" fallbackClassName="text-[7px] font-semibold" />
            <span className="truncate">{user.name}</span>
          </li>
        ))}
        {more > 0 && <li className="text-muted-foreground">{t("more", { count: more })}</li>}
      </ul>
    </div>
  ) : null;
  return (
    <TaskTooltip
      task={{
        ...task,
        createdAt: task.createdAt ? String(task.createdAt) : null,
        updatedAt: task.updatedAt ? String(task.updatedAt) : null,
      }}
      project={task.project}
      status={task.status}
      people={people}
    >
      {children}
    </TaskTooltip>
  );
}

function useCalendarDraggable(task: TaskWithUsers, draggableId: string, columnId: string) {
  const { canMoveTask, canCreateAnyTask } = usePermissions();
  const canDrag = (canMoveTask(task) || canCreateAnyTask) && task.isLocked !== true;
  const drag = useDraggable({ id: draggableId, data: { taskId: task.id, rowId: columnId }, disabled: !canDrag });
  const isPendingSource = usePlanningStore((s) => s.pendingDrop?.taskId === task.id);
  const isDeleting = usePlanningStore((s) => s.deletingTaskIds.has(task.id));
  return { ...drag, isPendingSource, isDeleting };
}

interface ItemProps {
  task: TaskWithUsers;
  /** Unique among the draggables of the view. */
  draggableId: string;
  /** Row of the task (calendar person), passed to the drop logic. */
  columnId: string;
  onClick: (taskId: string) => void;
  onContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  /** Calendar of everyone: the assignees of the task are shown. */
  showPeople?: boolean;
}

function clickHandlers(task: TaskWithUsers, onClick: ItemProps["onClick"], onContextMenu: ItemProps["onContextMenu"]) {
  return {
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick(task.id);
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (!onContextMenu) return;
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, task.id);
    },
  };
}

/** Time range of a task ("8h – 10h"), empty without times. */
function useTimeRange(task: TaskWithUsers): string {
  const { formatTime } = useDateFormat();
  if (!task.startTime) return "";
  return task.endTime ? `${formatTime(task.startTime)} – ${formatTime(task.endTime)}` : formatTime(task.startTime);
}

interface CalendarBarProps extends ItemProps {
  /** The task starts before / ends after the visible days: square edge. */
  clippedStart?: boolean;
  clippedEnd?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

/** Solid bar in the project color, over one or several days. */
export function CalendarBar({ task, draggableId, columnId, onClick, onContextMenu, showPeople, clippedStart, clippedEnd, style, className }: CalendarBarProps) {
  const t = useTranslations("planning");
  const { attributes, listeners, setNodeRef, isDragging, isPendingSource, isDeleting } = useCalendarDraggable(task, draggableId, columnId);
  const timeRange = useTimeRange(task);
  const bg = task.project?.color || TASK_FALLBACK_COLOR;
  const fg = contrastColor(bg);
  const headline = taskHeadline(task, t("canvas.untitled"));
  const secondary = task.title ? task.project?.name : null;

  return (
    <CalendarTaskTooltip task={task}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-task-id={task.id}
        className={cn(
          "flex h-[22px] min-w-0 cursor-pointer items-center gap-1 overflow-hidden px-1.5 text-[11px] leading-4 shadow-sm transition-[filter,opacity] hover:brightness-110",
          clippedStart ? "rounded-l-none" : "rounded-l",
          clippedEnd ? "rounded-r-none" : "rounded-r",
          isDeleting && "task-deleting",
          className,
        )}
        style={{
          backgroundColor: bg,
          color: fg,
          borderLeft: clippedStart ? undefined : `3px solid ${darkenColor(bg, 0.25)}`,
          opacity: isDragging || isPendingSource ? 0.4 : 1,
          ...style,
        }}
        {...clickHandlers(task, onClick, onContextMenu)}
      >
        {task.isLocked && <Lock className="size-2.5 shrink-0 opacity-80" aria-hidden />}
        {timeRange && <span className="shrink-0 tabular-nums opacity-80">{timeRange}</span>}
        <span className="truncate font-medium">{headline}</span>
        {secondary && <span className="hidden truncate opacity-75 xl:inline">· {secondary}</span>}
        {/* End of the bar: attachments, notes, milestone, then the assignees */}
        <CalendarTaskEnd task={task} after={showPeople ? <CalendarPeople users={task.users} /> : undefined} className="ml-auto pl-1" />
      </div>
    </CalendarTaskTooltip>
  );
}

/** One-line chip of a day of the month grid: dot in the project color, start time, title. */
export function CalendarChip({ task, draggableId, columnId, onClick, onContextMenu, showPeople }: ItemProps) {
  const t = useTranslations("planning");
  const { attributes, listeners, setNodeRef, isDragging, isPendingSource, isDeleting } = useCalendarDraggable(task, draggableId, columnId);
  const { formatTime } = useDateFormat();
  const color = task.project?.color || TASK_FALLBACK_COLOR;

  return (
    <CalendarTaskTooltip task={task}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-task-id={task.id}
        className={cn(
          // Right padding as on the bars (px-1.5): the avatars of chips and bars line up in a column
          "flex h-[22px] min-w-0 cursor-pointer items-center gap-1 rounded pl-1 pr-1.5 text-[11px] leading-4 text-foreground transition-[background-color,opacity]",
          "bg-[color-mix(in_srgb,var(--chip-color)_14%,transparent)] hover:bg-[color-mix(in_srgb,var(--chip-color)_28%,transparent)]",
          isDeleting && "task-deleting",
        )}
        style={{
          ["--chip-color" as string]: color,
          opacity: isDragging || isPendingSource ? 0.4 : 1,
        }}
        {...clickHandlers(task, onClick, onContextMenu)}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        {task.startTime && (
          <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(task.startTime)}</span>
        )}
        <span className="truncate">{taskHeadline(task, t("canvas.untitled"))}</span>
        {/* End of the chip: attachments, notes, milestone, the lock, then the assignees */}
        <CalendarTaskEnd
          task={task}
          after={task.isLocked || showPeople ? (
            <>
              {task.isLocked && <Lock className="size-2.5 shrink-0 text-muted-foreground" aria-hidden />}
              {showPeople && <CalendarPeople users={task.users} max={2} />}
            </>
          ) : undefined}
          className="ml-auto pl-1"
        />
      </div>
    </CalendarTaskTooltip>
  );
}
