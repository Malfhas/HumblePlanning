"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useCreateRole, useUpdateRole, roleDisplayName, SUPER_ADMIN_ROLE_ID } from "@/hooks/use-roles";
import { tDyn } from "@/i18n/dynamic";
import type { RoleWithPermissions } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ColorPicker } from "@/components/shared/color-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { contrastColor, cn } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle } from "lucide-react";

// ════════════════════════════════════════════════════════════════════════
// PERMISSIONS CATALOG
// ════════════════════════════════════════════════════════════════════════
//
// Layout: 3 independent blocks inspired by SoPlanning but more fine-grained.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │ BLOCK 1 — PAGES                                                      │
// │   Screen access. Controls menu visibility and access to routes.      │
// │   Binary permissions (combinable).                                   │
// ├──────────────────────────────────────────────────────────────────────┤
// │ BLOCK 2 — ADMINISTRATIVE ACTIONS                                     │
// │   Create/Edit/Delete buttons on list pages. Excludes tasks           │
// │   (handled by Block 3). Binary permissions.                          │
// ├──────────────────────────────────────────────────────────────────────┤
// │ BLOCK 3 — DISPLAY SCOPE AND PLANNING GRID CONTROL                    │
// │   3a. Visible projects (mutex, 1 choice out of 5)                    │
// │   3b. Visible users (mutex, 1 choice out of 4)                       │
// │   3c. Modification level (mutex, 1 choice out of 5)                  │
// │   3d. Task actions (binary, combinable)                              │
// └──────────────────────────────────────────────────────────────────────┘
//
// IMPORTANT: mutex keys follow the `scope:xxx_yyy` convention where
// `xxx` is the group name (projects, users, modify) and `yyy` the variant.
// The code that resolves scopes (permission-service.ts) depends on this
// convention: do not change the prefixes without updating the service.
//
// Labels: `roles.categories.<id>` for categories and
// `roles.permissions.<group>.<action>.label|description` for permissions
// (key derived from the permission: `pages:tasks` → `roles.permissions.pages.tasks`).
// Any permission added here must also be added to src/messages/{fr,en}/roles.json.

// i18n-dynamic: roles.categories.*
// i18n-dynamic: roles.permissions.*

export interface CatalogPermission {
  key: string;
}

export interface CatalogCategory {
  /** Stable identifier (key `roles.categories.<id>`). */
  id: string;
  /**
   * `binary` = multiple combinable checkboxes.
   * `mutex`  = radio buttons, exactly one choice (or zero = disabled).
   */
  type: "binary" | "mutex";
  /** Display group in the UI (Block 1/2/3). */
  block: "pages" | "actions" | "scope";
  permissions: readonly CatalogPermission[];
}

