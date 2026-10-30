"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
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
import { useTeams, useDeleteTeam, useReorderTeams } from "@/hooks/use-teams";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { TeamForm } from "@/components/teams/team-form";
import { TeamUsersReorder } from "@/components/teams/team-users-reorder";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { Plus, Pencil, Trash2, ChevronRight, Users, GripVertical, Building2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import type { TeamWithUsers } from "@/types";

export default function TeamsPage() {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const { intlTag } = useDateFormat();
  const { data, isLoading } = useTeams();
  const { data: businessUnits } = useBusinessUnits();
  const deleteTeam = useDeleteTeam();
  const reorderTeams = useReorderTeams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; color?: string; businessUnitId?: string | null } | null>(null);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [orderedTeams, setOrderedTeams] = useState<TeamWithUsers[]>([]);

  const teams = data ?? [];

  // Keep local ordered copy in sync with fetched data
  useEffect(() => {
    setOrderedTeams(teams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const { selectedBuIds } = useBuStore();
  const buFilteredTeams = useMemo(() => {
    if (selectedBuIds.length === 0) return orderedTeams;
    return orderedTeams.filter((team: any) => team.businessUnitId && selectedBuIds.includes(team.businessUnitId));
  }, [orderedTeams, selectedBuIds]);

  const buSections = useMemo(() => {
    const map = new Map<string, { buId: string | null; buName: string; buColor: string; teams: TeamWithUsers[] }>();
    const orphanKey = "__none__";
    for (const team of buFilteredTeams) {
      const bId = (team as { businessUnitId?: string | null }).businessUnitId ?? null;
      const key = bId ?? orphanKey;
      if (!map.has(key)) {
        if (bId === null) {
          map.set(key, { buId: null, buName: t("teams.outsideBu"), buColor: "#9ca3af", teams: [] });
        } else {
          const bu = businessUnits?.find((b) => b.id === bId);
          map.set(key, { buId: bId, buName: bu?.name ?? "—", buColor: bu?.color ?? "#8b5cf6", teams: [] });
        }
      }
      map.get(key)!.teams.push(team);
    }
    const sections = Array.from(map.values());
    sections.sort((a, b) => {
      if (a.buId === null) return 1;
      if (b.buId === null) return -1;
      return a.buName.localeCompare(b.buName, intlTag);
    });
    return sections;
  }, [buFilteredTeams, businessUnits, t, intlTag]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeTeam = orderedTeams.find((t) => t.id === active.id);
    const overTeam = orderedTeams.find((t) => t.id === over.id);
    if (!activeTeam || !overTeam) return;
    if ((activeTeam as { businessUnitId?: string | null }).businessUnitId !== (overTeam as { businessUnitId?: string | null }).businessUnitId) return;
    const oldIndex = orderedTeams.findIndex((t) => t.id === active.id);
    const newIndex = orderedTeams.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = [...orderedTeams];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    setOrderedTeams(next);
    reorderTeams.mutate(next.map((t) => t.id));
  };

  const { can, isLoading: permLoading } = usePermissions();
  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:teams")) return <ErrorState code={403} compact showBack={false} />;

  const toggleExpanded = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("teams.title")}</h1>
        {!can("teams:edit") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button size="sm" disabled>
                  <Plus className="mr-1 h-4 w-4" /> {tc("actions.add")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("shared.insufficientPermission")}</TooltipContent>
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
      ) : buFilteredTeams.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("teams.empty")}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="space-y-6">
            {buSections.map((section) => (
              <div key={section.buId ?? "none"} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Building2 className="h-4 w-4" style={{ color: section.buColor }} />
                  <h2 className="text-sm font-semibold text-foreground">{section.buName}</h2>
                  <span className="text-xs text-muted-foreground">({section.teams.length})</span>
                </div>
                <SortableContext items={section.teams.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {section.teams.map((team) => (
                      <SortableTeamCard
                        key={team.id}
                        team={team}
                        isExpanded={expandedTeams.has(team.id)}
                        onToggleExpand={() => toggleExpanded(team.id)}
                        canEdit={can("teams:edit")}
                        onEdit={() => {
                          setEditing({ id: team.id, name: team.name, color: team.color ?? undefined, businessUnitId: (team as { businessUnitId?: string | null }).businessUnitId ?? null });
                          setDialogOpen(true);
                        }}
                        onDelete={() => setDeleteTarget(team.id)}
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
              {editing ? t("teams.dialog.editTitle") : t("teams.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? t("teams.dialog.editDescription")
                : t("teams.dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <TeamForm
            initialData={editing}
            onSuccess={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("teams.delete.title")}
        description={t("teams.delete.description")}
        onConfirm={() => {
          if (deleteTarget) deleteTeam.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteTeam.isPending}
        variant="danger"
      />
    </div>
  );
}

function SortableTeamCard({
  team,
  isExpanded,
  onToggleExpand,
  canEdit,
  onEdit,
  onDelete,
}: {
  team: TeamWithUsers;
  isExpanded: boolean;
  onToggleExpand: () => void;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: team.id });
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const { intlTag } = useDateFormat();
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
                aria-label={t("teams.reorderAria")}
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
              style={{ backgroundColor: team.color || "#3b82f6" }}
            />

            <CollapsibleTrigger asChild>
              <button type="button" className="flex-1 text-left">
                <span className="font-medium">{team.name}</span>
              </button>
            </CollapsibleTrigger>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {team.users?.length ?? 0}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={!canEdit}
                  onClick={canEdit ? (e) => { e.stopPropagation(); onEdit(); } : undefined}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{!canEdit ? t("shared.insufficientPermission") : tc("actions.edit")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={!canEdit}
                  onClick={canEdit ? (e) => { e.stopPropagation(); onDelete(); } : undefined}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{!canEdit ? t("shared.insufficientPermission") : tc("actions.delete")}</TooltipContent>
            </Tooltip>
          </div>

          <CollapsibleContent>
            <div className="border-t px-4">
              <TeamUsersReorder
                teamId={team.id}
                users={(team.users ?? []).sort(
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
