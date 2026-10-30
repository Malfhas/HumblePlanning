"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { ClipboardCopy, ClipboardPaste, Copy, Edit, Lock, Move, Plus, Scissors, Trash2, Unlock, User, UserPlus, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

// --- Shared popup wrapper ---

function PopupMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Horizontal/vertical flip when the menu overflows the viewport. Uses
  // right/bottom rather than storing the measured width/height in state.
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Measures the menu size after render and flips on overflow.
  // useLayoutEffect = synchronous before paint → no visible flash.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setFlipH(x + r.width > window.innerWidth - 8);
    setFlipV(y + r.height > window.innerHeight - 8);
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[180px] rounded-lg border border-border/60 bg-popover/95 backdrop-blur-sm p-1 text-popover-foreground shadow-xl ring-1 ring-black/[0.04] animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        ...(flipH ? { right: window.innerWidth - x } : { left: x }),
        ...(flipV ? { bottom: window.innerHeight - y } : { top: y }),
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("taskForm.contextMenu");
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="menuitem"
            aria-disabled="true"
            className="flex w-full items-center rounded-md px-2 py-1.5 text-[12px] font-normal outline-none opacity-50 cursor-not-allowed text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5"
          >
            {icon}
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{t("permissionDenied")}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button
      role="menuitem"
      className={`flex w-full items-center rounded-md px-2 py-1.5 text-[12px] font-normal outline-none cursor-default transition-colors duration-75 [&>svg]:h-3.5 [&>svg]:w-3.5 ${
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground/90 hover:bg-accent hover:text-accent-foreground"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ConfirmMenuItem({
  icon,
  label,
  confirmLabel,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  confirmLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("taskForm.contextMenu");
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleClick = useCallback(() => {
    if (confirming) {
      clearTimeout(timerRef.current);
      onClick();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 2500);
    }
  }, [confirming, onClick]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="menuitem"
            aria-disabled="true"
            className="flex w-full items-center rounded-md px-2 py-1.5 text-[12px] font-normal outline-none opacity-50 cursor-not-allowed text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5"
          >
            {icon}
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{t("permissionDenied")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      role="menuitem"
      className={`flex w-full items-center rounded-md px-2 py-1.5 text-[12px] font-normal outline-none cursor-default transition-colors duration-75 [&>svg]:h-3.5 [&>svg]:w-3.5 ${
        confirming
          ? "bg-destructive text-destructive-foreground"
          : "text-destructive hover:bg-destructive/10"
      }`}
      onClick={handleClick}
    >
      {icon}
      {confirming ? confirmLabel : label}
    </button>
  );
}

// --- Context Menu ---

interface ContextMenuState {
  x: number;
  y: number;
  taskId?: string;
  rowId?: string;
  dateStr?: string;
  hour?: number;
}

interface PlanningContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
  hasClipboard: boolean;
  isMultiUser?: boolean;
  isRecurring?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canCopy?: boolean;
  canCut?: boolean;
  canDelete?: boolean;
  canPaste?: boolean;
  canLock?: boolean;
  isLocked?: boolean;
  onEditTask: (taskId: string) => void;
  onCopyTask: (taskId: string) => void;
  onCutTask: (taskId: string) => void;
  onDeleteTask: (taskId: string, rowId?: string) => void;
  onLockTask?: (taskId: string) => void;
  onCreateTask: (rowId: string, dateStr: string) => void;
  onPaste: (rowId: string, dateStr: string, hour?: number) => void;
}

export type { ContextMenuState };

export function PlanningContextMenu({
  state,
  onClose,
  hasClipboard,
  isMultiUser,
  isRecurring,
  canCreate = true,
  canEdit = true,
  canCopy = true,
  canCut = true,
  canDelete = true,
  canPaste = true,
  canLock = false,
  isLocked = false,
  onEditTask,
  onCopyTask,
  onCutTask,
  onDeleteTask,
  onLockTask,
  onCreateTask,
  onPaste,
}: PlanningContextMenuProps) {
  const t = useTranslations("taskForm.contextMenu");
  const tCommon = useTranslations("common");
  if (!state) return null;

  const isTask = !!state.taskId;
  const isCell = !state.taskId && !!state.rowId && !!state.dateStr;

  return (
    <PopupMenu x={state.x} y={state.y} onClose={onClose}>
      {isTask && (
        <>
          <MenuItem
            icon={<Edit className="mr-2 h-4 w-4" />}
            label={tCommon("actions.edit")}
            onClick={() => { onEditTask(state.taskId!); onClose(); }}
            disabled={!canEdit}
          />
          <MenuItem
            icon={<ClipboardCopy className="mr-2 h-4 w-4" />}
            label={tCommon("actions.copy")}
            onClick={() => { onCopyTask(state.taskId!); onClose(); }}
            disabled={!canCopy}
          />
          <MenuItem
            icon={<Scissors className="mr-2 h-4 w-4" />}
            label={t("cut")}
            onClick={() => { onCutTask(state.taskId!); onClose(); }}
            disabled={!canCut}
          />
          {canLock && onLockTask && (
            <MenuItem
              icon={isLocked ? <Unlock className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
              label={isLocked ? t("unlock") : t("lock")}
              onClick={() => { onLockTask(state.taskId!); onClose(); }}
            />
          )}
          <div className="my-1 h-px bg-border/60" />
          {isMultiUser || isRecurring ? (
            <MenuItem
              icon={<Trash2 className="mr-2 h-4 w-4" />}
              label={tCommon("actions.delete")}
              onClick={() => { onDeleteTask(state.taskId!, state.rowId); onClose(); }}
              destructive
              disabled={!canDelete}
            />
          ) : (
            <ConfirmMenuItem
              icon={<Trash2 className="mr-2 h-4 w-4" />}
              label={tCommon("actions.delete")}
              confirmLabel={t("confirmDelete")}
              onClick={() => { onDeleteTask(state.taskId!, state.rowId); onClose(); }}
              disabled={!canDelete}
            />
          )}
        </>
      )}
      {isCell && (
        <>
          <MenuItem
            icon={<Plus className="mr-2 h-4 w-4" />}
            label={t("newTask")}
            onClick={() => { onCreateTask(state.rowId!, state.dateStr!); onClose(); }}
            disabled={!canCreate}
          />
          {hasClipboard && (
            <MenuItem
              icon={<ClipboardPaste className="mr-2 h-4 w-4" />}
              label={t("paste")}
              onClick={() => { onPaste(state.rowId!, state.dateStr!, state.hour); onClose(); }}
              disabled={!canPaste}
            />
          )}
        </>
      )}
    </PopupMenu>
  );
}

// --- Drop Action Menu ---

interface DropActionMenuProps {
  position: { x: number; y: number } | null;
  isMultiUser?: boolean;
  canMove?: boolean;
  canCopy?: boolean;
  onClose: () => void;
  onMove: () => void;
  onMoveUser?: () => void;
  onCopy: () => void;
  /** When provided, shows an "Add this user" button that adds
   *  the target user to the task's assignees. */
  onAddUser?: () => void;
  /** When true, shows ONLY the "Add this user" button
   *  (multi-user drop → other user, same day). */
  addUserOnly?: boolean;
}

export function DropActionMenu({ position, isMultiUser, canMove = true, canCopy = true, onClose, onMove, onMoveUser, onCopy, onAddUser, addUserOnly = false }: DropActionMenuProps) {
  const t = useTranslations("taskForm.dropMenu");
  const tCommon = useTranslations("common");
  if (!position) return null;

  return (
    <PopupMenu x={position.x} y={position.y} onClose={onClose}>
      {onAddUser && (
        <MenuItem
          icon={<UserPlus className="mr-2 h-4 w-4" />}
          label={t("addUser")}
          onClick={() => { onAddUser(); onClose(); }}
        />
      )}
      {!addUserOnly && (
        <>
          {isMultiUser && onMoveUser && (
            <MenuItem
              icon={<User className="mr-2 h-4 w-4" />}
              label={t("moveThisUser")}
              onClick={() => { onMoveUser(); onClose(); }}
              disabled={!canMove}
            />
          )}
          <MenuItem
            icon={<Move className="mr-2 h-4 w-4" />}
            label={isMultiUser ? t("moveAll") : t("move")}
            onClick={() => { onMove(); onClose(); }}
            disabled={!canMove}
          />
          <MenuItem
            icon={<Copy className="mr-2 h-4 w-4" />}
            label={tCommon("actions.copy")}
            onClick={() => { onCopy(); onClose(); }}
            disabled={!canCopy}
          />
        </>
      )}
      <div className="my-1 h-px bg-border/60" />
      <MenuItem
        icon={<X className="mr-2 h-4 w-4" />}
        label={tCommon("actions.cancel")}
        onClick={onClose}
      />
    </PopupMenu>
  );
}