export const PERMISSIONS_CATALOG: readonly CatalogCategory[] = [
  // ════════════════════════════════════════════════════════════════════
  // BLOCK 1 — PAGES
  // ════════════════════════════════════════════════════════════════════
  {
    id: "pages",
    type: "binary",
    block: "pages",
    permissions: [
      { key: "pages:home" },
      { key: "pages:planning" },
      { key: "pages:tasks" },
      { key: "pages:projects" },
      { key: "pages:users" },
      { key: "pages:teams" },
      { key: "pages:business_units" },
      { key: "pages:qualifications" },
      { key: "pages:vehicles" },
      { key: "pages:vehicle_types" },
      { key: "pages:resources" },
      { key: "pages:resource_types" },
      { key: "pages:labor_types" },
      { key: "pages:places" },
      { key: "pages:holidays" },
      { key: "pages:files" },
      { key: "pages:audit" },
      { key: "pages:stats_users" },
      { key: "pages:stats_projects" },
      { key: "pages:stats_roi" },
      { key: "pages:settings" },
      { key: "pages:roles" },
      { key: "pages:backups" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // BLOCK 2 — ADMINISTRATIVE ACTIONS
  // ════════════════════════════════════════════════════════════════════

  {
    id: "projects",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "projects:create" },
      { key: "projects:edit" },
      { key: "projects:delete" },
      { key: "projects:archive" },
      { key: "groups:edit" },
      { key: "statuses:edit" },
    ],
  },

  {
    id: "users_teams",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "users:create" },
      { key: "users:edit" },
      { key: "users:delete" },
      { key: "teams:edit" },
      { key: "business_units:create" },
      { key: "business_units:edit" },
      { key: "business_units:delete" },
      { key: "qualifications:edit" },
    ],
  },

  {
    id: "logistics",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "vehicles:create" },
      { key: "vehicles:edit" },
      { key: "vehicles:delete" },
      { key: "vehicle_types:create" },
      { key: "vehicle_types:edit" },
      { key: "vehicle_types:delete" },
      { key: "resources:create" },
      { key: "resources:edit" },
      { key: "resources:delete" },
      { key: "resource_types:edit" },
      { key: "labor_types:edit" },
    ],
  },

  {
    id: "referentials",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "places:edit" },
      { key: "holidays:edit" },
    ],
  },

  {
    id: "audit_export",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "files:view" },
      { key: "files:upload" },
      { key: "files:delete" },
      { key: "files:purge" },
      { key: "audit:restore" },
      { key: "audit:purge" },
      { key: "export:use" },
    ],
  },

  {
    id: "admin",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "settings:edit" },
      { key: "roles:create" },
      { key: "roles:edit" },
      { key: "roles:delete" },
      { key: "backups:create" },
      { key: "backups:download" },
      { key: "backups:delete" },
      { key: "maintenance:bypass" },
      { key: "notifications:view" },
    ],
  },

  {
    id: "integrations",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "mcp:use" },
      { key: "mcp:write" },
    ],
  },

  {
    id: "ai_chat",
    type: "binary",
    block: "actions",
    permissions: [
      { key: "ai_chat:use" },
      { key: "ai_chat:write" },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // BLOCK 3 — DISPLAY SCOPE AND PLANNING GRID CONTROL
  // ════════════════════════════════════════════════════════════════════

  {
    id: "scope_projects",
    type: "mutex",
    block: "scope",
    permissions: [
      { key: "scope:projects_all" },
      { key: "scope:projects_bu" },
      { key: "scope:projects_team" },
      { key: "scope:projects_own" },
      { key: "scope:projects_assigned_only" },
    ],
  },

  {
    id: "scope_users",
    type: "mutex",
    block: "scope",
    permissions: [
      { key: "scope:users_all" },
      { key: "scope:users_bu" },
      { key: "scope:users_team" },
      { key: "scope:users_self" },
    ],
  },

  {
    id: "scope_modify",
    type: "mutex",
    block: "scope",
    permissions: [
      { key: "scope:modify_readonly" },
      { key: "scope:modify_all" },
      { key: "scope:modify_team" },
      { key: "scope:modify_own_project" },
      { key: "scope:modify_own" },
    ],
  },

  {
    id: "scope_bu",
    type: "mutex" as const,
    block: "scope" as const,
    permissions: [
      { key: "scope:bu_all" },
      { key: "scope:bu_own" },
    ],
  },

  {
    id: "planning_views",
    type: "binary",
    block: "scope",
    permissions: [
      { key: "planning:view_calendar" },
      { key: "planning:view_team_day" },
      { key: "planning:view_vehicles" },
      { key: "planning:view_resources" },
    ],
  },

  {
    id: "task_actions",
    type: "binary",
    block: "scope",
    permissions: [
      { key: "tasks:create" },
      { key: "tasks:delete" },
      { key: "tasks:assign" },
      { key: "tasks:move" },
      { key: "tasks:resize" },
      { key: "tasks:lock" },
    ],
  },
] as const;

// ════════════════════════════════════════════════════════════════════════
// Role form component
// ════════════════════════════════════════════════════════════════════════

interface RoleFormProps {
  initialData?: RoleWithPermissions | null;
  /**
   * When set (and `initialData` is null), pre-fills the form with the source
   * role's name ("… (copie)"), description, color and permissions — but
   * creates a NEW role on submit. `isAdmin` and `isSystem` flags are never
   * copied (the duplicate is always a regular custom role).
   */
  duplicateFrom?: RoleWithPermissions | null;
  onClose: () => void;
}

/** Message prefix of a permission: `pages:tasks` → `permissions.pages.tasks`. */
function permissionMessageKey(permissionKey: string): string {
  return `permissions.${permissionKey.replace(":", ".")}`; // i18n-ignore message key (scanner false positive)
}

export function RoleForm({ initialData, duplicateFrom, onClose }: RoleFormProps) {
  const t = useTranslations("roles");
  const tc = useTranslations("common");
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const [form, setForm] = useState({
    name: "",
    description: "",
    color: "#6b7280",
    permissions: [] as string[],
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name ?? "",
        description: initialData.description ?? "",
        color: initialData.color ?? "#6b7280",
        permissions: initialData.permissions ?? [],
      });
    } else if (duplicateFrom) {
      // Duplicate mode — copy name with suffix, description, color, permissions.
      // If the source is an admin role, keep permissions empty (admin bypass
      // means there's no real list to copy).
      setForm({
        name: t("form.copyName", { name: roleDisplayName(duplicateFrom, t) }),
        description: duplicateFrom.description ?? "",
        color: duplicateFrom.color ?? "#6b7280",
        permissions: duplicateFrom.isAdmin ? [] : (duplicateFrom.permissions ?? []),
      });
    }
  }, [initialData, duplicateFrom, t]);

  const isEdit = !!initialData;
  const isAdminRole = initialData?.isAdmin ?? false;
  const isLockedName = initialData?.id === SUPER_ADMIN_ROLE_ID;

  // ──── Permission toggling helpers ────────────────────────────────────

  /** Toggle a binary permission (add if absent, remove if present). */
  function toggleBinary(key: string) {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  }

  /**
   * Select a mutex permission from a group. Removes any other key from the
   * same group first, then adds the new one. Clicking the active key
   * deselects it (zero = "no choice").
   */
  function selectMutex(groupKeys: string[], key: string) {
    setForm((prev) => {
      const alreadyActive = prev.permissions.includes(key);
      const withoutGroup = prev.permissions.filter((p) => !groupKeys.includes(p));
      return {
        ...prev,
        permissions: alreadyActive ? withoutGroup : [...withoutGroup, key],
      };
    });
  }

  /** Check / uncheck all binary permissions of a category at once. */
  function toggleBinaryCategory(keys: string[]) {
    const allChecked = keys.every((k) => form.permissions.includes(k));
    setForm((prev) => ({
      ...prev,
      permissions: allChecked
        ? prev.permissions.filter((p) => !keys.includes(p))
        : [...new Set([...prev.permissions, ...keys])],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side required validation (backend re-validates too)
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t("form.nameRequired");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const data = {
      name: form.name,
      description: form.description || null,
      color: form.color,
      permissions: isAdminRole ? [] : form.permissions,
    };

    const mutateOpts = {
      onSuccess: onClose,
      onError: (err: Error & { fields?: unknown }) => {
        const parsed = parseFieldErrors(err);
        setFieldErrors(parsed);
        if (Object.keys(parsed).length > 0) {
          createRole.reset();
          updateRole.reset();
        }
      },
    };
    if (isEdit) {
      updateRole.mutate({ id: initialData!.id, data }, mutateOpts);
    } else {
      createRole.mutate(data, mutateOpts);
    }
  }

  const isPending = createRole.isPending || updateRole.isPending;

  // Group categories by block for the visual separation
  const byBlock = {
    pages: PERMISSIONS_CATALOG.filter((c) => c.block === "pages"),
    actions: PERMISSIONS_CATALOG.filter((c) => c.block === "actions"),
    scope: PERMISSIONS_CATALOG.filter((c) => c.block === "scope"),
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 min-h-0 flex-1">
      <div className="grid gap-4 sm:grid-cols-2 shrink-0">
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="role-name">{t("form.name")}</Label>
          <Input
            id="role-name"
            // Super Administrator: name translated on display (locked field),
            // the name stored in the database is the one sent to the API.
            value={isLockedName ? t("system.superAdmin") : form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              clearFieldError(setFieldErrors, "name");
            }}
            maxLength={100}
            disabled={isLockedName}
            className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="role-color">{t("form.color")}</Label>
          <ColorPicker
            id="role-color"
            value={form.color}
            onChange={(color) => setForm({ ...form, color })}
          />
        </div>
      </div>

      <div className="space-y-1.5 shrink-0">
        <Label htmlFor="role-description">{t("form.description")}</Label>
        <Textarea
          id="role-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          placeholder={t("form.descriptionPlaceholder")}
        />
      </div>

      {/* Preview */}
      <div className="flex flex-col items-start gap-1.5 shrink-0">
        <span className="text-sm font-medium leading-none select-none">{t("form.preview")}</span>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ backgroundColor: form.color, color: contrastColor(form.color) }}
        >
          {(isLockedName ? t("system.superAdmin") : form.name) || t("form.previewFallback")}
        </span>
      </div>

      {/* Permissions — 3 blocks, inner scroll */}
      <div className="flex flex-col gap-1.5 min-h-0 flex-1">
        <div className="shrink-0 text-sm font-medium leading-none">
          {t("form.permissions")} {isAdminRole && <span className="text-muted-foreground">{t("form.adminBypass")}</span>}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto border rounded-md p-3 space-y-5">

          {/* ══════ BLOCK 1 — PAGES ══════ */}
          <BlockHeader
            title={t("form.blocks.pages.title")}
            subtitle={t("form.blocks.pages.subtitle")}
          />
          {byBlock.pages.map((cat) => (
            <BinaryCategory
              key={cat.id}
              category={cat}
              form={form}
              isAdminRole={isAdminRole}
              toggleBinary={toggleBinary}
              toggleBinaryCategory={toggleBinaryCategory}
            />
          ))}

          <Divider />

          {/* ══════ BLOCK 2 — ADMIN ACTIONS ══════ */}
          <BlockHeader
            title={t("form.blocks.actions.title")}
            subtitle={t("form.blocks.actions.subtitle")}
          />
          {byBlock.actions.map((cat) => (
            <BinaryCategory
              key={cat.id}
              category={cat}
              form={form}
              isAdminRole={isAdminRole}
              toggleBinary={toggleBinary}
              toggleBinaryCategory={toggleBinaryCategory}
            />
          ))}

          <Divider />

          {/* ══════ BLOCK 3 — PLANNING SCOPE ══════ */}
          <BlockHeader
            title={t("form.blocks.scope.title")}
            subtitle={t("form.blocks.scope.subtitle")}
          />
          {byBlock.scope.map((cat) =>
            cat.type === "mutex" ? (
              <MutexCategory
                key={cat.id}
                category={cat}
                form={form}
                isAdminRole={isAdminRole}
                selectMutex={selectMutex}
              />
            ) : (
              <BinaryCategory
                key={cat.id}
                category={cat}
                form={form}
                isAdminRole={isAdminRole}
                toggleBinary={toggleBinary}
                toggleBinaryCategory={toggleBinaryCategory}
              />
            )
          )}

        </div>
      </div>

      {/* Global error — shown ONLY for errors not linked to a specific field */}
      {(createRole.error || updateRole.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 shrink-0">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createRole.error || updateRole.error)?.message}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 shrink-0">
        <Button type="button" variant="outline" onClick={onClose}>
          {tc("actions.cancel")}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? tc("actions.saving") : isEdit ? tc("actions.edit") : tc("actions.create")}
        </Button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Subcomponents
// ════════════════════════════════════════════════════════════════════════

function BlockHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">{title}</h3>
      <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/60" />;
}

/** Label wrapped with a tooltip showing the permission description. */
function PermissionLabel({ permissionKey }: { permissionKey: string }) {
  const t = useTranslations("roles");
  const base = permissionMessageKey(permissionKey);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-sm cursor-help">{tDyn(t, `${base}.label`)}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words" side="right">
        {tDyn(t, `${base}.description`) /* i18n-ignore message key (scanner false positive) */}
      </TooltipContent>
    </Tooltip>
  );
}

