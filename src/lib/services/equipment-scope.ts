import { db } from "@/db";
import { vehicles, resources, vehicleAssignments, resourceAssignments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import {
  assertTaskReadable,
  getProjectReadScope,
  getReadableProject,
  getTaskAccessScope,
  getVisibleBusinessUnitIds,
  isProjectInReadScope,
  isTaskInAccessScope,
  type ProjectReadScope,
  type TaskAccessScope,
  type UserPermissions,
} from "./permission-service";

/**
 * What a user may see of the vehicles and resources (equipment) and of their
 * bookings (vehicle / resource assignments). Shared by their API routes, the
 * MCP and AI chat tools and the vehicle export (writes: see below):
 *   - a vehicle or resource when it belongs to a business unit of the user's
 *     BU scope (`getVisibleBusinessUnitIds`); strict like the planning rows:
 *     one without BU only shows when that scope is unrestricted;
 *   - a booking when its vehicle / resource is visible, or when its project is
 *     readable: the planning, the home page and the task preview show on a
 *     task which vehicle serves its project, whichever BU lends it;
 *   - the project of a booking only when readable, its task only when
 *     readable. Their ids stay, so that saving a booking keeps its links.
 */
export interface EquipmentScope {
  /** Business units whose equipment is visible: `null` = every one. */
  businessUnitIds: string[] | null;
  projectScope: ProjectReadScope;
  taskScope: TaskAccessScope;
}

export async function getEquipmentScope(perms: UserPermissions): Promise<EquipmentScope> {
  const [projectScope, taskScope] = await Promise.all([getProjectReadScope(perms), getTaskAccessScope(perms)]);
  return { businessUnitIds: getVisibleBusinessUnitIds(perms), projectScope, taskScope };
}

/** True if a vehicle / resource belongs to `businessUnitIds` (`null` = no restriction). */
export function isEquipmentVisible(item: { businessUnitId: string | null }, businessUnitIds: string[] | null): boolean {
  return businessUnitIds === null || (item.businessUnitId !== null && businessUnitIds.includes(item.businessUnitId));
}

/** Relations of a booking query needed by `scopeBookings`. */
export const BOOKING_PROJECT_RELATION = { columns: { id: true, name: true, color: true, businessUnitId: true } } as const;
export const BOOKING_TASK_RELATION = {
  columns: { id: true, title: true, projectId: true },
  with: { taskUsers: { columns: { userId: true } } },
} as const;

/** A booking loaded with `BOOKING_PROJECT_RELATION` and `BOOKING_TASK_RELATION`. */
export interface ScopedBookingFields {
  project: { id: string; name: string; color: string | null; businessUnitId: string | null } | null;
  task: { id: string; title: string | null; projectId: string; taskUsers: { userId: string }[] } | null;
}

export type ScopedBooking<B extends ScopedBookingFields> = Omit<B, "project" | "task"> & {
  project: { id: string; name: string; color: string | null } | null;
  task: { id: string; title: string | null } | null;
};

/**
 * The bookings visible to the user (see `EquipmentScope`), their project and
 * task reduced to what the client reads (`{ id, name, color }`, `{ id, title }`)
 * when readable, null otherwise. `equipmentOf` gives the booked vehicle / resource.
 */
export function scopeBookings<B extends ScopedBookingFields>(
  bookings: B[],
  scope: EquipmentScope,
  equipmentOf: (booking: B) => { businessUnitId: string | null } | null,
): ScopedBooking<B>[] {
  const visible: ScopedBooking<B>[] = [];
  for (const booking of bookings) {
    const { project, task } = booking;
    const projectReadable = !!project && isProjectInReadScope(project, scope.projectScope);
    const equipment = equipmentOf(booking);
    if (!projectReadable && !(equipment && isEquipmentVisible(equipment, scope.businessUnitIds))) continue;
    const taskReadable = !!task && isTaskInAccessScope(
      { projectId: task.projectId, users: task.taskUsers.map((tu) => ({ id: tu.userId })) },
      scope.taskScope,
    );
    visible.push({
      ...booking,
      project: projectReadable ? { id: project.id, name: project.name, color: project.color } : null,
      task: taskReadable ? { id: task.id, title: task.title } : null,
    });
  }
  return visible;
}

// ════════════════════════════════════════════════════════════════════════
// Writes
// ════════════════════════════════════════════════════════════════════════

export type EquipmentKind = "vehicle" | "resource";

const NOT_FOUND = {
  vehicle: { equipment: "resources.errors.vehicleNotFound", booking: "resources.errors.vehicleAssignmentNotFound" },
  resource: { equipment: "resources.errors.resourceNotFound", booking: "resources.errors.resourceAssignmentNotFound" },
} as const;

async function loadEquipment(kind: EquipmentKind, id: string): Promise<{ businessUnitId: string | null } | null> {
  const [row] = kind === "vehicle"
    ? await db.select({ businessUnitId: vehicles.businessUnitId }).from(vehicles).where(eq(vehicles.id, id)).limit(1)
    : await db.select({ businessUnitId: resources.businessUnitId }).from(resources).where(eq(resources.id, id)).limit(1);
  return row ?? null;
}

/** The references of a booking: the booked vehicle / resource, its project and its task. */
export interface BookingRefs {
  equipmentId: string;
  projectId: string | null;
  taskId: string | null;
}

async function loadBookingRefs(kind: EquipmentKind, id: string): Promise<BookingRefs | null> {
  const [row] = kind === "vehicle"
    ? await db.select({ equipmentId: vehicleAssignments.vehicleId, projectId: vehicleAssignments.projectId, taskId: vehicleAssignments.taskId })
        .from(vehicleAssignments).where(eq(vehicleAssignments.id, id)).limit(1)
    : await db.select({ equipmentId: resourceAssignments.resourceId, projectId: resourceAssignments.projectId, taskId: resourceAssignments.taskId })
        .from(resourceAssignments).where(eq(resourceAssignments.id, id)).limit(1);
  return row ?? null;
}

/**
 * The references a booking write sets to a new value, given the current
 * booking (`null` for a creation): only those need checking. One kept as it is
 * stays allowed (the booking form re-sends the project of a booking lent to
 * another business unit, which the user cannot read), clearing one too.
 */
export function changedBookingReferences(current: BookingRefs | null, next: Partial<BookingRefs>): Partial<BookingRefs> {
  const changed: Partial<BookingRefs> = {};
  for (const key of ["equipmentId", "projectId", "taskId"] as const) {
    const value = next[key];
    if (value && value !== current?.[key]) changed[key] = value;
  }
  return changed;
}

/**
 * Throws unless the user may write the vehicle / resource `id` (`null` for a
 * creation): an existing one must be visible (404 otherwise, like the detail
 * GET), and the business unit it is created in or moved to (`businessUnitId`)
 * within the user's BU scope (403, like the projects). The action permission
 * (`vehicles:edit`…) is checked by the caller.
 */
export async function assertEquipmentWritable(
  perms: UserPermissions,
  kind: EquipmentKind,
  id: string | null,
  businessUnitId?: string | null,
) {
  const businessUnitIds = getVisibleBusinessUnitIds(perms);
  let current: { businessUnitId: string | null } | null = null;
  if (id !== null) {
    current = await loadEquipment(kind, id);
    if (!current || !isEquipmentVisible(current, businessUnitIds)) throw new AppError(NOT_FOUND[kind].equipment, { status: 404 });
  }
  if (businessUnitId !== undefined && businessUnitId !== current?.businessUnitId
    && !isEquipmentVisible({ businessUnitId }, businessUnitIds)) {
    throw new AppError("errors.forbidden");
  }
}

/**
 * Throws unless the user may write the booking `id` (`null` for a creation)
 * with the references `next`: the current booking must be on a visible vehicle /
 * resource, a new vehicle / resource visible, a new project or task readable.
 * Out-of-scope ids answer like missing ones (404). Booking equipment for a task
 * does not modify the task (the planning books a vehicle for a project with the
 * vehicle permissions only): reading it is enough. The action permission
 * (`vehicles:create`…) is checked by the caller.
 */
export async function assertBookingWritable(
  perms: UserPermissions,
  kind: EquipmentKind,
  id: string | null,
  next: Partial<BookingRefs>,
) {
  const businessUnitIds = getVisibleBusinessUnitIds(perms);
  const visible = async (equipmentId: string) => {
    const equipment = await loadEquipment(kind, equipmentId);
    return !!equipment && isEquipmentVisible(equipment, businessUnitIds);
  };
  let current: BookingRefs | null = null;
  if (id !== null) {
    current = await loadBookingRefs(kind, id);
    if (!current || !(await visible(current.equipmentId))) throw new AppError(NOT_FOUND[kind].booking, { status: 404 });
  }
  const changed = changedBookingReferences(current, next);
  if (changed.equipmentId && !(await visible(changed.equipmentId))) {
    throw new AppError(NOT_FOUND[kind].equipment, { status: 404 });
  }
  if (changed.projectId && !(await getReadableProject(perms, changed.projectId))) {
    throw new AppError("projects.errors.notFound");
  }
  if (changed.taskId) await assertTaskReadable(perms, changed.taskId);
}

/**
 * Throws `resources.errors.resourceNotFound` (404) when a task write sets the
 * task's resource to one outside the user's business units (or a missing one).
 * `current`: the task's resource before the write, which stays allowed.
 */
export async function assertTaskResourceWritable(
  perms: UserPermissions,
  resourceId: string | null | undefined,
  current: string | null = null,
) {
  if (!resourceId || resourceId === current) return;
  const resource = await loadEquipment("resource", resourceId);
  if (!resource || !isEquipmentVisible(resource, getVisibleBusinessUnitIds(perms))) {
    throw new AppError(NOT_FOUND.resource.equipment, { status: 404 });
  }
}
