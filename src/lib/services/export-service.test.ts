import { describe, expect, it } from "bun:test";
import {
  getVehicleExportBusinessUnits,
  mapVehicleAssignment,
  type ExportFilters,
  type VehicleAssignmentRow,
} from "./export-service";
import type { ProjectReadScope, UserPermissions } from "./permission-service";

const perms = (permissions: string[], isAdmin = false): UserPermissions => ({
  userId: "me", roleId: "r", teamId: "team-a", businessUnitId: "bu-a", permissions, isAdmin,
});

const filters = (businessUnitIds?: string[]): ExportFilters => ({
  viewMode: "vehicles", startDate: "2026-11-01", endDate: "2026-11-30", businessUnitIds,
});

// Seed "Manager": own BU, sees the planning vehicle view.
const manager = perms(["export:use", "planning:view_vehicles", "scope:bu_own", "scope:projects_bu", "scope:users_bu"]);

describe("getVehicleExportBusinessUnits", () => {
  it("keeps a BU-scoped user within their business unit, whatever the request", () => {
    expect(getVehicleExportBusinessUnits(filters(), manager)).toEqual(["bu-a"]);
    expect(getVehicleExportBusinessUnits(filters(["bu-b"]), manager)).toEqual([]);
    expect(getVehicleExportBusinessUnits(filters(["bu-a", "bu-b"]), manager)).toEqual(["bu-a"]);
  });

  it("follows the selected business units when every BU is in scope", () => {
    const admin = perms([], true);
    expect(getVehicleExportBusinessUnits(filters(), admin)).toBeNull();
    expect(getVehicleExportBusinessUnits(filters(["bu-b"]), admin)).toEqual(["bu-b"]);
    const allBus = perms(["planning:view_vehicles", "scope:bu_all"]);
    expect(getVehicleExportBusinessUnits(filters(), allBus)).toBeNull();
  });

  it("requires the permission of the planning vehicle view", () => {
    const noVehicles = perms(["export:use", "scope:bu_all"]);
    expect(() => getVehicleExportBusinessUnits(filters(), noVehicles)).toThrow(
      expect.objectContaining({ code: "errors.forbidden", status: 403 }),
    );
  });
});

describe("mapVehicleAssignment", () => {
  const label = (type: string) => ({ task: "Task", reservation: "Booking" })[type] ?? type;
  // Readable: the projects of BU A
  const scope: ProjectReadScope = { visibleProjectIds: ["project-a"], managedBusinessUnitIds: ["bu-a"] };
  const assignment = (over: Partial<VehicleAssignmentRow> = {}): VehicleAssignmentRow => ({
    id: "va1", vehicleId: "v1", type: "task", notes: "Morning",
    startDate: "2026-11-02", endDate: "2026-11-02", startTime: null, endTime: null,
    vehicle: { name: "Van 1", vehicleType: { name: "Van" } },
    project: { id: "project-a", name: "Site A", color: "#111111", businessUnitId: "bu-a" },
    assignedByUser: { id: "u1", name: "Doe", username: "jane.doe" },
    ...over,
  });

  it("shows a readable project", () => {
    const row = mapVehicleAssignment(assignment(), label, scope);
    expect(row.title).toBe("Site A");
    expect(row.project).toEqual({ id: "project-a", name: "Site A", color: "#111111" });
    expect(row.vehicleName).toBe("Van 1");
    expect(row.vehicleTypeName).toBe("Van");
  });

  it("hides the project of another business unit", () => {
    const otherBu = { id: "project-b", name: "Secret site", color: "#222222", businessUnitId: "bu-b" };
    const row = mapVehicleAssignment(assignment({ project: otherBu }), label, scope);
    expect(row.project).toBeNull();
    expect(row.title).toBe("Task — Morning");
    expect(JSON.stringify(row)).not.toContain("Secret site");
  });

  it("reads like a booking without project", () => {
    const row = mapVehicleAssignment(assignment({ type: "reservation", project: null, notes: null }), label, scope);
    expect(row.title).toBe("Booking");
    expect(row.users).toEqual([{ id: "u1", name: "Doe", username: "jane.doe" }]);
  });
});
