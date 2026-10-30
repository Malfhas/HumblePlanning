"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { type ColumnDef, type SortingFn } from "@tanstack/react-table";
import { useRoles, useDeleteRole, useRoleDisplayName, SUPER_ADMIN_ROLE_ID, type RoleApiError } from "@/hooks/use-roles";
import { useDateFormat } from "@/hooks/use-date-format";
import { useUsers } from "@/hooks/use-users";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { RoleForm } from "@/components/roles/role-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Pencil, Trash2, Plus, Shield, Copy, AlertTriangle, Crown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RowActions } from "@/components/shared/row-actions";
import { Badge } from "@/components/ui/badge";
import { contrastColor } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import type { RoleWithPermissions } from "@/types";

interface BlockingUser {
  id: string;
  name: string;
  firstName: string | null;
  email: string | null;
}

export default function RolesPage() {
  const t = useTranslations("roles");
  const tc = useTranslations("common");
  const roleName = useRoleDisplayName();
  const { intlTag } = useDateFormat();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<RoleWithPermissions | null>(null);
  const [duplicateFrom, setDuplicateFrom] = useState<RoleWithPermissions | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleWithPermissions | null>(null);
  const [blockedDialog, setBlockedDialog] = useState<{ role: RoleWithPermissions; users: BlockingUser[] } | null>(null);
  const [searchValue, setSearchValue] = useState("");

  const { data: roles, isLoading } = useRoles();
  const { data: allUsers } = useUsers(undefined, true); // include inactive so we don't miss anyone
  const deleteRole = useDeleteRole();
  const { can, isLoading: permLoading } = usePermissions();

  // Number of users per role (includes inactive ones, dedup by user.id)
  const usersByRole = useMemo(() => {
    const map = new Map<string, number>();
    if (!allUsers) return map;
    for (const u of allUsers as any[]) {
      const rid = u.roleId ?? u.role?.id;
      if (!rid) continue;
      map.set(rid, (map.get(rid) ?? 0) + 1);
    }
    return map;
  }, [allUsers]);

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:roles")) return <p className="text-center text-muted-foreground p-8">{t("list.accessDenied")}</p>;

  function openCreate() {
    setEditData(null);
    setDuplicateFrom(null);
    setDialogOpen(true);
  }

  function openEdit(role: RoleWithPermissions) {
    setEditData(role);
    setDuplicateFrom(null);
    setDialogOpen(true);
  }

  function openDuplicate(role: RoleWithPermissions) {
    setEditData(null);
    setDuplicateFrom(role);
    setDialogOpen(true);
  }

  /**
   * Build the list of users still attached to a given role, sourced from the
   * local useUsers() cache. Used to short-circuit the delete flow without
   * hitting the API when we already know users are attached.
   */
  function usersAttachedTo(roleId: string): BlockingUser[] {
    if (!allUsers) return [];
    return (allUsers as any[])
      .filter((u) => u.roleId === roleId || u.role?.id === roleId)
      .map((u) => ({
        id: u.id,
        name: u.name,
        firstName: u.firstName ?? null,
        email: u.email ?? null,
      }));
  }

  function handleTrashClick(role: RoleWithPermissions) {
    const attached = usersAttachedTo(role.id);
    if (attached.length > 0) {
      setBlockedDialog({ role, users: attached });
      return;
    }
    setDeleteTarget(role);
  }

  /**
   * Pin Super Administrateur at the top, whatever column the user sorts on.
   * Other rows fall back to the column's default alphanumeric sort.
   */
  const pinSuperAdminFirst: SortingFn<RoleWithPermissions> = (rowA, rowB, columnId) => {
    if (rowA.original.id === SUPER_ADMIN_ROLE_ID) return -1;
    if (rowB.original.id === SUPER_ADMIN_ROLE_ID) return 1;
    const a = rowA.getValue<unknown>(columnId);
    const b = rowB.getValue<unknown>(columnId);
    return String(a ?? "").localeCompare(String(b ?? ""), intlTag, { numeric: true });
  };

  const columns: ColumnDef<RoleWithPermissions, unknown>[] = [
    {
      id: "name",
      accessorFn: (row) => roleName(row),
      header: sortableHeader(t("list.columns.role")),
      sortingFn: pinSuperAdminFirst,
      cell: ({ row }) => {
        const isSuperAdmin = row.original.id === SUPER_ADMIN_ROLE_ID;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium max-w-[220px] truncate"
                style={{ backgroundColor: row.original.color, color: contrastColor(row.original.color) }}
              >
                {isSuperAdmin
                  ? <Crown className="size-3 shrink-0" />
                  : <Shield className="size-3 shrink-0" />}
                <span className="truncate">{roleName(row.original)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{roleName(row.original)}</TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      accessorKey: "description",
      header: sortableHeader(t("list.columns.description")),
      sortingFn: pinSuperAdminFirst,
      // Bounded width: otherwise the table overflows and the fixed actions column hides Type, Permissions and Users
      cell: ({ row }) => <TruncatedCell value={row.original.description} maxWidth="max-w-[200px]" className="text-muted-foreground" />,
    },
    {
      id: "system",
      header: t("list.columns.type"),
      size: 80,
      cell: ({ row }) => (
        row.original.isSystem
          ? <Badge variant="secondary" className="text-[10px]">{t("list.types.system")}</Badge>
          : <Badge variant="outline" className="text-[10px]">{t("list.types.custom")}</Badge>
      ),
    },
    {
      id: "permCount",
      header: t("list.columns.permissions"),
      size: 100,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.isAdmin ? t("list.allPermissions") : row.original.permissions.length}
        </span>
      ),
    },
    {
      id: "userCount",
      header: t("list.columns.users"),
      size: 100,
      cell: ({ row }) => {
        const count = usersByRole.get(row.original.id) ?? 0;
        return (
          <span className="text-muted-foreground text-sm">{count}</span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      size: 132,
      cell: ({ row }) => {
        const actions = [
          {
            label: tc("actions.edit"),
            icon: <Pencil className="h-4 w-4" />,
            onClick: () => openEdit(row.original),
            allowed: can("roles:edit"),
          },
          {
            label: tc("actions.duplicate"),
            icon: <Copy className="h-4 w-4 text-blue-500" />,
            onClick: () => openDuplicate(row.original),
            allowed: can("roles:create"),
          },
        ];
        // Delete action hidden entirely for system roles (protected)
        if (!row.original.isSystem) {
          actions.push({
            label: tc("actions.delete"),
            icon: <Trash2 className="h-4 w-4" />,
            onClick: () => handleTrashClick(row.original),
            allowed: can("roles:delete"),
            destructive: true,
            separatorBefore: true,
          } as (typeof actions)[number]);
        }
        return <RowActions actions={actions} />;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("list.title")}</h1>
        <div className="flex items-center gap-2">
          <DataTableSearchToggle
            value={searchValue}
            onChange={setSearchValue}
            placeholder={t("list.searchPlaceholder")}
            inputClassName="max-w-[260px]"
          />
          {!can("roles:create") ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled>
                    <Plus className="h-4 w-4 mr-1" />
                    {tc("actions.add")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("list.insufficientPermission")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              {tc("actions.add")}
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={roles ?? []}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        className="flex flex-col gap-3 flex-1 min-h-0"
      />

      {isLoading && (
        <p className="text-center text-muted-foreground">{tc("states.loading")}</p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {editData
                ? t("list.dialog.editTitle")
                : duplicateFrom
                  ? t("list.dialog.duplicateTitle")
                  : t("list.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editData
                ? t("list.dialog.editDescription")
                : duplicateFrom
                  ? t("list.dialog.duplicateDescription")
                  : t("list.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <RoleForm
            initialData={editData}
            duplicateFrom={duplicateFrom}
            onClose={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("list.delete.title")}
        description={t("list.delete.description", { name: roleName(deleteTarget) })}
        variant="danger"
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteRole.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null),
            onError: (err) => {
              // Server detected users still attached (race condition vs local check).
              // Switch to the blocking dialog so the admin sees exactly who is blocking.
              const apiErr = err as RoleApiError;
              if (apiErr.status === 409 && apiErr.details?.users?.length) {
                setBlockedDialog({ role: deleteTarget, users: apiErr.details.users });
                setDeleteTarget(null);
              }
            },
          });
        }}
        isPending={deleteRole.isPending}
      />

      {/* Blocking dialog: the role still has users attached. The confirm
          button is disabled — the admin must first reassign the users. */}
      <Dialog open={!!blockedDialog} onOpenChange={(open) => { if (!open) setBlockedDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("list.blocked.title")}
            </DialogTitle>
            <DialogDescription>
              {t.rich("list.blocked.description", {
                name: roleName(blockedDialog?.role),
                count: blockedDialog?.users.length ?? 0,
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
            {blockedDialog?.users.map((u) => {
              const fullName = [u.firstName, u.name].filter(Boolean).join(" ") || u.name;
              return (
                <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="font-medium truncate">{fullName}</span>
                  {u.email && <span className="text-xs text-muted-foreground truncate">{u.email}</span>}
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setBlockedDialog(null)}>
              {tc("actions.close")}
            </Button>
            <Button disabled className="cursor-not-allowed">
              <Trash2 className="h-4 w-4 mr-1.5" />
              {tc("actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
