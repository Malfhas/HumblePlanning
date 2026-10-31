import { db } from "@/db";
import { vehicleAssignments } from "@/db/schema";
import { eq, and, lte, gte, ne } from "drizzle-orm";
import {
  BOOKING_PROJECT_RELATION,
  BOOKING_TASK_RELATION,
  scopeBookings,
  type EquipmentScope,
} from "./equipment-scope";

export async function isVehicleAssignmentLocked(id: string): Promise<boolean> {
  const a = await db.query.vehicleAssignments.findFirst({
    where: eq(vehicleAssignments.id, id),
    columns: { isLocked: true },
  });
  return a?.isLocked === true;
}

const WITH_VA_RELATIONS = {
  vehicle: {
    columns: { id: true, name: true, color: true, businessUnitId: true },
    with: {
      vehicleType: {
        columns: { id: true, name: true, icon: true, color: true },
      },
    },
  },
  task: BOOKING_TASK_RELATION,
  project: BOOKING_PROJECT_RELATION,
  assignedByUser: { columns: { id: true, name: true, firstName: true } },
  lastModifier: { columns: { id: true, name: true, firstName: true } },
} as const;

/** Assignments visible within `scope` (`getEquipmentScope`), optionally of one vehicle / period. */
export async function getVehicleAssignments(scope: EquipmentScope, vehicleId?: string, startDate?: string, endDate?: string) {
  const rows = await db.query.vehicleAssignments.findMany({
    where: and(
      vehicleId ? eq(vehicleAssignments.vehicleId, vehicleId) : undefined,
      startDate ? lte(vehicleAssignments.startDate, endDate || startDate) : undefined,
      endDate ? gte(vehicleAssignments.endDate, startDate || endDate) : undefined,
    ),
    with: WITH_VA_RELATIONS,
    orderBy: (va, { asc }) => [asc(va.startDate)],
  });
  return scopeBookings(rows, scope, (a) => a.vehicle);
}

/** The assignment when it exists and is visible within `scope`, otherwise null. */
export async function getVehicleAssignmentById(id: string, scope: EquipmentScope) {
  const row = await db.query.vehicleAssignments.findFirst({
    where: eq(vehicleAssignments.id, id),
    with: WITH_VA_RELATIONS,
  });
  return row ? scopeBookings([row], scope, (a) => a.vehicle)[0] ?? null : null;
}

export async function getAssignmentsForTask(taskId: string) {
  return db.query.vehicleAssignments.findMany({
    where: eq(vehicleAssignments.taskId, taskId),
    with: {
      vehicle: {
        columns: { id: true, name: true, color: true },
        with: {
          vehicleType: {
            columns: { id: true, name: true, icon: true, color: true },
          },
        },
      },
    },
  });
}

/** Assignments of a vehicle overlapping a period, task / project details within `scope`. */
export async function checkConflicts(
  scope: EquipmentScope,
  vehicleId: string,
  startDate: string,
  endDate: string,
  excludeId?: string,
) {
  const conflicts = await db.query.vehicleAssignments.findMany({
    where: and(
      eq(vehicleAssignments.vehicleId, vehicleId),
      lte(vehicleAssignments.startDate, endDate),
      gte(vehicleAssignments.endDate, startDate),
      excludeId ? ne(vehicleAssignments.id, excludeId) : undefined,
    ),
    with: {
      vehicle: { columns: { businessUnitId: true } },
      task: BOOKING_TASK_RELATION,
      project: BOOKING_PROJECT_RELATION,
    },
  });
  return scopeBookings(conflicts, scope, (a) => a.vehicle);
}

export async function createVehicleAssignment(data: {
  vehicleId: string;
  taskId?: string | null;
  projectId?: string | null;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  assignedBy?: string | null;
  notes?: string | null;
  type?: string;
}) {
  const [assignment] = await db.insert(vehicleAssignments).values(data).returning();
  return assignment;
}

export async function updateVehicleAssignment(
  id: string,
  data: {
    vehicleId?: string;
    taskId?: string | null;
    projectId?: string | null;
    startDate?: string;
    endDate?: string;
    startTime?: string | null;
    endTime?: string | null;
    notes?: string | null;
    type?: string;
    isLocked?: boolean;
  },
  modifierId?: string,
) {
  const [assignment] = await db
    .update(vehicleAssignments)
    .set({ ...data, lastModifierId: modifierId ?? null })
    .where(eq(vehicleAssignments.id, id))
    .returning();
  return assignment;
}

export async function deleteVehicleAssignment(id: string) {
  const [assignment] = await db
    .delete(vehicleAssignments)
    .where(eq(vehicleAssignments.id, id))
    .returning();
  return assignment;
}

export async function deleteAssignmentsForTask(taskId: string) {
  return db
    .delete(vehicleAssignments)
    .where(eq(vehicleAssignments.taskId, taskId));
}

export async function syncTaskVehicleAssignments(
  taskId: string,
  vehicleIds: string[],
  startDate: string,
  endDate: string,
  assignedBy?: string,
) {
  // Delete existing task assignments
  await db.delete(vehicleAssignments).where(
    and(
      eq(vehicleAssignments.taskId, taskId),
      eq(vehicleAssignments.type, "task"),
    )
  );

  // Create new assignments
  if (vehicleIds.length > 0) {
    await db.insert(vehicleAssignments).values(
      vehicleIds.map((vehicleId) => ({
        vehicleId,
        taskId,
        startDate,
        endDate,
        type: "task" as const,
        assignedBy: assignedBy || null,
      }))
    );
  }
}
