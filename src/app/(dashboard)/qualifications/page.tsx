"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { type ColumnDef } from "@tanstack/react-table";
import { useQualifications, useDeleteQualification } from "@/hooks/use-qualifications";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { QualificationForm } from "@/components/qualifications/qualification-form";
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
import { QualificationIcon } from "@/components/shared/icon-picker";
import { contrastColor } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import type { Qualification } from "@/types";
import { ErrorState } from "@/components/shared/error-state";

export default function QualificationsPage() {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<Qualification | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const { data: qualifications, isLoading } = useQualifications();
  const deleteQualification = useDeleteQualification();
  const { can, isLoading: permLoading } = usePermissions();
  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:qualifications")) return <ErrorState code={403} compact showBack={false} />;

  function openCreate() {
    setEditData(null);
    setDialogOpen(true);
  }

  function openEdit(qual: Qualification) {
    setEditData(qual);
    setDialogOpen(true);
  }

  const columns: ColumnDef<Qualification, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("qualifications.columns.name")),
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium max-w-[200px] truncate"
              style={{ backgroundColor: row.original.color, color: contrastColor(row.original.color) }}
            >
              <QualificationIcon name={row.original.emoji} className="size-3.5 shrink-0" />
              <span className="truncate">{row.original.name}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{row.original.name}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      accessorKey: "description",
      header: sortableHeader(t("qualifications.columns.description")),
      cell: ({ row }) => <TruncatedCell value={row.original.description} maxWidth="max-w-[360px]" className="text-muted-foreground" />,
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
              allowed: can("qualifications:edit"),
            },
            {
              label: tc("actions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => setDeleteTarget(row.original.id),
              allowed: can("qualifications:edit"),
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
        <h1 className="text-2xl font-bold">{t("qualifications.title")}</h1>
        {!can("qualifications:edit") ? (
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
          placeholder={t("qualifications.searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={qualifications ?? []}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      {isLoading && (
        <p className="text-center text-muted-foreground">{tc("states.loading")}</p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editData ? t("qualifications.dialog.editTitle") : t("qualifications.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editData
                ? t("qualifications.dialog.editDescription")
                : t("qualifications.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <QualificationForm
            initialData={editData}
            onClose={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("qualifications.delete.title")}
        description={t("qualifications.delete.description")}
        onConfirm={() => {
          if (deleteTarget) deleteQualification.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteQualification.isPending}
      />
    </div>
  );
}
