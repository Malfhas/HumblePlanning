import type { InferSelectModel } from "drizzle-orm";
import type { tasks } from "@/db/schema/tasks";
import type { users } from "@/db/schema/users";
import type { projects } from "@/db/schema/projects";
import type { statuses } from "@/db/schema/statuses";
import type { places } from "@/db/schema/places";
import type { resources } from "@/db/schema/resources";
import type { teams } from "@/db/schema/teams";
import type { projectGroups } from "@/db/schema/project-groups";
import type { holidays } from "@/db/schema/holidays";
import type { savedFilters, FilterConfig } from "@/db/schema/saved-filters";
import type { qualifications } from "@/db/schema/qualifications";
import type { roles } from "@/db/schema/roles";
import type { resourceTypes } from "@/db/schema/resource-types";
import type { resourceAssignments } from "@/db/schema/resource-assignments";
import type { vehicleTypes } from "@/db/schema/vehicle-types";
import type { vehicles } from "@/db/schema/vehicles";
import type { vehicleAssignments } from "@/db/schema/vehicle-assignments";
import type { businessUnits } from "@/db/schema/business-units";
import type { laborTypes } from "@/db/schema/labor-types";
import type { projectLaborBudgets } from "@/db/schema/project-labor-budgets";

// Base DB types (inferred from Drizzle schema)
export type Task = InferSelectModel<typeof tasks>;
export type User = InferSelectModel<typeof users>;
export type Project = InferSelectModel<typeof projects>;
export type Status = InferSelectModel<typeof statuses>;
export type Place = InferSelectModel<typeof places>;
export type Resource = InferSelectModel<typeof resources>;
export type Team = InferSelectModel<typeof teams>;
export type ProjectGroup = InferSelectModel<typeof projectGroups>;
export type Holiday = InferSelectModel<typeof holidays>;
export type SavedFilter = InferSelectModel<typeof savedFilters>;
export type Qualification = InferSelectModel<typeof qualifications>;
export type Role = InferSelectModel<typeof roles>;
export type ResourceType = InferSelectModel<typeof resourceTypes>;
export type ResourceAssignment = InferSelectModel<typeof resourceAssignments>;
export type VehicleType = InferSelectModel<typeof vehicleTypes>;
export type Vehicle = InferSelectModel<typeof vehicles>;
export type VehicleAssignment = InferSelectModel<typeof vehicleAssignments>;
export type BusinessUnit = InferSelectModel<typeof businessUnits>;
export type LaborType = InferSelectModel<typeof laborTypes>;
export type ProjectLaborBudget = InferSelectModel<typeof projectLaborBudgets>;

export interface ProjectLaborBudgetWithType extends ProjectLaborBudget {
  laborType?: Pick<LaborType, "id" | "name" | "initials"> | null;
}

export interface RoleWithPermissions extends Role {
  permissions: string[];
}

export interface ResourceWithType extends Resource {
  resourceType?: Pick<ResourceType, "id" | "name" | "icon" | "color"> | null;
  businessUnit?: Pick<BusinessUnit, "id" | "name"> | null;
}

export interface ResourceAssignmentWithRelations extends ResourceAssignment {
  resource?: Pick<Resource, "id" | "name" | "color"> & { resourceType?: Pick<ResourceType, "id" | "name" | "icon" | "color"> | null } | null;
  task?: { id: string; title: string | null } | null;
  project?: { id: string; name: string; color: string | null } | null;
  assignedByUser?: { id: string; name: string; firstName?: string | null } | null;
  lastModifier?: { id: string; name: string; firstName?: string | null } | null;
}

export interface VehicleWithType extends Vehicle {
  vehicleType?: Pick<VehicleType, "id" | "name" | "icon" | "color"> | null;
  businessUnit?: Pick<BusinessUnit, "id" | "name"> | null;
}

export interface VehicleAssignmentWithRelations extends VehicleAssignment {
  vehicle?: Pick<Vehicle, "id" | "name" | "color"> & { vehicleType?: Pick<VehicleType, "id" | "name" | "icon" | "color"> | null } | null;
  task?: { id: string; title: string | null } | null;
  project?: { id: string; name: string; color: string | null } | null;
  assignedByUser?: { id: string; name: string; firstName?: string | null } | null;
  lastModifier?: { id: string; name: string; firstName?: string | null } | null;
}

// Re-export FilterConfig for convenience
export type { FilterConfig };

// File metadata stored in tasks.files JSONB column
export interface TaskFile {
  id: string;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy?: string;
}

// User summary (subset loaded in task relations)
export interface UserSummary {
  id: string;
  name: string;
  firstName?: string | null;
  username?: string | null;
  teamId?: string | null;
  color?: string | null;
  businessUnitId?: string | null;
}

// Task with all relations loaded (as returned by API)
// Note: Date fields become strings after JSON serialization
export interface TaskWithUsers extends Omit<Task, "createdAt" | "updatedAt"> {
  createdAt: string | Date;
  updatedAt: string | Date;
  users: UserSummary[];
  project?: Pick<Project, "id" | "name" | "color" | "businessNumber" | "businessUnitId" | "address" | "addressLat" | "addressLng" | "ownerId"> | null;
  status?: Status | null;
  place?: Pick<Place, "id" | "name"> | null;
  resource?: Pick<Resource, "id" | "name"> | null;
  creator?: { id: string; name: string } | null;
  lastModifier?: { id: string; name: string } | null;
  // Allow dynamic property access for viewMode-based row key lookup
  [key: string]: unknown;
}

// User with team relation (as returned by API)
export interface UserWithTeam extends User {
  team?: Pick<Team, "id" | "name" | "color"> | null;
  role?: Pick<Role, "id" | "name" | "isAdmin" | "isSystem" | "color"> | null;
  qualifications?: Pick<Qualification, "id" | "name" | "emoji" | "color">[];
  businessUnit?: Pick<BusinessUnit, "id" | "name"> | null;
  laborType?: Pick<LaborType, "id" | "name" | "initials"> | null;
}

// Project with relations loaded (as returned by API)
export interface ProjectWithRelations extends Project {
  group?: Pick<ProjectGroup, "id" | "name" | "color"> | null;
  owner?: Pick<User, "id" | "name" | "firstName"> | null;
  taskCount?: number;
}

// Project with extra computed fields
export interface ProjectWithTaskCount extends Project {
  taskCount?: number;
}

// Group with projects relation (as returned by API)
export interface ProjectGroupWithProjects extends ProjectGroup {
  projects?: Project[];
}

// Team with users relation (as returned by teams API with nested users)
export interface TeamWithUsers extends Team {
  users?: User[];
}

// Generic entity with id/name/color (used for filter panels, selects, etc.)
export interface NamedEntity {
  id: string;
  name: string;
  color?: string | null;
}

// Paginated API response
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
