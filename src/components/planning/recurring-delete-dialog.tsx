"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

interface RecurringDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (scope: "single" | "all" | "after") => void;
}

export function RecurringDeleteDialog({
  open,
  onOpenChange,
  onDelete,
}: RecurringDeleteDialogProps) {
  const t = useTranslations("taskForm.recurringDelete");
  const tCommon = useTranslations("common");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("actions.cancel")}
          </Button>
          <Button
            variant="outline"
            className="text-destructive border-destructive/50 hover:bg-destructive/10"
            onClick={() => onDelete("single")}
          >
            {t("single")}
          </Button>
          <Button
            variant="outline"
            className="text-destructive border-destructive/50 hover:bg-destructive/10"
            onClick={() => onDelete("after")}
          >
            {t("after")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => onDelete("all")}
          >
            {t("all")}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
