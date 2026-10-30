"use client";

import { useEffect, useState, useCallback } from "react";
import { useProject, useCreateProject, useUpdateProject } from "@/hooks/use-projects";
import { useGroups } from "@/hooks/use-groups";
import { useUsers } from "@/hooks/use-users";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { useBuStore } from "@/stores/bu-store";
import type { ProjectWithTaskCount } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/shared/color-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Check, ChevronsUpDown, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { useDateFormat } from "@/hooks/use-date-format";
import { useTranslations } from "next-intl";
import { AddressMapPicker } from "@/components/shared/address-map-picker";
import { LaborBudgetSection } from "./labor-budget-section";
import { useProjectLaborBudgets, useUpsertProjectLaborBudgets } from "@/hooks/use-project-labor-budgets";

/** Project status identifiers; labels: `projects.status.<id>`. */
const STATUS_OPTIONS = ["todo", "in_progress", "done", "archived"] as const;

interface ProjectFormProps {
  id: string | null;
  /**
   * When set (and `id` is null), loads this project and pre-fills only the
   * "generic" fields (group, owner, BU, color, labor budgets) — never the
   * specific info (name, business number, description, address, dates).
   */
  duplicateFromId?: string | null;
  onClose: () => void;
  onDelete?: () => void;
  onArchive?: (status: string) => void;
}

