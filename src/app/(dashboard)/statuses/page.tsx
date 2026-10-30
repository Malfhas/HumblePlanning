"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { StatusForm } from "@/components/statuses/status-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Plus, Pencil, Trash2, Bold, Italic, Underline, Strikethrough } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import {
  useStatuses,
  useCreateStatus,
  useUpdateStatus,
  useDeleteStatus,
} from "@/hooks/use-statuses";
import { usePermissions } from "@/hooks/use-permissions";
import type { Status } from "@/types";
import { ErrorState } from "@/components/shared/error-state";
import { useTranslations } from "next-intl";
import { hasDyn, tDyn } from "@/i18n/dynamic";

// i18n-dynamic: projects.statuses.displayModes.*

export default function StatusesPage() {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const displayModeLabel = (mode: string) =>
    hasDyn(t, `statuses.displayModes.${mode}`) ? tDyn(t, `statuses.displayModes.${mode}`) : mode;
  const { data: statuses = [], isLoading } = useStatuses();
  const createStatus = useCreateStatus();
  const updateStatus = useUpdateStatus();
  const deleteStatus = useDeleteStatus();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Status | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const { can, isLoading: permLoading } = usePermissions();
  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:projects")) return <ErrorState code={403} compact showBack={false} />;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (status: Status) => {
    setEditing(status);
    setDialogOpen(true);
  };

  const handleSubmit = (data: { name: string; color: string; displayMode: string; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; sortOrder: number; percentage: number; isDefault: boolean }) => {
    if (editing) {
      updateStatus.mutate(
        { id: editing.id, data },
        { onSuccess: () => setDialogOpen(false) }
      );
    } else {
      createStatus.mutate(data, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const handleDelete = (id: string) => {
    setDeleteTarget(id);
  };

  const columns: ColumnDef<Status, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("fields.name")),
      cell: ({ row }) => <TruncatedCell value={row.original.name} maxWidth="max-w-[240px]" className="font-medium" />,
    },
    {
      accessorKey: "color",
      header: t("fields.color"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded-full border"
            style={{ backgroundColor: row.original.color ?? undefined }}
          />
          <span className="text-sm text-muted-foreground">
            {row.original.color}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "displayMode",
      header: t("fields.displayMode"),
      cell: ({ row }) => (
        <span>{displayModeLabel(row.original.displayMode ?? "tp")}</span>
      ),
    },
    {
      id: "style",
      header: t("fields.style"),
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="flex items-center gap-1">
            {s.bold && <Bold className="h-4 w-4" />}
            {s.italic && <Italic className="h-4 w-4" />}
            {s.underline && <Underline className="h-4 w-4" />}
            {s.strikethrough && <Strikethrough className="h-4 w-4" />}
            {!s.bold && !s.italic && !s.underline && !s.strikethrough && (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "sortOrder",
      header: sortableHeader(t("fields.sortOrder")),
    },
    {
      id: "actions",
      header: "",
      size: 80,
      cell: ({ row }) => (
        <RowActions
          actions={[
            {
              label: tc("actions.edit"),
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => openEdit(row.original),
              allowed: can("statuses:edit"),
            },
            {
              label: tc("actions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => handleDelete(row.original.id),
              allowed: can("statuses:edit"),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-muted-foreground">{tc("states.loading")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{tc("entities.statuses")}</h1>
        <div className="flex items-center gap-2">
          <DataTableSearchToggle
            value={searchValue}
            onChange={setSearchValue}
            placeholder={t("statuses.searchPlaceholder")}
            inputClassName="max-w-[260px]"
          />
          {!can("statuses:edit") ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled>
                    <Plus className="mr-2 h-4 w-4" />
                    {tc("actions.add")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("permissionDenied")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {tc("actions.add")}
            </Button>
          )}
        </div>
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={statuses}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("statuses.dialog.editTitle") : t("statuses.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? t("statuses.dialog.editDescription")
                : t("statuses.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <StatusForm
            initialData={editing ?? undefined}
            onSubmit={handleSubmit}
            isPending={createStatus.isPending || updateStatus.isPending}
            serverError={createStatus.error || updateStatus.error}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("statuses.confirmDelete.title")}
        onConfirm={() => {
          if (deleteTarget) deleteStatus.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteStatus.isPending}
      />
    </div>
  );
}
