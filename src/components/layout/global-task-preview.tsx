"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTaskPreviewStore } from "@/stores/task-preview-store";
import { useTask } from "@/hooks/use-tasks";
import { useVehicleAssignments } from "@/hooks/use-vehicle-assignments";
import { useResourceAssignments } from "@/hooks/use-resource-assignments";
import { usePermissions } from "@/hooks/use-permissions";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskFormDialog } from "@/components/planning/task-form-dialog";
import { contrastColor } from "@/lib/utils";

export function GlobalTaskPreview() {
  const { taskId, open, closePreview } = useTaskPreviewStore();
  const { data: task } = useTask(open ? taskId : null);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Load vehicle/resource assignments for the task's date range to enrich the preview
  const startDate = task?.startDate;
  const endDate = task?.endDate || task?.startDate;
  const { data: vehicleAssignments } = useVehicleAssignments(undefined, startDate, endDate);
  const { data: resourceAssignments } = useResourceAssignments(undefined, startDate, endDate);

  const { userId } = usePermissions();

  // Load collaborators (other users working on the same project the same day)
  const { data: collabData } = useQuery({
    queryKey: ["home-collaborators", startDate, endDate, userId],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate: startDate!, endDate: endDate! });
      const res = await fetch(`/api/home/collaborators?${params}`);
      if (!res.ok) return { data: [] };
      return res.json() as Promise<{ data: { userId: string; userName: string; userFirstName?: string | null; userColor: string; projectId: string; startDate: string; endDate?: string | null }[] }>;
    },
    enabled: !!startDate && !!endDate && !!userId,
  });

  const collaborators = useMemo(() => {
    if (!task || !collabData?.data || !userId) return [];
    const seen = new Map<string, { id: string; displayName: string; color: string }>();
    for (const r of collabData.data) {
      if (r.userId === userId) continue;
      if (r.projectId !== task.projectId) continue;
      const end = r.endDate ?? r.startDate;
      if (r.startDate > task.startDate || end < task.startDate) continue;
      if (seen.has(r.userId)) continue;
      const displayName = [r.userFirstName, r.userName].filter(Boolean).join(" ") || r.userName;
      seen.set(r.userId, { id: r.userId, displayName, color: r.userColor || "#6b7280" });
    }
    return Array.from(seen.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [task, collabData, userId]);

  const enrichedTask = useMemo(() => {
    if (!task) return null;
    const projectId = task.projectId;
    const vNames: string[] = [];
    for (const a of vehicleAssignments ?? []) {
      if (a.projectId === projectId && a.vehicle?.name && !vNames.includes(a.vehicle.name)) {
        vNames.push(a.vehicle.name);
      }
    }
    const rNames: string[] = [];
    for (const a of resourceAssignments ?? []) {
      if (a.projectId === projectId && a.resource?.name && !rNames.includes(a.resource.name)) {
        rNames.push(a.resource.name);
      }
    }
    if (vNames.length === 0 && rNames.length === 0) return task;
    return { ...task, vehicleNames: vNames, resourceNames: rNames };
  }, [task, vehicleAssignments, resourceAssignments]);

  return (
    <>
      <TaskDetail
        task={enrichedTask}
        open={open && !!enrichedTask}
        onOpenChange={(v) => { if (!v) closePreview(); }}
        collaborators={collaborators}
        onEdit={(t) => {
          closePreview();
          setEditId(t.id);
          setEditOpen(true);
        }}
      />
      <TaskFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        taskId={editId}
        prefill={null}
        viewMode="users"
      />
    </>
  );
}
