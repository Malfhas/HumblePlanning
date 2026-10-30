"use client";

import { useState, useEffect } from "react";
import { useAllFiles, usePurgeFiles, useDeleteFile } from "@/hooks/use-files";
import { socket } from "@/lib/socket-client";
import { useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/use-permissions";
import { StorageStats, UserStorageChart } from "@/components/shared/storage-stats";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Paperclip,
  CalendarDays,
  Search,
  Download,
  Trash2,
  ImageIcon,
  FileText,
  File,
  Loader2,
  Eye,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/shared/error-state";
import { useTaskPreviewStore } from "@/stores/task-preview-store";
import { TruncatedCell } from "@/components/shared/truncated-cell";

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="h-4 w-4 text-blue-500" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4 text-red-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}


export default function FilesPage() {
  const t = useTranslations("admin.files");
  const ta = useTranslations("admin.common");
  const tc = useTranslations("common");
  const { format: formatLocalized, formatDateTime, formatNumber } = useDateFormat();
  const queryClient = useQueryClient();
  const openPreview = useTaskPreviewStore((s) => s.openPreview);

  useEffect(() => {
    const handleChanged = () => {
      queryClient.refetchQueries({ queryKey: ["files"] });
      queryClient.refetchQueries({ queryKey: ["storage-stats"] });
    };
    socket.on("audit:changed", handleChanged);
    socket.on("task:changed", handleChanged);
    return () => {
      socket.off("audit:changed", handleChanged);
      socket.off("task:changed", handleChanged);
    };
  }, [queryClient]);

  const [search, setSearch] = useState("");
  const [fileType, setFileType] = useState<"image" | "pdf" | "other" | "">("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDate, setPurgeDate] = useState("");
  const [purgeDateOpen, setPurgeDateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ taskId: string; fileId: string; name: string } | null>(null);
  const [previewFile, setPreviewFile] = useState<{ src: string; alt: string; type: "image" | "pdf" } | null>(null);

  const { can, isLoading: permLoading } = usePermissions();
  const purgeFiles = usePurgeFiles();
  const deleteFile = useDeleteFile();

  const filters = {
    ...(search && { search }),
    ...(fileType && { fileType: fileType as "image" | "pdf" | "other" }),
    ...(dateStart && { dateStart }),
    ...(dateEnd && { dateEnd }),
    page,
    limit,
  };

  const { data, isLoading } = useAllFiles(filters);
  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  /** Human-readable size, units and decimal separator per language (o/Ko/Mo/Go, B/KB/MB/GB). */
  const formatFileSize = (bytes: number) => {
    const one = (n: number) => formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (bytes < 1024) return t("size.bytes", { value: formatNumber(bytes) });
    if (bytes < 1024 * 1024) return t("size.kb", { value: one(bytes / 1024) });
    if (bytes < 1024 * 1024 * 1024) return t("size.mb", { value: one(bytes / (1024 * 1024)) });
    return t("size.gb", { value: one(bytes / (1024 * 1024 * 1024)) });
  };

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:files")) return <ErrorState code={403} compact showBack={false} />;

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Paperclip className="h-6 w-6" />
          {t("title")}
        </h1>
        <Button variant="destructive" size="sm" onClick={() => setPurgeOpen(true)}>
          {t("purge")}
        </Button>
      </div>

      {/* Storage stats */}
      <StorageStats className="w-full" />
      <UserStorageChart className="w-full" />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 w-[240px]"
          />
        </div>

        <Select value={fileType || "all"} onValueChange={(v) => { setFileType(v === "all" ? "" : v as "image" | "pdf" | "other"); setPage(1); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder={t("types.placeholder")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("types.all")}</SelectItem>
            <SelectItem value="image">{t("types.image")}</SelectItem>
            <SelectItem value="pdf">{t("types.pdf")}</SelectItem>
            <SelectItem value="other">{t("types.other")}</SelectItem>
          </SelectContent>
        </Select>

        <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-[170px] justify-start text-left font-normal", !dateStart && "text-muted-foreground")}>
              <CalendarDays className="mr-2 h-4 w-4" />
              {dateStart ? formatLocalized(parseISO(dateStart), "d MMM yyyy") : t("startDate")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateStart ? parseISO(dateStart) : undefined}
              onSelect={(date) => { setDateStart(date ? format(date, "yyyy-MM-dd") : ""); setStartDateOpen(false); setPage(1); }}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>

        <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-[170px] justify-start text-left font-normal", !dateEnd && "text-muted-foreground")}>
              <CalendarDays className="mr-2 h-4 w-4" />
              {dateEnd ? formatLocalized(parseISO(dateEnd), "d MMM yyyy") : t("endDate")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateEnd ? parseISO(dateEnd) : undefined}
              onSelect={(date) => { setDateEnd(date ? format(date, "yyyy-MM-dd") : ""); setEndDateOpen(false); setPage(1); }}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>

        {(search || fileType || dateStart || dateEnd) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(""); setFileType(""); setDateStart(""); setDateEnd(""); setPage(1); }}
          >
            {tc("actions.reset")}
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="flex flex-col gap-3 flex-1 min-h-0">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.data.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">{t("empty")}</p>
      ) : (
        <>
          <div className="rounded-md border flex-1 min-h-0 overflow-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[48px] sticky top-0 z-10 bg-background" />
                  <TableHead className="sticky top-0 z-10 bg-background">{t("columns.name")}</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("columns.task")}</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("columns.project")}</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("columns.uploadedBy")}</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("columns.date")}</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("columns.hash")}</TableHead>
                  <TableHead className="text-right sticky top-0 z-10 bg-background">{t("columns.size")}</TableHead>
                  <TableHead className="text-right sticky top-0 z-10 bg-background">{tc("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((file) => {
                  const isImage = file.mimeType.startsWith("image/");
                  const isPdf = file.mimeType === "application/pdf";
                  const isPreviewable = isImage || isPdf;
                  const fileUrl = `/api/files/tasks/${file.taskId}/${file.name}`;

                  return (
                  <TableRow key={`${file.taskId}-${file.fileId}`}>
                    <TableCell className="px-2">
                      {isImage ? (
                        <img
                          src={fileUrl}
                          alt={file.originalName}
                          className="h-8 w-8 rounded object-cover cursor-pointer hover:ring-2 hover:ring-primary"
                          onClick={() => setPreviewFile({ src: fileUrl, alt: file.originalName, type: "image" })}
                        />
                      ) : isPdf ? (
                        <div
                          className="h-8 w-8 rounded flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary bg-red-50"
                          onClick={() => setPreviewFile({ src: fileUrl, alt: file.originalName, type: "pdf" })}
                        >
                          <FileText className="h-5 w-5 text-red-500" />
                        </div>
                      ) : (
                        <File className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn("block max-w-[220px] truncate font-medium text-sm", isPreviewable && "cursor-pointer hover:underline")}
                            onClick={() => {
                              if (isImage) setPreviewFile({ src: fileUrl, alt: file.originalName, type: "image" });
                              else if (isPdf) setPreviewFile({ src: fileUrl, alt: file.originalName, type: "pdf" });
                            }}
                          >
                            {file.originalName}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm break-words">{file.originalName}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <TruncatedCell value={file.taskTitle} maxWidth="max-w-[180px]" />
                    </TableCell>
                    <TableCell>
                      {file.projectName ? (
                        <TruncatedCell value={file.projectName} maxWidth="max-w-[220px]" />
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      <TruncatedCell value={file.uploaderName} maxWidth="max-w-[160px]" />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(file.uploadedAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      <TruncatedCell value={(file as any).storageKey?.split(".")[0] ?? "—"} maxWidth="max-w-[100px]" />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground text-right">
                      {formatFileSize(Number(file.size))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => openPreview(file.taskId)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("viewTask")}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={fileUrl}
                              download={file.originalName}
                              className="inline-flex items-center justify-center rounded-md h-7 w-7 hover:bg-accent hover:text-accent-foreground"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </TooltipTrigger>
                          <TooltipContent>{tc("actions.download")}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget({ taskId: file.taskId, fileId: file.fileId, name: file.originalName })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{tc("actions.delete")}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {ta("total", { count: data.total })}
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs">{ta("perPage")}</span>
                <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}>
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
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2">
                  {page} / {totalPages || 1}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
      </div>

      {/* Delete confirm dialog */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("deleteDialog.title")}
        description={t("deleteDialog.description", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => {
          if (deleteTarget) {
            deleteFile.mutate(
              { taskId: deleteTarget.taskId, fileId: deleteTarget.fileId },
              { onSuccess: () => setDeleteTarget(null) }
            );
          }
        }}
        isPending={deleteFile.isPending}
      />

      {/* Purge dialog */}
      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("purgeDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("purgeDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Popover open={purgeDateOpen} onOpenChange={setPurgeDateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !purgeDate && "text-muted-foreground")}>
                <CalendarDays className="mr-2 h-4 w-4" />
                {purgeDate ? formatLocalized(parseISO(purgeDate), "d MMMM yyyy") : t("purgeDialog.datePlaceholder")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={purgeDate ? parseISO(purgeDate) : undefined}
                onSelect={(date) => { setPurgeDate(date ? format(date, "yyyy-MM-dd") : ""); setPurgeDateOpen(false); }}
                weekStartsOn={1}
              />
            </PopoverContent>
          </Popover>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeFiles.isPending}>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!purgeDate || purgeFiles.isPending}
              onClick={() => {
                purgeFiles.mutate(purgeDate, {
                  onSuccess: () => { setPurgeOpen(false); setPurgeDate(""); },
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("purge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* File preview dialog */}
      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <DialogContent className={`p-4 pt-12 sm:p-6 sm:pt-12 ${previewFile?.type === "pdf" ? "sm:max-w-[95vw] w-[95vw]" : "sm:max-w-5xl w-[95vw]"} [&>[data-slot=dialog-close]]:z-10 [&>[data-slot=dialog-close]]:bg-background/80 [&>[data-slot=dialog-close]]:backdrop-blur-sm [&>[data-slot=dialog-close]]:rounded-full [&>[data-slot=dialog-close]]:shadow-sm`}>
          <VisuallyHidden><DialogTitle>{t("previewTitle")}</DialogTitle></VisuallyHidden>
          {previewFile && (
            <div className="flex flex-col items-center gap-3">
              {previewFile.type === "image" ? (
                <img
                  src={previewFile.src}
                  alt={previewFile.alt}
                  className="max-h-[80vh] max-w-full rounded-lg object-contain"
                />
              ) : (
                <iframe
                  src={previewFile.src}
                  title={previewFile.alt}
                  className="w-full rounded-lg border"
                  style={{ height: "80vh" }}
                />
              )}
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">{previewFile.alt}</p>
                <a
                  href={previewFile.src}
                  download={previewFile.alt}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  {tc("actions.download")}
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
