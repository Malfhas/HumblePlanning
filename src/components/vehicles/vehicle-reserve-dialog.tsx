"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VehicleAssignmentForm } from "./vehicle-assignment-form";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { throwIfNotOk } from "@/lib/api-client";
import type { VehicleAssignmentWithRelations } from "@/types";

async function fetchApi<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  await throwIfNotOk(res);
  return res.json();
}

interface VehicleReserveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId?: string | null;
  prefillVehicleId?: string;
  prefillDate?: string;
}

export function VehicleReserveDialog({ open, onOpenChange, assignmentId, prefillVehicleId, prefillDate }: VehicleReserveDialogProps) {
  const t = useTranslations("resources.assignments");
  const qc = useQueryClient();
  const isEditing = !!assignmentId;

  const { data: assignment } = useQuery({
    queryKey: ["vehicle-assignments", assignmentId],
    queryFn: () => fetchApi<VehicleAssignmentWithRelations>(`/api/vehicle-assignments/${assignmentId}`),
    enabled: open && isEditing,
  });

  const handleClose = () => {
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["vehicle-assignments"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? t("vehicleDialog.editTitle") : t("vehicleDialog.createTitle")}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("vehicleDialog.editDescription")
              : t("vehicleDialog.createDescription")}
          </DialogDescription>
        </DialogHeader>
        {(!isEditing || assignment) && (
          <VehicleAssignmentForm
            initialData={isEditing ? assignment : undefined}
            prefillVehicleId={prefillVehicleId}
            prefillDate={prefillDate}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
