"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { type ColumnDef } from "@tanstack/react-table";
import { useVehicles, useDeleteVehicle } from "@/hooks/use-vehicles";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { FilterMultiSelect, type FilterItem } from "@/components/shared/filter-multi-select";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Pencil, Trash2, Plus, Filter, X, Archive } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { ErrorState } from "@/components/shared/error-state";
import { QualificationIcon } from "@/components/shared/icon-picker";
import { cn, contrastColor } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import { useBuStore } from "@/stores/bu-store";
import { ModuleGuard } from "@/components/shared/module-guard";
import { useDateFormat } from "@/hooks/use-date-format";
import type { VehicleWithType } from "@/types";

const STATUS_BADGES: Record<string, { labelKey: "available" | "maintenance" | "outOfService"; className: string }> = {
  available: { labelKey: "available", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  maintenance: { labelKey: "maintenance", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  out_of_service: { labelKey: "outOfService", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

export default function VehiclesPage() {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const { intlTag } = useDateFormat();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<VehicleWithType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // Exclusive toggle: OFF = available + maintenance, ON = out of service only
  const [showOutOfService, setShowOutOfService] = useState(false);
  // Filters
  const [filterTypeIds, setFilterTypeIds] = useState<string[]>([]);
  const [filterStatusIds, setFilterStatusIds] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState("");

  const { data: vehicles } = useVehicles(true);
  const deleteVehicle = useDeleteVehicle();
  const { can, isLoading: permLoading } = usePermissions();
  const { selectedBuIds } = useBuStore();

  const typeOptions = useMemo<FilterItem[]>(() => {
    if (!vehicles) return [];
    const map = new Map<string, FilterItem>();
    for (const v of vehicles) {
      if (v.vehicleType && !map.has(v.vehicleType.id)) {
        map.set(v.vehicleType.id, { id: v.vehicleType.id, name: v.vehicleType.name, color: v.vehicleType.color });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, intlTag));
  }, [vehicles, intlTag]);

  const statusOptions: FilterItem[] = [
    { id: "available", name: t("status.available"), color: "#22c55e" },
    { id: "maintenance", name: t("status.maintenance"), color: "#f59e0b" },
  ];

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:vehicles")) return <ErrorState code={403} compact showBack={false} />;

  const filteredVehicles = (vehicles ?? []).filter((v) => {
    // BU store filter (global BU selector)
    if (selectedBuIds.length > 0 && (!v.businessUnitId || !selectedBuIds.includes(v.businessUnitId))) return false;
    // Exclusive status toggle: OFF = not out of service, ON = out of service only
    const isOos = v.status === "out_of_service";
    if (showOutOfService ? !isOos : isOos) return false;
    if (filterTypeIds.length > 0 && (!v.vehicleType || !filterTypeIds.includes(v.vehicleType.id))) return false;
    if (filterStatusIds.length > 0 && !filterStatusIds.includes(v.status)) return false;
    return true;
  });

  const hasAnyFilter = filterTypeIds.length + filterStatusIds.length > 0 || showOutOfService;

  function clearFilters() {
    setFilterTypeIds([]);
    setFilterStatusIds([]);
    setShowOutOfService(false);
  }

  function openCreate() {
    setEditData(null);
    setDialogOpen(true);
  }

  function openEdit(vehicle: VehicleWithType) {
    setEditData(vehicle);
    setDialogOpen(true);
  }

  const columns: ColumnDef<VehicleWithType, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("list.columns.name")),
      cell: ({ row }) => <TruncatedCell value={row.original.name} maxWidth="max-w-[200px]" className="font-medium" />,
    },
    {
      accessorKey: "vehicleType",
      header: sortableHeader(t("list.columns.type")),
      cell: ({ row }) => {
        const vt = row.original.vehicleType;
        if (!vt) return <span className="text-muted-foreground">—</span>;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium max-w-[160px] truncate"
                style={{ backgroundColor: vt.color, color: contrastColor(vt.color) }}
              >
                <QualificationIcon name={vt.icon} className="size-3.5 shrink-0" />
                <span className="truncate">{vt.name}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{vt.name}</TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: "businessUnit",
      accessorFn: (row) => row.businessUnit?.name,
      header: sortableHeader(t("list.columns.businessUnit")),
      cell: ({ row }) => <TruncatedCell value={row.original.businessUnit?.name} maxWidth="max-w-[140px]" />,
    },
    {
      accessorKey: "registrationNumber",
      header: sortableHeader(t("list.columns.registrationNumber")),
      cell: ({ row }) => <TruncatedCell value={row.original.registrationNumber} maxWidth="max-w-[140px]" className="text-muted-foreground" />,
    },
    {
      accessorKey: "status",
      header: sortableHeader(t("list.columns.status")),
      cell: ({ row }) => {
        const badge = STATUS_BADGES[row.original.status] || STATUS_BADGES.available;
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
            {t(`status.${badge.labelKey}`)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      size: 92,
      cell: ({ row }) => (
        <RowActions
          actions={[
            { label: tc("actions.edit"), icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(row.original), allowed: can("vehicles:edit") },
            { label: tc("actions.delete"), icon: <Trash2 className="h-4 w-4" />, onClick: () => setDeleteTarget(row.original.id), allowed: can("vehicles:delete"), destructive: true, separatorBefore: true },
          ]}
        />
      ),
    },
  ];

  return (
    <ModuleGuard configKey="MODULE_VEHICLES">
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tc("entities.vehicles")}</h1>
        {!can("vehicles:create") ? (
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

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <FilterMultiSelect label={t("list.columns.type")} items={typeOptions} selected={filterTypeIds} onChange={setFilterTypeIds} />
        <FilterMultiSelect label={t("list.columns.status")} items={statusOptions} selected={filterStatusIds} onChange={setFilterStatusIds} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowOutOfService((v) => !v)}
          className={cn(
            "h-8 text-xs gap-1.5",
            showOutOfService && "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-300",
          )}
        >
          <Archive className="h-3 w-3" />
          {t("list.outOfService")}
        </Button>
        <DataTableSearchToggle
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t("vehicles.searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
        {hasAnyFilter && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" />{tc("actions.clear")}
          </Button>
        )}
        <div className="flex-1" />
        {hasAnyFilter && (
          <span className="text-xs text-muted-foreground">
            {t("vehicles.count", { count: filteredVehicles.length })}
          </span>
        )}
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={filteredVehicles}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editData ? t("vehicles.dialog.editTitle") : t("vehicles.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editData
                ? t("vehicles.dialog.editDescription")
                : t("vehicles.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <VehicleForm
            initialData={editData}
            onClose={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("vehicles.confirmDelete.title")}
        description={t("vehicles.confirmDelete.description")}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteVehicle.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteVehicle.isPending}
      />
    </div>
    </ModuleGuard>
  );
}
