"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Upload, X, FileText, Loader2, Download } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConfig } from "@/hooks/use-config";
import { ApiClientError } from "@/lib/api-client";
import { clientFallbackMessage, fallbackMessageForStatus } from "@/i18n/client-fallback";

export interface FileMetadata {
  id: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy?: string;
}

interface FileUploadProps {
  taskId: string;
  files: FileMetadata[];
  pendingFiles?: File[];
  onPendingFileAdded?: (file: File) => void;
  onPendingFileRemoved?: (index: number) => void;
  onFileDeleted: (fileId: string) => void;
  deferDelete?: boolean;
  readOnly?: boolean;
  canDelete?: boolean;
  hideDropzone?: boolean;
}

type Translator = ReturnType<typeof useTranslations<"ui.fileUpload">>;

/** Human-readable size in the current language: « 1,5 Ko » / « 1.5 KB ». */
function formatFileSize(t: Translator, bytes: number): string {
  if (bytes < 1024) return t("size.bytes", { n: bytes });
  if (bytes < 1024 * 1024) return t("size.kb", { n: Math.round((bytes / 1024) * 10) / 10 });
  return t("size.mb", { n: Math.round((bytes / (1024 * 1024)) * 10) / 10 });
}

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function FileUpload({
  taskId,
  files,
  pendingFiles = [],
  onPendingFileAdded,
  onPendingFileRemoved,
  onFileDeleted,
  deferDelete,
  readOnly,
  canDelete = true,
  hideDropzone,
}: FileUploadProps) {
  const t = useTranslations("ui.fileUpload");
  const tCommon = useTranslations("common.actions");
  const { data: config } = useConfig();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [previewFile, setPreviewFile] = useState<{ src: string; alt: string; downloadUrl: string; filename: string; type: "image" | "pdf" } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const allowedExtensions = (config?.WHITELIST_UPLOAD || "pdf,png,jpg,jpeg,gif,webp").split(",").map(e => e.trim());
  const maxSizeMB = parseInt(config?.MAX_UPLOAD_SIZE_MB || "10", 10);
  const maxTotalSizeMB = parseInt(config?.MAX_TOTAL_SIZE_MB || "25", 10);
  const maxFiles = parseInt(config?.MAX_FILES_PER_TASK || "5", 10);
  const uploadDisabled = readOnly || config?.ENABLE_FILE_UPLOAD === "false";

  const totalCount = files.length + pendingFiles.length;
  const currentTotalSize = files.reduce((sum, f) => sum + f.size, 0) + pendingFiles.reduce((sum, f) => sum + f.size, 0);

  useEffect(() => {
    const newPreviews: Record<number, string> = {};
    const urls: string[] = [];
    pendingFiles.forEach((file, i) => {
      if (IMAGE_MIMES.includes(file.type) || file.type === "application/pdf") {
        const url = URL.createObjectURL(file);
        newPreviews[i] = url;
        urls.push(url);
      }
    });
    setPreviews(newPreviews);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [pendingFiles]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setDropError(null);
    let currentCount = files.length + pendingFiles.length;
    let runningTotalSize = files.reduce((sum, f) => sum + f.size, 0) + pendingFiles.reduce((sum, f) => sum + f.size, 0);
    const maxTotalBytes = maxTotalSizeMB * 1024 * 1024;
    const errors: string[] = [];
    for (const file of acceptedFiles) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!allowedExtensions.includes(ext)) {
        errors.push(t("errors.extension", { name: file.name, ext }));
        continue;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        errors.push(t("errors.tooLarge", { name: file.name, size: formatFileSize(t, file.size), max: maxSizeMB }));
        continue;
      }
      if (currentCount >= maxFiles) {
        errors.push(t("errors.maxFiles", { name: file.name, max: maxFiles }));
        break;
      }
      if (runningTotalSize + file.size > maxTotalBytes) {
        errors.push(t("errors.totalSize", { name: file.name, max: maxTotalSizeMB }));
        break;
      }
      onPendingFileAdded?.(file);
      currentCount++;
      runningTotalSize += file.size;
    }
    if (errors.length > 0) {
      setDropError(errors.join("\n"));
      setTimeout(() => setDropError(null), 6000);
    }
  }, [allowedExtensions, maxSizeMB, maxTotalSizeMB, maxFiles, files, pendingFiles, onPendingFileAdded, t]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: uploadDisabled || totalCount >= maxFiles || currentTotalSize >= maxTotalSizeMB * 1024 * 1024,
  });

  const handleDelete = async (fileId: string) => {
    if (deferDelete) {
      onFileDeleted(fileId);
      return;
    }
    setDeleting(fileId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/files?fileId=${fileId}`, { method: "DELETE" });
      if (res.ok) {
        onFileDeleted(fileId);
      }
    } finally {
      setDeleting(null);
    }
  };

  const getServerFileUrl = (file: FileMetadata) => `/api/files/tasks/${taskId}/${file.name}`;

  return (
    <div className="space-y-3">
      {/* Dropzone — hidden when upload is disabled or explicitly hidden */}
      {!hideDropzone && !uploadDisabled && totalCount < maxFiles && currentTotalSize < maxTotalSizeMB * 1024 * 1024 && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("dropzone")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("limits", { extensions: allowedExtensions.join(", "), maxSize: maxSizeMB, maxTotal: maxTotalSizeMB })}
          </p>
        </div>
      )}

      {/* Drop error message */}
      {dropError && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 whitespace-pre-line">
          {dropError}
        </div>
      )}

      {/* Existing uploaded files */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((file) => {
            const isImage = IMAGE_MIMES.includes(file.mimeType);
            const fileUrl = getServerFileUrl(file);
            return (
              <div key={file.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group">
                {isImage ? (
                  <img
                    src={fileUrl}
                    alt={file.originalName}
                    className="h-8 w-8 rounded object-cover cursor-pointer hover:ring-2 hover:ring-primary"
                    onClick={() => setPreviewFile({ src: fileUrl, alt: file.originalName, downloadUrl: fileUrl, filename: file.originalName, type: "image" })}
                  />
                ) : file.mimeType === "application/pdf" ? (
                  <div
                    className="h-8 w-8 rounded flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary bg-red-50"
                    onClick={() => setPreviewFile({ src: fileUrl, alt: file.originalName, downloadUrl: fileUrl, filename: file.originalName, type: "pdf" })}
                  >
                    <FileText className="h-5 w-5 text-red-500" />
                  </div>
                ) : (
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <div
                  className={`flex-1 min-w-0 ${isImage || file.mimeType === "application/pdf" ? "cursor-pointer" : ""}`}
                  onClick={() => {
                    if (isImage) setPreviewFile({ src: fileUrl, alt: file.originalName, downloadUrl: fileUrl, filename: file.originalName, type: "image" });
                    else if (file.mimeType === "application/pdf") setPreviewFile({ src: fileUrl, alt: file.originalName, downloadUrl: fileUrl, filename: file.originalName, type: "pdf" });
                  }}
                >
                  <p className="text-sm truncate">{file.originalName}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(t, file.size)}</p>
                </div>
                {/* Download as real <a> to avoid dialog close */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={fileUrl}
                      download={file.originalName}
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={tCommon("download")}
                    >
                      <Download className="h-3 w-3" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>{tCommon("download")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("h-6 w-6 p-0 opacity-0 group-hover:opacity-100", (!canDelete || readOnly) && "hidden")}
                      onClick={(e) => { e.stopPropagation(); handleDelete(file.id); }}
                      disabled={deleting === file.id || !canDelete}
                      aria-label={tCommon("delete")}
                    >
                      {deleting === file.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tCommon("delete")}</TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending local files (not yet uploaded) */}
      {pendingFiles.length > 0 && (
        <div className="space-y-1">
          {pendingFiles.map((file, i) => {
            const isImage = IMAGE_MIMES.includes(file.type);
            const isPdf = file.type === "application/pdf";
            return (
              <div key={`pending-${i}`} className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 group border border-dashed border-primary/30 bg-primary/5">
                {isImage && previews[i] ? (
                  <img
                    src={previews[i]}
                    alt={file.name}
                    className="h-8 w-8 rounded object-cover cursor-pointer hover:ring-2 hover:ring-primary"
                    onClick={() => setPreviewFile({ src: previews[i], alt: file.name, downloadUrl: "", filename: file.name, type: "image" })}
                  />
                ) : isPdf && previews[i] ? (
                  <div
                    className="h-8 w-8 rounded flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary bg-red-50"
                    onClick={() => setPreviewFile({ src: previews[i], alt: file.name, downloadUrl: "", filename: file.name, type: "pdf" })}
                  >
                    <FileText className="h-5 w-5 text-red-500" />
                  </div>
                ) : (
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(t, file.size)}</p>
                </div>
                <span className="text-[10px] text-primary font-medium shrink-0">{t("pending")}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                  onClick={() => onPendingFileRemoved?.(i)}
                  aria-label={tCommon("remove")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Counter */}
      {(totalCount > 0 || !uploadDisabled) && (
        <p className="text-xs text-muted-foreground text-right">
          {t("counter", { count: totalCount, max: maxFiles, size: formatFileSize(t, currentTotalSize), maxTotal: maxTotalSizeMB })}
        </p>
      )}

      {/* File preview dialog (image or PDF)
        *
        * Mobile: the shadcn `DialogContent` goes full-screen by default
        * (see ui/dialog.tsx: `top-0 right-0 bottom-0 left-0` < sm). We do NOT
        * override the mobile width (the previous `w-[95vw]` broke
        * this behavior and added a useless 5% margin + an unexpected rounded
        * frame around the preview).
        * Desktop: the width is capped via `sm:max-w-*` so it does not take
        * the full width on large screens.
        */}
      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        <DialogContent className={`p-4 pt-12 sm:p-6 sm:pt-12 ${previewFile?.type === "pdf" ? "sm:max-w-[95vw]" : "sm:max-w-5xl"} [&>[data-slot=dialog-close]]:z-10 [&>[data-slot=dialog-close]]:bg-background/80 [&>[data-slot=dialog-close]]:backdrop-blur-sm [&>[data-slot=dialog-close]]:rounded-full [&>[data-slot=dialog-close]]:shadow-sm`}>
          <VisuallyHidden><DialogTitle>{t("preview")}</DialogTitle></VisuallyHidden>
          {previewFile && (
            <div className="flex flex-col items-center gap-3">
              {previewFile.type === "image" ? (
                <img
                  src={previewFile.src}
                  alt={previewFile.alt}
                  // `rounded-lg` removed: the preview must show the raw
                  // image, without a rounded frame that could clip the corners
                  // (and created a visual offset with the background area).
                  className="max-h-[80vh] max-w-full object-contain"
                />
              ) : (
                <iframe
                  src={previewFile.src}
                  title={previewFile.alt}
                  // `rounded-lg` removed (consistent with the image) + `border-0`
                  // to remove the "lines" around the PDF (default browser
                  // border on `<iframe>`).
                  className="w-full border-0"
                  style={{ height: "80vh" }}
                />
              )}
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">{previewFile.alt}</p>
                {previewFile.downloadUrl && (
                  <a
                    href={previewFile.downloadUrl}
                    download={previewFile.filename}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    {tCommon("download")}
                  </a>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Upload a single file to the server with progress tracking */
export function uploadFileToServer(
  taskId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<FileMetadata> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/tasks/${taskId}/files`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        // Message already translated by the server (request language), otherwise fallback based on the status
        let body: { error?: unknown; code?: unknown; params?: Record<string, string | number> } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // non-JSON body: generic fallback
        }
        reject(new ApiClientError(
          (typeof body.error === "string" && body.error) || fallbackMessageForStatus(xhr.status),
          xhr.status,
          typeof body.code === "string" ? body.code : undefined,
          body.params,
        ));
      }
    };

    xhr.onerror = () => reject(new ApiClientError(clientFallbackMessage("network"), 0));
    xhr.send(formData);
  });
}
