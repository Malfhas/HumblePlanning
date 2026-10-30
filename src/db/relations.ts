import { relations } from "drizzle-orm";
import { teams } from "./schema/teams";
import { users } from "./schema/users";
import { projectGroups } from "./schema/project-groups";
import { projects } from "./schema/projects";
import { tasks } from "./schema/tasks";
import { taskUsers } from "./schema/task-users";
import { statuses } from "./schema/statuses";
import { places } from "./schema/places";
import { resources } from "./schema/resources";
import { auditLogs } from "./schema/audit-logs";
import { savedFilters } from "./schema/saved-filters";
import { qualifications } from "./schema/qualifications";
import { userQualifications } from "./schema/user-qualifications";
import { roles } from "./schema/roles";
import { rolePermissions } from "./schema/role-permissions";
import { accounts } from "./schema/auth";
import { mcpTokens } from "./schema/mcp";
import { mcpAuthorizationCodes } from "./schema/mcp";
import { apiKeys } from "./schema/api-keys";
import { vehicleTypes } from "./schema/vehicle-types";
import { vehicles } from "./schema/vehicles";
import { vehicleAssignments } from "./schema/vehicle-assignments";
import { businessUnits } from "./schema/business-units";
import { laborTypes } from "./schema/labor-types";
import { projectLaborBudgets } from "./schema/project-labor-budgets";
import { backupHistory } from "./schema/backup-history";
import { resourceTypes } from "./schema/resource-types";
import { resourceAssignments } from "./schema/resource-assignments";
import { notifications } from "./schema/notifications";
import { aiChatConversations, aiChatMessages, aiChatToolCalls, aiChatQuotaLedger } from "./schema/ai-chat";

