"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type ColumnDef } from "@tanstack/react-table";
import { useBusinessUnits, useDeleteBusinessUnit } from "@/hooks/use-business-units";
import { ErrorState } from "@/components/shared/error-state";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { BusinessUnitForm } from "@/components/business-units/business-unit-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Pencil, Trash2, Plus, MapPin } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { usePermissions } from "@/hooks/use-permissions";
import type { BusinessUnit } from "@/types";

export default function BusinessUnitsPage() {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  // Exception for this page: pages:business_units grants full visibility,
  // bypassing the top-left BU selector filter and scope:bu_own.
  const { data: businessUnits, isLoading } = useBusinessUnits(true);
  const deleteBU = useDeleteBusinessUnit();
  const { can, isLoading: permLoading } = usePermissions();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:business_units")) return <ErrorState code={403} compact showBack={false} />;

  function openCreate() {
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(id: string) {
    setEditId(id);
    setDialogOpen(true);
  }

  const columns: ColumnDef<BusinessUnit, any>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("businessUnits.columns.name")),
      cell: ({ row }) => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: (row.original as any).color ?? "#8b5cf6" }} />
          <TruncatedCell value={row.original.name} maxWidth="max-w-[220px]" className="font-medium" />
        </div>
      ),
    },
    {
      accessorKey: "number",
      header: sortableHeader(t("businessUnits.columns.number")),
      cell: ({ row }) => <TruncatedCell value={row.original.number} maxWidth="max-w-[140px]" />,
    },
    {
      accessorKey: "address",
      header: sortableHeader(t("businessUnits.columns.address")),
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <TruncatedCell value={row.original.address} maxWidth="max-w-[280px]" />
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 130,
      cell: ({ row }) => (
        <RowActions
          actions={[
            {
              label: tc("actions.edit"),
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => openEdit(row.original.id),
              allowed: can("business_units:edit"),
            },
            {
              label: tc("actions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => setDeleteTarget(row.original.id),
              allowed: can("business_units:delete"),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("businessUnits.title")}</h1>
        {!can("business_units:create") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled>
                  <Plus className="h-4 w-4 mr-1" />
                  {tc("actions.add")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("shared.insufficientPermission")}</TooltipContent>
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
          placeholder={t("businessUnits.searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={businessUnits ?? []}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      {isLoading && (
        <p className="text-center text-muted-foreground">{tc("states.loading")}</p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editId ? t("businessUnits.dialog.editTitle") : t("businessUnits.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editId
                ? t("businessUnits.dialog.editDescription")
                : t("businessUnits.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <BusinessUnitForm
            id={editId}
            onClose={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("businessUnits.delete.title")}
        description={t("businessUnits.delete.description")}
        onConfirm={() => {
          if (deleteTarget) deleteBU.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteBU.isPending}
        variant="danger"
      />
    </div>
  );
}
