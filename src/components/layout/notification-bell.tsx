"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, BellOff, CheckCheck, Plus, Trash2, Pencil, Paperclip, FileX, UserPlus, UserMinus, RefreshCw, Calendar, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useNotifications, useMarkAsRead, useMarkAllAsRead, useDeleteNotification, useDeleteAllNotifications } from "@/hooks/use-notifications";
import { useTaskPreviewStore } from "@/stores/task-preview-store";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import { useNotificationText } from "@/i18n/notification-text";
import { hasDyn, tDyn } from "@/i18n/dynamic";

const TASK_NOTIFICATION_TYPES = new Set([
  "task_created", "task_updated", "task_title_changed", "task_dates_changed",
  "task_times_changed", "task_status_changed", "task_project_changed",
  "task_notes_changed", "task_user_added", "task_user_removed",
  "task_file_added", "task_file_deleted",
]);

const TYPE_ICONS: Record<string, React.ElementType> = {
  task_created: Plus,
  task_deleted: Trash2,
  task_updated: Pencil,
  task_title_changed: Pencil,
  task_dates_changed: Calendar,
  task_times_changed: Calendar,
  task_status_changed: RefreshCw,
  task_project_changed: RefreshCw,
  task_notes_changed: Pencil,
  task_user_added: UserPlus,
  task_user_removed: UserMinus,
  task_file_added: Paperclip,
  task_file_deleted: FileX,
};

const TYPE_COLORS: Record<string, string> = {
  task_created: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  task_deleted: "bg-red-500/15 text-red-600 dark:text-red-400",
  task_updated: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  task_title_changed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  task_dates_changed: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  task_times_changed: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  task_status_changed: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  task_project_changed: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  task_notes_changed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  task_user_added: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  task_user_removed: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  task_file_added: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  task_file_deleted: "bg-red-500/15 text-red-600 dark:text-red-400",
};

// Type badge: notifications.types.<type> (no badge for a type without a label)
// i18n-dynamic: notifications.types.*

export function NotificationBell() {
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common.actions");
  const notificationText = useNotificationText();
  const { formatRelative } = useDateFormat();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data } = useNotifications(1);
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const deleteNotification = useDeleteNotification();
  const deleteAll = useDeleteAllNotifications();
  const openTaskPreview = useTaskPreviewStore((s) => s.openPreview);

  const notifications = data?.data ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const allRead = unreadCount === 0 && notifications.length > 0;

  function handleClick(notif: { id: string; type: string; isRead: boolean; actionUrl?: string | null }) {
    if (!notif.isRead) {
      markAsRead.mutate(notif.id);
    }
    // Task notifications: open preview dialog instead of navigating
    if (TASK_NOTIFICATION_TYPES.has(notif.type) && notif.actionUrl) {
      const match = notif.actionUrl.match(/[?&]id=([^&]+)/);
      if (match) {
        setOpen(false);
        openTaskPreview(match[1]);
        return;
      }
    }
    if (notif.actionUrl) {
      setOpen(false);
      router.push(notif.actionUrl);
    }
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    deleteNotification.mutate(id);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("bell.ariaLabel")}>
          <Bell className={cn("size-5", unreadCount > 0 && "animate-[bell-ring_1s_ease-in-out_infinite]")} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* max-w: the popover (384 px) overflowed the screen at 375 px */}
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)] p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">{t("bell.title")}</span>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              {t("bell.markAllRead")}
            </Button>
          ) : allRead ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteAll.mutate()}
              disabled={deleteAll.isPending}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              {t("bell.deleteAll")}
            </Button>
          ) : null}
        </div>

        {/* List */}
        <div className="max-h-[28rem] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <BellOff className="h-8 w-8" />
              <span className="text-sm">{t("bell.empty")}</span>
            </div>
          ) : (
            notifications.map((notif) => {
              const Icon = TYPE_ICONS[notif.type] ?? Bell;
              const iconColor = TYPE_COLORS[notif.type] ?? "bg-muted text-muted-foreground";
              const typeKey = `types.${notif.type}`;
              const label = hasDyn(t, typeKey) ? tDyn(t, typeKey) : "";
              const text = notificationText(notif);
              return (
                <div
                  key={notif.id}
                  className={cn(
                    "group/notif flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent border-b border-border/40 last:border-b-0 cursor-pointer",
                    !notif.isRead && "bg-primary/5"
                  )}
                  onClick={() => handleClick(notif)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") handleClick(notif); }}
                >
                  <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", iconColor)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm leading-tight truncate", !notif.isRead ? "font-semibold" : "font-medium")}>
                        {text.title}
                      </p>
                      {label && (
                        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {label}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {text.message}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground/50">
                      {formatRelative(new Date(notif.createdAt))}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {notif.isRead && (
                      <button
                        onClick={(e) => handleDelete(e, notif.id)}
                        className="hidden group-hover/notif:flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title={tCommon("delete")}
                        aria-label={tCommon("delete")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!notif.isRead && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
