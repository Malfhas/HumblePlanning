"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useGroups, useDeleteGroup, useReorderGroups } from "@/hooks/use-groups";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { GroupForm } from "@/components/groups/group-form";
import { GroupProjectsReorder } from "@/components/groups/group-projects-reorder";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { Plus, Pencil, Trash2, ChevronRight, FolderOpen, GripVertical, Building2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PermissionButton } from "@/components/shared/permission-button";
import { usePermissions } from "@/hooks/use-permissions";
import { ErrorState } from "@/components/shared/error-state";
import { useBuStore } from "@/stores/bu-store";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProjectGroupWithProjects } from "@/types";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";

export default function GroupsPage() {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { intlTag } = useDateFormat();
  const { data, isLoading } = useGroups();
  const { data: businessUnits } = useBusinessUnits();
  const deleteGroup = useDeleteGroup();
  const reorderGroups = useReorderGroups();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; color?: string; sortOrder: number; businessUnitId?: string | null } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [orderedGroups, setOrderedGroups] = useState<ProjectGroupWithProjects[]>([]);

  useEffect(() => {
    setOrderedGroups(data ?? []);
  }, [data]);

  const { selectedBuIds } = useBuStore();
  const buFilteredGroups = useMemo(() => {
    if (selectedBuIds.length === 0) return orderedGroups;
    return orderedGroups.filter((group: any) => group.businessUnitId && selectedBuIds.includes(group.businessUnitId));
  }, [orderedGroups, selectedBuIds]);

  /**
   * Sections grouped by BU. One section per distinct businessUnitId among the
   * currently-filtered groups, sorted alphabetically by BU name. A trailing
   * "Hors BU" section collects any groups with null businessUnitId (defensive —
   * the column is NOT NULL but legacy backfill could leave nulls).
   */
  const buSections = useMemo(() => {
    const map = new Map<string, { buId: string | null; buName: string; buColor: string; groups: ProjectGroupWithProjects[] }>();
    const orphanKey = "__none__";
    for (const g of buFilteredGroups) {
      const bId = (g as { businessUnitId?: string | null }).businessUnitId ?? null;
      const key = bId ?? orphanKey;
      if (!map.has(key)) {
        if (bId === null) {
          map.set(key, { buId: null, buName: t("groups.noBu"), buColor: "#9ca3af", groups: [] });
        } else {
          const bu = businessUnits?.find((b) => b.id === bId);
          map.set(key, { buId: bId, buName: bu?.name ?? "—", buColor: bu?.color ?? "#8b5cf6", groups: [] });
        }
      }
      map.get(key)!.groups.push(g);
    }
    const sections = Array.from(map.values());
    sections.sort((a, b) => {
      if (a.buId === null) return 1;
      if (b.buId === null) return -1;
      return a.buName.localeCompare(b.buName, intlTag);
    });
    return sections;
  }, [buFilteredGroups, businessUnits, t, intlTag]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeGroup = orderedGroups.find((g) => g.id === active.id);
    const overGroup = orderedGroups.find((g) => g.id === over.id);
    if (!activeGroup || !overGroup) return;
    // Prevent cross-BU drag: moving between BUs must be done via the edit form
    if ((activeGroup as { businessUnitId?: string | null }).businessUnitId !== (overGroup as { businessUnitId?: string | null }).businessUnitId) return;
    const oldIndex = orderedGroups.findIndex((g) => g.id === active.id);
    const newIndex = orderedGroups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = [...orderedGroups];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    setOrderedGroups(next);
    reorderGroups.mutate(next.map((g) => g.id));
  };

  const { can, isLoading: permLoading } = usePermissions();
  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:projects")) return <ErrorState code={403} compact showBack={false} />;

  const toggleExpanded = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tc("entities.projectGroups")}</h1>
        {!can("groups:edit") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button size="sm" disabled>
                  <Plus className="mr-1 h-4 w-4" /> {tc("actions.add")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("permissionDenied")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> {tc("actions.add")}
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{tc("states.loading")}</p>
      ) : buFilteredGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("groups.empty")}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="space-y-6">
            {buSections.map((section) => (
              <div key={section.buId ?? "none"} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Building2 className="h-4 w-4" style={{ color: section.buColor }} />
                  <h2 className="text-sm font-semibold text-foreground">{section.buName}</h2>
                  <span className="text-xs text-muted-foreground">({section.groups.length})</span>
                </div>
                <SortableContext items={section.groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {section.groups.map((group) => (
                      <SortableGroupCard
                        key={group.id}
                        group={group}
                        isExpanded={expandedGroups.has(group.id)}
                        onToggleExpand={() => toggleExpanded(group.id)}
                        canEdit={can("groups:edit")}
                        onEdit={() => {
                          setEditing({ id: group.id, name: group.name, color: group.color ?? undefined, sortOrder: group.sortOrder ?? 0, businessUnitId: (group as { businessUnitId?: string | null }).businessUnitId ?? null });
                          setDialogOpen(true);
                        }}
                        onDelete={() => setDeleteTarget(group.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            ))}
          </div>
        </DndContext>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("groups.dialog.editTitle") : t("groups.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? t("groups.dialog.editDescription")
                : t("groups.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <GroupForm
            initialData={editing}
            onSuccess={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("groups.confirmDelete.title")}
        description={t("groups.confirmDelete.description")}
        onConfirm={() => {
          if (deleteTarget) deleteGroup.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteGroup.isPending}
        variant="danger"
      />
    </div>
  );
}

function SortableGroupCard({
  group,
  isExpanded,
  onToggleExpand,
  canEdit,
  onEdit,
  onDelete,
}: {
  group: ProjectGroupWithProjects;
  isExpanded: boolean;
  onToggleExpand: () => void;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { intlTag } = useDateFormat();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 px-3 py-3">
            {canEdit && (
              <button
                type="button"
                className="cursor-grab touch-none p-1 text-muted-foreground hover:text-foreground"
                aria-label={t("groups.reorderAriaLabel")}
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            )}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 shrink-0">
                <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
              </Button>
            </CollapsibleTrigger>

            <div
              className="h-5 w-5 shrink-0 rounded-full border border-input"
              style={{ backgroundColor: group.color || "#6366f1" }}
            />

            <CollapsibleTrigger asChild>
              <button type="button" className="flex-1 text-left">
                <span className="font-medium">{group.name}</span>
              </button>
            </CollapsibleTrigger>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5" />
              {group.projects?.length ?? 0}
            </div>

            <PermissionButton
              allowed={canEdit}
              tooltipAllowed={tc("actions.edit")}
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              variant="ghost"
              size="icon"
              className="size-7"
            >
              <Pencil className="h-3.5 w-3.5" />
            </PermissionButton>
            <PermissionButton
              allowed={canEdit}
              tooltipAllowed={tc("actions.delete")}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              variant="ghost"
              size="icon"
              className="size-7"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </PermissionButton>
          </div>

          <CollapsibleContent>
            <div className="border-t px-4">
              <GroupProjectsReorder
                groupId={group.id}
                projects={(group.projects ?? []).sort(
                  (a: { sortOrder?: number | null; name: string }, b: { sortOrder?: number | null; name: string }) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, intlTag)
                )}
                disabled={!canEdit}
              />
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