interface BinaryCategoryProps {
  category: CatalogCategory;
  form: { permissions: string[] };
  isAdminRole: boolean;
  toggleBinary: (key: string) => void;
  toggleBinaryCategory: (keys: string[]) => void;
}

function BinaryCategory({
  category,
  form,
  isAdminRole,
  toggleBinary,
  toggleBinaryCategory,
}: BinaryCategoryProps) {
  const t = useTranslations("roles");
  const keys = category.permissions.map((p) => p.key);
  const checkedCount = isAdminRole
    ? keys.length
    : keys.filter((k) => form.permissions.includes(k)).length;
  const allChecked = checkedCount === keys.length;
  const someChecked = checkedCount > 0 && !allChecked;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={allChecked ? true : someChecked ? "indeterminate" : false}
          onCheckedChange={() => toggleBinaryCategory(keys)}
          disabled={isAdminRole}
        />
        <div className="text-sm font-semibold">{tDyn(t, `categories.${category.id}`)}</div>
        <span className="text-xs text-muted-foreground">
          ({checkedCount}/{keys.length})
        </span>
      </div>
      <div className="ml-6 grid gap-1 sm:grid-cols-2">
        {category.permissions.map((perm) => (
          <label
            key={perm.key}
            htmlFor={`perm-${perm.key}`}
            className="flex items-center gap-2 cursor-pointer select-none rounded px-1 -mx-1 hover:bg-accent/50"
          >
            <Checkbox
              id={`perm-${perm.key}`}
              checked={isAdminRole || form.permissions.includes(perm.key)}
              onCheckedChange={() => toggleBinary(perm.key)}
              disabled={isAdminRole}
            />
            <PermissionLabel permissionKey={perm.key} />
          </label>
        ))}
      </div>
    </div>
  );
}

