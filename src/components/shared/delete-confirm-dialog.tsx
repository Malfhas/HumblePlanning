"use client";

import { useTranslations } from "next-intl";
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
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  onConfirm: () => void;
  onArchive?: () => void;
  isPending?: boolean;
  confirmLabel?: string;
  archiveLabel?: string;
  variant?: "default" | "danger";
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title: titleProp,
  description: descriptionProp,
  onConfirm,
  onArchive,
  isPending,
  confirmLabel: confirmLabelProp,
  archiveLabel: archiveLabelProp,
  variant = "default",
}: DeleteConfirmDialogProps) {
  const t = useTranslations("common");
  const tUi = useTranslations("ui.deleteConfirm");
  // Translated default labels; those passed by the caller take precedence.
  const title = titleProp ?? t("confirm.deleteTitle");
  const description = descriptionProp ?? tUi("description");
  const confirmLabel = confirmLabelProp ?? t("actions.delete");
  const archiveLabel = archiveLabelProp ?? t("actions.archive");
  const isDanger = variant === "danger";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={isDanger ? "border-red-200 dark:border-red-900/50 overflow-hidden p-0" : undefined}>
        {isDanger && (
          <div className="bg-gradient-to-b from-red-50 to-transparent dark:from-red-950/40 dark:to-transparent px-6 pt-6 pb-4">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <AlertDialogHeader className="space-y-1.5 text-left">
                <AlertDialogTitle className="text-red-900 dark:text-red-100">{title}</AlertDialogTitle>
                <AlertDialogDescription className="text-red-800/70 dark:text-red-200/70">{description}</AlertDialogDescription>
              </AlertDialogHeader>
            </div>
          </div>
        )}
        {!isDanger && (
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
        )}
        <AlertDialogFooter className={isDanger ? "px-6 pb-6 pt-2" : undefined}>
          <AlertDialogCancel disabled={isPending}>{t("actions.cancel")}</AlertDialogCancel>
          {onArchive && (
            <Button
              variant="outline"
              onClick={onArchive}
              disabled={isPending}
              className="border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
            >
              {archiveLabel}
            </Button>
          )}
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
