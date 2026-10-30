import { db } from "@/db";
import { teams, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/services/audit-service";
import { invalidatePermissionsCache } from "@/lib/services/permission-service";
import { USER_SECRET_COLUMNS_EXCLUDED } from "@/lib/utils/user-columns";

export async function getTeams() {
  return db.query.teams.findMany({
    with: { users: { columns: USER_SECRET_COLUMNS_EXCLUDED } },
    orderBy: (teams, { asc }) => [asc(teams.sortOrder), asc(teams.name)],
  });
}

export async function reorderTeams(teamIds: string[]) {
  const updates = teamIds.map((teamId, index) =>
    db.update(teams).set({ sortOrder: index }).where(eq(teams.id, teamId))
  );
  await Promise.all(updates);
}

export async function getTeamById(id: string) {
  return db.query.teams.findFirst({
    where: eq(teams.id, id),
    with: { users: { columns: USER_SECRET_COLUMNS_EXCLUDED } },
  });
}

export async function createTeam(data: { name: string; color?: string; businessUnitId: string }) {
  const [team] = await db.insert(teams).values(data).returning();
  logAudit({ action: "create", entityType: "team", entityId: team.id, newValues: { name: data.name, color: data.color }, metadata: { name: data.name } }).catch(() => {});
  return team;
}

export async function updateTeam(id: string, data: { name?: string; color?: string; businessUnitId?: string }) {
  // If the team's BU changes, the members' `team` scope sees the set of
  // visible colleagues/projects change → invalidate their cache.
  // (Note: today users.businessUnitId is decoupled from teams.businessUnitId,
  //  but we invalidate as defense in depth — rare admin operation.)
  const oldTeam = data.businessUnitId !== undefined
    ? await db.query.teams.findFirst({ where: eq(teams.id, id), columns: { businessUnitId: true } })
    : null;

  const [team] = await db.update(teams).set(data).where(eq(teams.id, id)).returning();

  if (oldTeam && data.businessUnitId !== undefined && data.businessUnitId !== oldTeam.businessUnitId) {
    const teamMembers = await db.select({ id: users.id }).from(users).where(eq(users.teamId, id));
    for (const m of teamMembers) invalidatePermissionsCache(m.id);
  }

  logAudit({ action: "update", entityType: "team", entityId: id, newValues: data, metadata: { name: team.name } }).catch(() => {});
  return team;
}

export async function deleteTeam(id: string) {
  // Identify the users who will be dissociated BEFOREHAND to target the invalidation
  const affectedUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.teamId, id));
  // Dissociate users from this team before deleting
  await db.update(users).set({ teamId: null }).where(eq(users.teamId, id));
  const [team] = await db.delete(teams).where(eq(teams.id, id)).returning();
  // The teamId is part of the permissions cache of each affected user
  for (const u of affectedUsers) invalidatePermissionsCache(u.id);
  logAudit({ action: "delete", entityType: "team", entityId: id, oldValues: { name: team.name, color: team.color }, metadata: { name: team.name } }).catch(() => {});
  return team;
}
