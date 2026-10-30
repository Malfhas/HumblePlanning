"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ResourceAssignmentForm } from "./resource-assignment-form";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { throwIfNotOk } from "@/lib/api-client";
import type { ResourceAssignmentWithRelations } from "@/types";

async function fetchApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  await throwIfNotOk(res);
  return res.json();
}

interface ResourceReserveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId?: string | null;
  prefillResourceId?: string;
  prefillDate?: string;
}

export function ResourceReserveDialog({ open, onOpenChange, assignmentId, prefillResourceId, prefillDate }: ResourceReserveDialogProps) {
  const t = useTranslations("resources.assignments");
  const qc = useQueryClient();
  const isEditing = !!assignmentId;

  const { data: assignment } = useQuery({
    queryKey: ["resource-assignments", assignmentId],
    queryFn: () => fetchApi<ResourceAssignmentWithRelations>(`/api/resource-assignments/${assignmentId}`),
    enabled: open && isEditing,
  });

  const handleClose = () => {
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["resource-assignments"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? t("resourceDialog.editTitle") : t("resourceDialog.createTitle")}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("resourceDialog.editDescription")
              : t("resourceDialog.createDescription")}
          </DialogDescription>
        </DialogHeader>
        {(!isEditing || assignment) && (
          <ResourceAssignmentForm
            initialData={isEditing ? assignment : undefined}
            prefillResourceId={prefillResourceId}
            prefillDate={prefillDate}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
