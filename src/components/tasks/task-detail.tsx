"use client";

import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Pencil,
  CalendarDays,
  Clock,
  FolderKanban,
  Users,
  CircleDot,
  MapPin,
  Wrench,
  StickyNote,
  UserPen,
  Paperclip,
  Repeat,
  Truck,
  Download,
  ImageIcon,
  FileText,
  File,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { contrastColor } from "@/lib/utils";
import type { TaskWithUsers } from "@/types";

interface Collaborator {
  id: string;
  displayName: string;
  color: string;
}

interface TaskDetailProps {
  task: TaskWithUsers | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (task: TaskWithUsers) => void;
  collaborators?: Collaborator[];
}

function InfoRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground leading-none mb-0.5">{label}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

export function TaskDetail({ task, open, onOpenChange, onEdit, collaborators }: TaskDetailProps) {
  const t = useTranslations("tasks.detail");
  const tc = useTranslations("common");
  const { formatDate, formatDateTime, formatTime } = useDateFormat();
  const { can, canModifyTask } = usePermissions();
  const [previewFile, setPreviewFile] = useState<{ src: string; alt: string; type: "image" | "pdf" } | null>(null);
  const canViewFiles = can("files:view");

  if (!task) return null;

  const project = task.project;
  const status = task.status;
  const taskAny = task as Record<string, unknown>;
  const users = task.users ?? [];
  const place = task.place;
  const placeText = taskAny.placeText as string | null | undefined;
  const resource = task.resource;
  const files = (task.files ?? []) as { id: string; name: string; originalName: string; mimeType?: string }[];
  const notes = task.notes;
  const isRecurring = !!task.parentId;
  const isRootTask = task.parentId === task.id;
  const vehicleNames = (taskAny.vehicleNames as string[] | undefined) ?? [];
  const resourceNames = (taskAny.resourceNames as string[] | undefined) ?? [];
  const showModifier = task.lastModifier?.name && task.updatedAt && task.createdAt && task.updatedAt !== task.createdAt;
  const canEdit = onEdit && canModifyTask(task);

  // Date range display
  const dateRange = (() => {
    const start = formatDate(task.startDate);
    if (!task.endDate || task.endDate === task.startDate) return start;
    return `${start} → ${formatDate(task.endDate)}`;
  })();

  // Time display
  const timeRange = (() => {
    if (!task.startTime) return null;
    const start = formatTime(task.startTime);
    if (!task.endTime) return start;
    return `${start} – ${formatTime(task.endTime)}`;
  })();

  // Recurrence label
  const recurLabel = (() => {
    if (!isRecurring) return null;
    if (!isRootTask) return t("recurrence.occurrence");
    return t("recurrence.rule", { type: task.recurType ?? "", freq: task.recurFrequency ?? 1 });
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg leading-tight pr-8">
            {task.title || (project ? "" : t("untitled"))}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("srDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-0.5 -mt-1">
          {/* Project */}
          {project && (
            <InfoRow icon={FolderKanban} label={t("fields.project")}>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: project.color || "#ccc" }}
                />
                <span className="font-medium">
                  {project.businessNumber ? `[${project.businessNumber}] ` : ""}{project.name}
                </span>
              </div>
            </InfoRow>
          )}

          {/* Status */}
          {status && (
            <InfoRow icon={CircleDot} label={t("fields.status")}>
              <Badge
                variant="outline"
                style={{
                  borderColor: status.color ?? undefined,
                  color: status.color ?? undefined,
                  backgroundColor: status.color ? `${status.color}15` : undefined,
                }}
              >
                {status.name}
              </Badge>
            </InfoRow>
          )}

          {/* Dates */}
          <InfoRow icon={CalendarDays} label={t("fields.dates")}>
            {dateRange}
          </InfoRow>

          {/* Times */}
          {timeRange && (
            <InfoRow icon={Clock} label={t("fields.times")}>
              {timeRange}
            </InfoRow>
          )}

          {/* Users */}
          {users.length > 0 && (
            <InfoRow icon={Users} label={t("fields.users", { count: users.length })}>
              {users.map((u: any) => u.name || "—").join(", ")}
            </InfoRow>
          )}

          {/* Place */}
          {(place || placeText) && (
            <InfoRow icon={MapPin} label={t("fields.place")}>
              {place?.name ?? placeText ?? "—"}
            </InfoRow>
          )}

          {/* Resource */}
          {resource && (
            <InfoRow icon={Wrench} label={t("fields.resource")}>
              {resource.name}
            </InfoRow>
          )}

          {/* Linked vehicles */}
          {vehicleNames.length > 0 && (
            <InfoRow icon={Truck} label={t("fields.vehicles")}>
              {vehicleNames.join(", ")}
            </InfoRow>
          )}

          {/* Linked resources */}
          {resourceNames.length > 0 && (
            <InfoRow icon={Wrench} label={t("fields.linkedResources")}>
              {resourceNames.join(", ")}
            </InfoRow>
          )}

          {/* Collaborators (same project, same day) */}
          {collaborators && collaborators.length > 0 && (
            <InfoRow icon={Users} label={t("fields.sameSite", { count: collaborators.length })}>
              <div className="flex flex-wrap gap-1">
                {collaborators.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none"
                    style={{ backgroundColor: c.color, color: contrastColor(c.color) }}
                  >
                    {c.displayName}
                  </span>
                ))}
              </div>
            </InfoRow>
          )}

          {/* Worksite address (project) */}
          {project?.address && (
            <InfoRow icon={MapPin} label={t("fields.siteAddress")}>
              <span className="text-muted-foreground">{project.address}</span>
            </InfoRow>
          )}

          {/* Recurrence */}
          {recurLabel && (
            <InfoRow icon={Repeat} label={t("fields.recurrence")}>
              {recurLabel}
            </InfoRow>
          )}

          {/* Notes */}
          {notes && (
            <InfoRow icon={StickyNote} label={t("fields.notes")}>
              <p className="whitespace-pre-wrap">{notes}</p>
            </InfoRow>
          )}

          {/* Files */}
          {canViewFiles && files.length > 0 && (
            <InfoRow icon={Paperclip} label={t("fields.files", { count: files.length })}>
              <div className="space-y-1.5">
                {files.map((f) => {
                  const fileUrl = `/api/files/tasks/${task.id}/${f.name}`;
                  const isImage = f.mimeType?.startsWith("image/");
                  const isPdf = f.mimeType === "application/pdf";
                  const isPreviewable = isImage || isPdf;
                  const FileIcon = isImage ? ImageIcon : isPdf ? FileText : File;
                  return (
                    <div key={f.id} className="flex items-center gap-2 group">
                      <FileIcon className={`h-3.5 w-3.5 shrink-0 ${isImage ? "text-blue-500" : isPdf ? "text-red-500" : "text-muted-foreground"}`} />
                      <span
                        className={`text-xs truncate flex-1 ${isPreviewable ? "cursor-pointer hover:underline" : ""}`}
                        onClick={isPreviewable ? () => setPreviewFile({ src: fileUrl, alt: f.originalName, type: isImage ? "image" : "pdf" }) : undefined}
                      >
                        {f.originalName}
                      </span>
                      <a
                        href={fileUrl}
                        download={f.originalName}
                        className="shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Download className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                      </a>
                    </div>
                  );
                })}
              </div>
            </InfoRow>
          )}

          {/* Creator / Last editor */}
          {(task.creator?.name || showModifier) && (
            <div className="border-t mt-3 pt-2 space-y-0.5">
              {task.creator?.name && task.createdAt && (
                <InfoRow icon={UserPen} label={t("fields.createdBy")}>
                  <span className="text-muted-foreground">
                    {task.creator.name} — {formatDateTime(task.createdAt)}
                  </span>
                </InfoRow>
              )}
              {showModifier && (
                <InfoRow icon={Pencil} label={t("fields.modifiedBy")}>
                  <span className="text-muted-foreground">
                    {task.lastModifier!.name} — {formatDateTime(task.updatedAt)}
                  </span>
                </InfoRow>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        {canEdit && (
          <div className="flex justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => onEdit!(task)}>
              <Pencil className="h-4 w-4 mr-1" />
              {tc("actions.edit")}
            </Button>
          </div>
        )}
      </DialogContent>

      {/* File preview overlay */}
      {previewFile && (
        <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
          <DialogContent className={`p-4 pt-12 sm:p-6 sm:pt-12 ${previewFile.type === "pdf" ? "sm:max-w-[95vw] w-[95vw]" : "sm:max-w-5xl w-[95vw]"}`}>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("preview")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              {previewFile.type === "image" ? (
                <img src={previewFile.src} alt={previewFile.alt} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
              ) : (
                <iframe src={previewFile.src} title={previewFile.alt} className="w-full rounded-lg border" style={{ height: "80vh" }} />
              )}
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">{previewFile.alt}</p>
                <a href={previewFile.src} download={previewFile.alt} className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3">
                  <Download className="h-4 w-4 mr-1.5" />
                  {tc("actions.download")}
                </a>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
