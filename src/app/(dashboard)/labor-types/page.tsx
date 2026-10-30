"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useLaborTypes, useDeleteLaborType } from "@/hooks/use-labor-types";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { LaborTypeForm } from "@/components/labor-types/labor-type-form";
import { Badge } from "@/components/ui/badge";
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
import { Pencil, Trash2, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { usePermissions } from "@/hooks/use-permissions";
import { ErrorState } from "@/components/shared/error-state";
import type { LaborType } from "@/types";
import { useTranslations } from "next-intl";

export default function LaborTypesPage() {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LaborType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const { data: laborTypes, isLoading } = useLaborTypes();
  const deleteLT = useDeleteLaborType();
  const { can, isLoading: permLoading } = usePermissions();

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:labor_types")) return <ErrorState code={403} compact showBack={false} />;

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(lt: LaborType) {
    setEditing(lt);
    setDialogOpen(true);
  }

  const columns: ColumnDef<LaborType, any>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("fields.name")),
      cell: ({ row }) => <TruncatedCell value={row.original.name} maxWidth="max-w-[240px]" className="font-medium" />,
    },
    {
      accessorKey: "initials",
      header: sortableHeader(t("fields.initials")),
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono uppercase">
          {row.original.initials}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 90,
      cell: ({ row }) => (
        <RowActions
          actions={[
            {
              label: tc("actions.edit"),
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => openEdit(row.original),
              allowed: can("labor_types:edit"),
            },
            {
              label: tc("actions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => setDeleteTarget(row.original.id),
              allowed: can("labor_types:edit"),
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
        <h1 className="text-2xl font-bold">{tc("entities.laborTypes")}</h1>
        {!can("labor_types:edit") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled>
                  <Plus className="h-4 w-4 mr-1" />
                  {tc("actions.add")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("permissionDenied")}</TooltipContent>
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
          placeholder={t("laborTypes.searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={laborTypes ?? []}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      {isLoading && <p className="text-center text-muted-foreground">{tc("states.loading")}</p>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("laborTypes.dialog.editTitle") : t("laborTypes.dialog.createTitle")}</DialogTitle>
            <DialogDescription>
              {editing ? t("laborTypes.dialog.editDescription") : t("laborTypes.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <LaborTypeForm initialData={editing} onClose={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("laborTypes.confirmDelete.title")}
        description={t("laborTypes.confirmDelete.cascadeWarning")}
        onConfirm={() => {
          if (deleteTarget) deleteLT.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteLT.isPending}
        variant="danger"
      />
    </div>
  );
}
