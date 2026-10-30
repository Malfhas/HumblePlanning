"use client";

import { useState, useEffect } from "react";
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
import { GripVertical } from "lucide-react";
import { useReorderGroupProjects } from "@/hooks/use-groups";
import { useTranslations } from "next-intl";

interface Project {
  id: string;
  name: string;
  color?: string;
  status?: string;
}

interface GroupProjectsReorderProps {
  groupId: string;
  projects: Project[];
  disabled?: boolean;
}

function SortableProject({ project, disabled }: { project: Project; disabled?: boolean }) {
  const t = useTranslations("projects");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
    >
      {disabled ? (
        <span className="inline-flex items-center text-muted-foreground/40" aria-hidden>
          <GripVertical className="h-4 w-4" />
        </span>
      ) : (
        <button type="button" className="cursor-grab touch-none" aria-label={t("groups.reorderProjectAriaLabel")} {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
      <div
        className="h-4 w-4 shrink-0 rounded-full border border-input"
        style={{ backgroundColor: project.color || "#FFFFFF" }}
      />
      <span className="text-sm flex-1 truncate">{project.name}</span>
      {project.status === "archived" && (
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{t("status.archived")}</span>
      )}
    </div>
  );
}

export function GroupProjectsReorder({ groupId, projects, disabled }: GroupProjectsReorderProps) {
  const t = useTranslations("projects");
  const [orderedProjects, setOrderedProjects] = useState<Project[]>(projects);
  const reorder = useReorderGroupProjects();

  useEffect(() => {
    setOrderedProjects(projects);
  }, [projects]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (disabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedProjects.findIndex((p) => p.id === active.id);
    const newIndex = orderedProjects.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...orderedProjects];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    setOrderedProjects(newOrder);

    reorder.mutate({ groupId, projectIds: newOrder.map((p) => p.id) });
  };

  if (orderedProjects.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t("groups.noProjects")}</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedProjects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1 py-2">
          {orderedProjects.map((project) => (
            <SortableProject key={project.id} project={project} disabled={disabled} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
