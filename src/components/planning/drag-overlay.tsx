"use client";

import { DragOverlay as DndDragOverlay } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { usePlanningStore } from "@/stores/planning-store";
import { contrastColor } from "@/lib/utils";
import { differenceInCalendarDays } from "date-fns";
import type { TaskWithUsers } from "@/types";

interface PlanningDragOverlayProps {
  activeTask: TaskWithUsers | null;
}

export function PlanningDragOverlay({ activeTask }: PlanningDragOverlayProps) {
  const { cellWidth } = usePlanningStore();
  const t = useTranslations("planning");

  if (!activeTask) return null;

  const days = activeTask.endDate
    ? differenceInCalendarDays(
        new Date(activeTask.endDate),
        new Date(activeTask.startDate)
      ) + 1
    : 1;

  return (
    <DndDragOverlay>
      <div
        className="rounded-sm px-2 text-[11px] leading-6 shadow-lg pointer-events-none opacity-80"
        style={{
          width: Math.max(days * cellWidth - 4, 12),
          height: 24,
          backgroundColor: activeTask.project?.color ?? "#3b82f6",
          color: contrastColor(activeTask.project?.color ?? "#3b82f6"),
        }}
      >
        {activeTask.title || t("canvas.untitled")}
      </div>
    </DndDragOverlay>
  );
}