interface MutexCategoryProps {
  category: CatalogCategory;
  form: { permissions: string[] };
  isAdminRole: boolean;
  selectMutex: (groupKeys: string[], key: string) => void;
}

const ADMIN_ACTIVE_KEYS: Record<string, string> = {
  scope_projects: "scope:projects_all",
  scope_users: "scope:users_all",
  scope_modify: "scope:modify_all",
  scope_bu: "scope:bu_all",
};

function MutexCategory({ category, form, isAdminRole, selectMutex }: MutexCategoryProps) {
  const t = useTranslations("roles");
  const keys = category.permissions.map((p) => p.key);
  const activeKey = isAdminRole
    ? (ADMIN_ACTIVE_KEYS[category.id] ?? keys[0])
    : keys.find((k) => form.permissions.includes(k)) ?? null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">{tDyn(t, `categories.${category.id}`)}</div>
        <span className="text-xs text-muted-foreground">{t("form.mutexHint")}</span>
      </div>
      <div className="ml-6 grid gap-1 sm:grid-cols-2">
        {category.permissions.map((perm) => {
          const isActive = activeKey === perm.key;
          return (
            <label
              key={perm.key}
              htmlFor={`perm-${perm.key}`}
              className="flex items-center gap-2 cursor-pointer select-none rounded px-1 -mx-1 hover:bg-accent/50"
            >
              <input
                id={`perm-${perm.key}`}
                type="radio"
                name={category.id}
                checked={isActive}
                onChange={() => selectMutex(keys, perm.key)}
                disabled={isAdminRole}
                className="size-4 shrink-0 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              />
              <PermissionLabel permissionKey={perm.key} />
            </label>
          );
        })}
      </div>
    </div>
  );
}