export const teamsRelations = relations(teams, ({ one, many }) => ({
  users: many(users),
  businessUnit: one(businessUnits, { fields: [teams.businessUnitId], references: [businessUnits.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  businessUnit: one(businessUnits, { fields: [users.businessUnitId], references: [businessUnits.id] }),
  laborType: one(laborTypes, { fields: [users.laborTypeId], references: [laborTypes.id] }),
  ownedProjects: many(projects),
  taskUsers: many(taskUsers),
  userQualifications: many(userQualifications),
  savedFilters: many(savedFilters),
  auditLogs: many(auditLogs),
  mcpTokens: many(mcpTokens),
  apiKeys: many(apiKeys),
  notifications: many(notifications),
}));

export const projectGroupsRelations = relations(projectGroups, ({ one, many }) => ({
  projects: many(projects),
  businessUnit: one(businessUnits, { fields: [projectGroups.businessUnitId], references: [businessUnits.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  group: one(projectGroups, { fields: [projects.groupId], references: [projectGroups.id] }),
  businessUnit: one(businessUnits, { fields: [projects.businessUnitId], references: [businessUnits.id] }),
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  tasks: many(tasks),
  projectLaborBudgets: many(projectLaborBudgets),
}));

export const statusesRelations = relations(statuses, ({ many }) => ({
  tasks: many(tasks),
}));

export const placesRelations = relations(places, ({ many }) => ({
  tasks: many(tasks),
}));

export const resourceTypesRelations = relations(resourceTypes, ({ many }) => ({
  resources: many(resources),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  resourceType: one(resourceTypes, { fields: [resources.resourceTypeId], references: [resourceTypes.id] }),
  businessUnit: one(businessUnits, { fields: [resources.businessUnitId], references: [businessUnits.id] }),
  assignments: many(resourceAssignments),
}));

export const resourceAssignmentsRelations = relations(resourceAssignments, ({ one }) => ({
  resource: one(resources, { fields: [resourceAssignments.resourceId], references: [resources.id] }),
  task: one(tasks, { fields: [resourceAssignments.taskId], references: [tasks.id] }),
  project: one(projects, { fields: [resourceAssignments.projectId], references: [projects.id] }),
  assignedByUser: one(users, { fields: [resourceAssignments.assignedBy], references: [users.id] }),
  lastModifier: one(users, { fields: [resourceAssignments.lastModifierId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  status: one(statuses, { fields: [tasks.statusId], references: [statuses.id] }),
  place: one(places, { fields: [tasks.placeId], references: [places.id] }),
  resource: one(resources, { fields: [tasks.resourceId], references: [resources.id] }),
  parent: one(tasks, { fields: [tasks.parentId], references: [tasks.id] }),
  creator: one(users, { fields: [tasks.creatorId], references: [users.id] }),
  lastModifier: one(users, { fields: [tasks.lastModifierId], references: [users.id] }),
  taskUsers: many(taskUsers),
}));

export const taskUsersRelations = relations(taskUsers, ({ one }) => ({
  task: one(tasks, { fields: [taskUsers.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskUsers.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const savedFiltersRelations = relations(savedFilters, ({ one }) => ({
  user: one(users, { fields: [savedFilters.userId], references: [users.id] }),
}));

export const qualificationsRelations = relations(qualifications, ({ many }) => ({
  userQualifications: many(userQualifications),
}));

export const userQualificationsRelations = relations(userQualifications, ({ one }) => ({
  user: one(users, { fields: [userQualifications.userId], references: [users.id] }),
  qualification: one(qualifications, { fields: [userQualifications.qualificationId], references: [qualifications.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  users: many(users),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
}));

export const vehicleTypesRelations = relations(vehicleTypes, ({ many }) => ({
  vehicles: many(vehicles),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  vehicleType: one(vehicleTypes, { fields: [vehicles.vehicleTypeId], references: [vehicleTypes.id] }),
  businessUnit: one(businessUnits, { fields: [vehicles.businessUnitId], references: [businessUnits.id] }),
  assignments: many(vehicleAssignments),
}));

export const vehicleAssignmentsRelations = relations(vehicleAssignments, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleAssignments.vehicleId], references: [vehicles.id] }),
  task: one(tasks, { fields: [vehicleAssignments.taskId], references: [tasks.id] }),
  project: one(projects, { fields: [vehicleAssignments.projectId], references: [projects.id] }),
  assignedByUser: one(users, { fields: [vehicleAssignments.assignedBy], references: [users.id] }),
  lastModifier: one(users, { fields: [vehicleAssignments.lastModifierId], references: [users.id] }),
}));

export const businessUnitsRelations = relations(businessUnits, ({ many }) => ({
  users: many(users),
}));

export const laborTypesRelations = relations(laborTypes, ({ many }) => ({
  projectLaborBudgets: many(projectLaborBudgets),
  users: many(users),
}));

export const projectLaborBudgetsRelations = relations(projectLaborBudgets, ({ one }) => ({
  project: one(projects, { fields: [projectLaborBudgets.projectId], references: [projects.id] }),
  laborType: one(laborTypes, { fields: [projectLaborBudgets.laborTypeId], references: [laborTypes.id] }),
}));

export const mcpTokensRelations = relations(mcpTokens, ({ one }) => ({
  user: one(users, { fields: [mcpTokens.userId], references: [users.id] }),
}));

export const mcpAuthorizationCodesRelations = relations(mcpAuthorizationCodes, ({ one }) => ({
  user: one(users, { fields: [mcpAuthorizationCodes.userId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

export const backupHistoryRelations = relations(backupHistory, ({ one }) => ({
  user: one(users, { fields: [backupHistory.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const aiChatConversationsRelations = relations(aiChatConversations, ({ one, many }) => ({
  user: one(users, { fields: [aiChatConversations.userId], references: [users.id] }),
  project: one(projects, { fields: [aiChatConversations.projectId], references: [projects.id] }),
  messages: many(aiChatMessages),
}));

export const aiChatMessagesRelations = relations(aiChatMessages, ({ one, many }) => ({
  conversation: one(aiChatConversations, { fields: [aiChatMessages.conversationId], references: [aiChatConversations.id] }),
  toolCalls: many(aiChatToolCalls),
}));

export const aiChatToolCallsRelations = relations(aiChatToolCalls, ({ one }) => ({
  message: one(aiChatMessages, { fields: [aiChatToolCalls.messageId], references: [aiChatMessages.id] }),
}));

export const aiChatQuotaLedgerRelations = relations(aiChatQuotaLedger, ({ one }) => ({
  user: one(users, { fields: [aiChatQuotaLedger.userId], references: [users.id] }),
}));