export function ProjectForm({ id, duplicateFromId, onClose, onDelete, onArchive }: ProjectFormProps) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { formatDate } = useDateFormat();
  const { data: project, isLoading } = useProject(id);
  const { data: sourceProject } = useProject(duplicateFromId && !id ? duplicateFromId : null);
  const { data: groups } = useGroups();
  // Fetch ALL users (bypass userScope): server-side honoured only if caller has
  // pages:projects. Role-based scope filtering is irrelevant here — BU filtering
  // below is applied via the global BU selector (useBuStore).
  const { data: users } = useUsers(undefined, true, true);
  const { selectedBuIds } = useBuStore();
  const { data: businessUnits } = useBusinessUnits();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const { data: existingBudgets } = useProjectLaborBudgets(id);
  const { data: sourceBudgets } = useProjectLaborBudgets(duplicateFromId && !id ? duplicateFromId : null);
  const upsertBudgets = useUpsertProjectLaborBudgets();
  const [laborBudgets, setLaborBudgets] = useState<{ laborTypeId: string; plannedHours: string }[]>([]);

  const [form, setForm] = useState({
    businessNumber: "",
    name: "",
    color: "#FFFFFF",
    status: "todo" as string,
    groupId: "",
    ownerId: "",
    businessUnitId: "",
    description: "",
    address: "",
    addressLat: null as number | null,
    addressLng: null as number | null,
  });

  const [groupPopoverOpen, setGroupPopoverOpen] = useState(false);
  const [ownerPopoverOpen, setOwnerPopoverOpen] = useState(false);
  const [buPopoverOpen, setBuPopoverOpen] = useState(false);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  useEffect(() => {
    if (project && id) {
      const p = project as ProjectWithTaskCount;
      setForm({
        businessNumber: p.businessNumber ?? "",
        name: p.name ?? "",
        color: p.color ?? "#FFFFFF",
        status: p.status ?? "todo",
        groupId: p.groupId ?? "",
        ownerId: p.ownerId ?? "",
        businessUnitId: (p as any).businessUnit?.id ?? (p as any).businessUnitId ?? "",
        description: p.description ?? "",
        address: (p as any).address ?? "",
        addressLat: (p as any).addressLat ? parseFloat((p as any).addressLat) : null,
        addressLng: (p as any).addressLng ? parseFloat((p as any).addressLng) : null,
      });
    } else if (!id && duplicateFromId && sourceProject) {
      // Duplicate mode — pre-fill only the GENERIC fields from the source project
      const s = sourceProject as ProjectWithTaskCount;
      setForm({
        businessNumber: "",
        name: "",
        color: s.color ?? "#FFFFFF",
        status: "todo",
        groupId: s.groupId ?? "",
        ownerId: s.ownerId ?? "",
        businessUnitId: (s as any).businessUnit?.id ?? (s as any).businessUnitId ?? "",
        description: "",
        address: "",
        addressLat: null,
        addressLng: null,
      });
    }
  }, [project, id, duplicateFromId, sourceProject]);

  // Load existing labor budgets in edit mode
  useEffect(() => {
    if (existingBudgets && id) {
      setLaborBudgets(existingBudgets.map((b) => ({
        laborTypeId: b.laborTypeId,
        plannedHours: b.plannedHours,
      })));
    } else if (!id && duplicateFromId && sourceBudgets) {
      // Duplicate mode — copy labor budgets structure from the source
      setLaborBudgets(sourceBudgets.map((b) => ({
        laborTypeId: b.laborTypeId,
        plannedHours: b.plannedHours,
      })));
    }
  }, [existingBudgets, id, duplicateFromId, sourceBudgets]);

  const isEdit = !!id;
  const createdAt = project ? (project as ProjectWithTaskCount).createdAt : null;

  const [addressError, setAddressError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [budgetError, setBudgetError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validate required fields
    const requiredErrors: Record<string, string> = {};
    if (!form.name.trim()) requiredErrors.name = t("validation.nameRequired");
    if (!form.businessUnitId) requiredErrors.businessUnitId = t("validation.businessUnitRequired");
    if (!form.ownerId) requiredErrors.ownerId = t("validation.ownerRequired");
    if (Object.keys(requiredErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...requiredErrors }));
      return;
    }

    // Block if address text is filled but no GPS position
    if (form.address.trim() && !form.addressLat) {
      setAddressError(true);
      return;
    }
    setAddressError(false);

    // Block if incomplete budget lines exist
    const hasIncompleteBudget = laborBudgets.some(
      (b) => !b.laborTypeId || !b.plannedHours || parseFloat(b.plannedHours) <= 0
    );
    if (hasIncompleteBudget) {
      setBudgetError(true);
      return;
    }
    setBudgetError(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      businessNumber: form.businessNumber || null,
      name: form.name,
      color: form.color,
      status: form.status,
      groupId: form.groupId || null,
      ownerId: form.ownerId,
      businessUnitId: form.businessUnitId || null,
      description: form.description || null,
      address: form.address || null,
      addressLat: form.addressLat?.toString() || null,
      addressLng: form.addressLng?.toString() || null,
    };

    const validBudgets = laborBudgets.filter((b) => b.laborTypeId && parseFloat(b.plannedHours) > 0);

    const onMutateError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createProject.reset();
        updateProject.reset();
      }
    };

    if (isEdit) {
      updateProject.mutate({ id, data }, {
        onSuccess: () => {
          upsertBudgets.mutate({ projectId: id, budgets: validBudgets });
          onClose();
        },
        onError: onMutateError,
      });
    } else {
      createProject.mutate(data, {
        onSuccess: (result: any) => {
          const newId = result?.id;
          if (newId && validBudgets.length > 0) {
            upsertBudgets.mutate({ projectId: newId, budgets: validBudgets });
          }
          onClose();
        },
        onError: onMutateError,
      });
    }
  }

  if (id && isLoading) {
    return <p className="py-4 text-center text-muted-foreground">{tc("states.loading")}</p>;
  }

  const isPending = createProject.isPending || updateProject.isPending;
  const selectedGroup = groups?.find((g) => g.id === form.groupId);
  const selectedOwner = users?.find((u) => u.id === form.ownerId);
  const selectedBu = businessUnits?.find((bu) => bu.id === form.businessUnitId);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isEdit && createdAt && (
        <p className="text-xs text-muted-foreground">
          {t("form.createdOn", { date: formatDate(new Date(createdAt)) })}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Business Number */}
        <div className="space-y-1.5">
          <Label htmlFor="businessNumber">{t("fields.businessNumber")}</Label>
          <Input
            id="businessNumber"
            autoComplete="off"
            value={form.businessNumber}
            onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
            maxLength={15}
          />
        </div>

        {/* Name */}
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="name">{t("fields.name")} *</Label>
          <Input
            id="name"
            autoComplete="off"
            required
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              clearFieldError(setFieldErrors, "name");
            }}
            maxLength={50}
            className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <Label htmlFor="status">{t("fields.status")}</Label>
          <Select name="status" value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`status.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Group — searchable combobox, optional */}
        <div className="space-y-1.5">
          <Label htmlFor="project-group-trigger">{t("fields.group")}</Label>
          <Popover open={groupPopoverOpen} onOpenChange={setGroupPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                id="project-group-trigger"
                type="button"
                variant="outline"
                role="combobox"
                className={cn(
                  "w-full justify-between min-w-0 font-normal",
                  !form.groupId && "text-muted-foreground"
                )}
              >
                <span className="flex items-center min-w-0">
                  {selectedGroup ? (
                    <>
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: selectedGroup.color || "#ccc" }}
                      />
                      <span className="truncate">{selectedGroup.name}</span>
                    </>
                  ) : <span className="truncate">{t("form.group.none")}</span>}
                </span>
                <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
              <Command defaultValue={form.groupId || undefined}>
                <CommandInput placeholder={t("form.group.searchPlaceholder")} />
                <CommandList onWheel={handleWheel}>
                  <CommandEmpty>{t("form.group.empty")}</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        setForm({ ...form, groupId: "" });
                        setGroupPopoverOpen(false);
                      }}
                    >
                      <span className="text-muted-foreground">{t("form.group.none")}</span>
                      {!form.groupId && <Check className="ml-auto h-4 w-4" />}
                    </CommandItem>
                    {(groups ?? [])
                      .filter((g) => {
                        if (selectedBuIds.length === 0) return true;
                        const buId = (g as { businessUnitId?: string | null }).businessUnitId ?? null;
                        return buId ? selectedBuIds.includes(buId) : false;
                      })
                      .map((g) => (
                        <CommandItem
                          key={g.id}
                          value={g.id}
                          keywords={[g.name]}
                          onSelect={() => {
                            const groupId = g.id;
                            if (!isEdit && groupId) {
                              setForm({ ...form, groupId, color: g.color ?? form.color });
                            } else {
                              setForm({ ...form, groupId });
                            }
                            setGroupPopoverOpen(false);
                          }}
                        >
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: g.color || "#ccc" }}
                          />
                          {g.name}
                          {form.groupId === g.id && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Business Unit — searchable combobox, required */}
        <div className={cn("space-y-1.5", fieldErrors.businessUnitId && "field-error")}>
          <Label htmlFor="project-bu-trigger">{t("fields.businessUnit")} <span className="text-destructive">*</span></Label>
          <Popover open={buPopoverOpen} onOpenChange={setBuPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                id="project-bu-trigger"
                type="button"
                variant="outline"
                role="combobox"
                className={cn(
                  "w-full justify-between min-w-0 font-normal",
                  !form.businessUnitId && "text-muted-foreground",
                  fieldErrors.businessUnitId && "border-destructive ring-1 ring-destructive"
                )}
              >
                <span className="flex items-center min-w-0">
                  {selectedBu ? (
                    <>
                      <Building2 className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">{selectedBu.name}</span>
                    </>
                  ) : <span className="truncate">{t("form.businessUnit.placeholder")}</span>}
                </span>
                <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
              <Command defaultValue={form.businessUnitId || undefined}>
                <CommandInput placeholder={t("form.businessUnit.searchPlaceholder")} />
                <CommandList onWheel={handleWheel}>
                  <CommandEmpty>{t("form.businessUnit.empty")}</CommandEmpty>
                  <CommandGroup>
                    {businessUnits?.map((bu) => (
                      <CommandItem
                        key={bu.id}
                        value={bu.id}
                        keywords={[bu.name]}
                        onSelect={() => {
                          setForm({ ...form, businessUnitId: bu.id });
                          clearFieldError(setFieldErrors, "businessUnitId");
                          setBuPopoverOpen(false);
                        }}
                      >
                        <Building2 className="mr-2 h-4 w-4 shrink-0" />
                        {bu.name}
                        {form.businessUnitId === bu.id && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {fieldErrors.businessUnitId && <p className="text-xs text-destructive mt-1">{fieldErrors.businessUnitId}</p>}
        </div>

        {/* Color — hidden in creation until group is selected */}
        {(isEdit || form.groupId) && (
          <div className="space-y-1.5">
            <Label htmlFor="project-color">{t("fields.color")}</Label>
            <ColorPicker
              id="project-color"
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
            {form.groupId && (() => {
              const group = groups?.find((g) => g.id === form.groupId);
              return group?.color && group.color !== form.color ? (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setForm({ ...form, color: group.color! })}
                >
                  <div className="h-3 w-3 rounded-full border border-input" style={{ backgroundColor: group.color ?? undefined }} />
                  {t("form.group.applyColor")}
                </button>
              ) : null;
            })()}
          </div>
        )}

        {/* Owner — searchable combobox, required */}
        <div className={cn("space-y-1.5 sm:col-span-2", fieldErrors.ownerId && "field-error")}>
          <Label htmlFor="project-owner-trigger">{t("fields.owner")} <span className="text-destructive">*</span></Label>
          <Popover open={ownerPopoverOpen} onOpenChange={setOwnerPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                id="project-owner-trigger"
                type="button"
                variant="outline"
                role="combobox"
                className={cn(
                  "w-full justify-between min-w-0 font-normal",
                  !form.ownerId && "text-muted-foreground",
                  fieldErrors.ownerId && "border-destructive ring-1 ring-destructive"
                )}
              >
                <span className="flex items-center min-w-0">
                  {selectedOwner ? (
                    <>
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: (selectedOwner as any).color || "#ccc" }}
                      />
                      <span className="truncate">{[(selectedOwner as any).firstName, selectedOwner.name].filter(Boolean).join(" ")}</span>
                    </>
                  ) : <span className="truncate">{t("form.owner.placeholder")}</span>}
                </span>
                <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
              <Command defaultValue={form.ownerId || undefined}>
                <CommandInput placeholder={t("form.owner.searchPlaceholder")} />
                <CommandList onWheel={handleWheel}>
                  <CommandEmpty>{t("form.owner.empty")}</CommandEmpty>
                  <CommandGroup>
                    {(users ?? [])
                      .filter((u) => {
                        if (selectedBuIds.length === 0) return true;
                        const buId = (u as any).businessUnitId ?? (u as any).businessUnit?.id ?? null;
                        return buId ? selectedBuIds.includes(buId) : false;
                      })
                      .map((u) => (
                        <CommandItem
                          key={u.id}
                          value={u.id}
                          keywords={[[(u as any).firstName, u.name].filter(Boolean).join(" ")]}
                          onSelect={() => {
                            setForm({ ...form, ownerId: u.id });
                            clearFieldError(setFieldErrors, "ownerId");
                            setOwnerPopoverOpen(false);
                          }}
                        >
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: (u as any).color || "#ccc" }}
                          />
                          {[(u as any).firstName, u.name].filter(Boolean).join(" ")}
                          {form.ownerId === u.id && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {fieldErrors.ownerId && <p className="text-xs text-destructive mt-1">{fieldErrors.ownerId}</p>}
        </div>

        {/* Description */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">{t("fields.description")}</Label>
          <Textarea
            id="description"
            autoComplete="off"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
          />
        </div>
      </div>

      {/* Worksite location */}
      <AddressMapPicker
        address={form.address}
        latitude={form.addressLat}
        longitude={form.addressLng}
        onAddressChange={(address) => { setForm((prev) => ({ ...prev, address })); setAddressError(false); }}
        onLocationChange={(lat, lng) => { setForm((prev) => ({ ...prev, addressLat: lat, addressLng: lng })); setAddressError(false); }}
        height="250px"
        pinVariant="construction"
      />
      {addressError && (
        <p className="text-xs text-destructive">{t("form.addressNotLocated")}</p>
      )}

      {/* Labor budgets */}
      <LaborBudgetSection budgets={laborBudgets} onChange={(b) => { setLaborBudgets(b); setBudgetError(false); }} error={budgetError} />

      {/* Global error — shown ONLY for errors not linked to a specific field */}
      {(createProject.error || updateProject.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createProject.error || updateProject.error)?.message}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <div className="flex gap-2">
          {isEdit && onDelete && (
            <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
              {tc("actions.delete")}
            </Button>
          )}
          {isEdit && onArchive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onArchive(form.status)}
              className={form.status === "archived"
                ? "border-green-300 text-green-600 hover:bg-green-50 hover:text-green-700"
                : "border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
              }
            >
              {form.status === "archived" ? tc("actions.unarchive") : tc("actions.archive")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("actions.cancel")}
          </Button>
          <Button type="submit" disabled={isPending || !form.ownerId || !form.businessUnitId}>
            {isPending ? tc("states.saving") : isEdit ? tc("actions.edit") : tc("actions.create")}
          </Button>
        </div>
      </div>
    </form>
  );
}
