"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type ColumnDef } from "@tanstack/react-table";
import { useVehicleTypes, useDeleteVehicleType } from "@/hooks/use-vehicle-types";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { VehicleTypeForm } from "@/components/vehicles/vehicle-type-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { Pencil, Trash2, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { QualificationIcon } from "@/components/shared/icon-picker";
import { contrastColor } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import { ErrorState } from "@/components/shared/error-state";
import { ModuleGuard } from "@/components/shared/module-guard";
import type { VehicleType } from "@/types";

export default function VehicleTypesPage() {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<VehicleType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const { data: vehicleTypes } = useVehicleTypes();
  const deleteVT = useDeleteVehicleType();
  const { can, isLoading: permLoading } = usePermissions();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:vehicle_types")) return <ErrorState code={403} compact showBack={false} />;

  function openCreate() {
    setEditData(null);
    setDialogOpen(true);
  }

  function openEdit(vt: VehicleType) {
    setEditData(vt);
    setDialogOpen(true);
  }

  const columns: ColumnDef<VehicleType, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("list.columns.type")),
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium max-w-[220px] truncate"
              style={{ backgroundColor: row.original.color, color: contrastColor(row.original.color) }}
            >
              <QualificationIcon name={row.original.icon} className="size-3.5 shrink-0" />
              <span className="truncate">{row.original.name}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{row.original.name}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 92,
      cell: ({ row }) => (
        <RowActions
          actions={[
            {
              label: tc("actions.edit"),
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => openEdit(row.original),
              allowed: can("vehicle_types:edit"),
            },
            {
              label: tc("actions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => setDeleteTarget(row.original.id),
              allowed: can("vehicle_types:delete"),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <ModuleGuard configKey="MODULE_VEHICLES">
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tc("entities.vehicleTypes")}</h1>
        {!can("vehicle_types:create") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled>
                  <Plus className="h-4 w-4 mr-1" />
                  {tc("actions.add")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("list.permissionDenied")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            {tc("actions.add")}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DataTableSearchToggle
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t("vehicleTypes.searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={vehicleTypes ?? []}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editData ? t("vehicleTypes.dialog.editTitle") : t("vehicleTypes.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editData
                ? t("vehicleTypes.dialog.editDescription")
                : t("vehicleTypes.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <VehicleTypeForm
            initialData={editData}
            onClose={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("vehicleTypes.confirmDelete.title")}
        description={t("vehicleTypes.confirmDelete.description")}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteVT.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteVT.isPending}
      />
    </div>
    </ModuleGuard>
  );
}
