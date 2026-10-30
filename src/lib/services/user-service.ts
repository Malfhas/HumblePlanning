import { db } from "@/db";
import { users, userQualifications, projects, tasks, taskUsers } from "@/db/schema";
import { accounts, sessions } from "@/db/schema";
import { eq, and as drizzleAnd, ne, notInArray, sql } from "drizzle-orm";
import type { CreateUser, UpdateUser } from "@/lib/validators/user";
import { logAudit, computeChanges, pickAuditFields } from "./audit-service";
import { hashPassword } from "@/lib/password";
import { getConfigValues } from "./config-service";
import { policyFromConfig, evaluatePassword, PWD_CONFIG_KEYS, type PasswordStrength } from "@/lib/password-policy";
import { generatePasswordFromConfig } from "@/lib/password-generator";
import { randomPasswordTemplate } from "./email-templates";
import { sendEmail } from "./email-service";
import { isPasswordReused, isPasswordBlacklisted, addPasswordToHistory } from "./password-history-service";
import { invalidatePermissionsCache } from "./permission-service";
import { logger } from "@/lib/logger";
import { USER_SECRET_COLUMNS_EXCLUDED } from "@/lib/utils/user-columns";
import { AppError, type FieldErrorSpec } from "@/lib/errors";
import { assertNotDemoAccount } from "@/lib/demo";
import { resolveRecipientLocale, resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator, translateKey } from "@/i18n/server-translator";

function mapUserWithQualifications(user: any) {
  if (!user) return user;
  const { userQualifications: uq, role, businessUnit, laborType, ...rest } = user;
  const displayName = [rest.firstName, rest.name].filter(Boolean).join(" ");
  return {
    ...rest,
    displayName,
    role: role ? { id: role.id, name: role.name, isAdmin: role.isAdmin, isSystem: role.isSystem, color: role.color } : null,
    qualifications: uq?.map((uq: any) => uq.qualification).filter(Boolean) ?? [],
    businessUnit: businessUnit ? { id: businessUnit.id, name: businessUnit.name, number: businessUnit.number, color: businessUnit.color } : null,
    laborType: laborType ? { id: laborType.id, name: laborType.name, initials: laborType.initials } : null,
  };
}

export async function getUsers(search?: string, activeOnly = true, planningOnly = false) {
  const result = await db.query.users.findMany({
    where: (users, { and, eq: eqOp, like: likeOp }) => {
      const conditions = [];
      if (activeOnly) conditions.push(eqOp(users.active, true));
      if (planningOnly) conditions.push(eqOp(users.visibleOnPlanning, true));
      if (search) conditions.push(likeOp(users.name, `%${search}%`));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    columns: USER_SECRET_COLUMNS_EXCLUDED,
    with: { team: true, role: true, businessUnit: true, laborType: true, userQualifications: { with: { qualification: true } } },
    orderBy: (users, { asc }) => [asc(users.name)],
  });
  return result.map(mapUserWithQualifications);
}

export async function getUserById(id: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: USER_SECRET_COLUMNS_EXCLUDED,
    with: { team: true, role: true, businessUnit: true, laborType: true, userQualifications: { with: { qualification: true } } },
  });
  if (!user) return null;
  const mapped = mapUserWithQualifications(user);

  // Check if user has a credential password
  const account = await db.query.accounts.findFirst({
    where: drizzleAnd(eq(accounts.userId, id), eq(accounts.providerId, "credential")),
    columns: { password: true },
  });
  mapped.hasPassword = !!(account?.password);

  return mapped;
}

async function checkUniqueness(username: string, email: string | null | undefined, excludeId?: string) {
  // Validate ALL fields at once so the user sees every error simultaneously,
  // not one after the other on each form submit.
  // Per-field errors (stable codes): the server translates them, the form
  // reads them in `fields` without depending on the text (see parseFieldErrors).
  const fields: Record<string, FieldErrorSpec> = {};

  if (username) {
    const conditions = [eq(users.username, username)];
    if (excludeId) conditions.push(ne(users.id, excludeId));
    const existing = await db.query.users.findFirst({
      where: drizzleAnd(...conditions),
      columns: { id: true },
    });
    if (existing) fields.username = { code: "users.errors.loginAlreadyUsed" };
  }
  if (email) {
    const conditions = [eq(users.email, email)];
    if (excludeId) conditions.push(ne(users.id, excludeId));
    const existing = await db.query.users.findFirst({
      where: drizzleAnd(...conditions),
      columns: { id: true },
    });
    if (existing) fields.email = { code: "users.errors.emailAlreadyUsed" };

    // Check Nuntly blocklist (only enforced when EMAIL_PROVIDER === "nuntly")
    const { isEmailBlocked } = await import("./email-blocklist-service");
    if (!existing && await isEmailBlocked(email)) {
      fields.email = { code: "users.errors.emailBlocked" };
    }
  }

  if (Object.keys(fields).length > 0) {
    // 409 if an identifier is already taken; 400 if only the email is blocked.
    const conflict = fields.username !== undefined || fields.email?.code === "users.errors.emailAlreadyUsed";
    throw new AppError("users.errors.invalidFields", { status: conflict ? 409 : 400, fields });
  }
}

/** Invalidate all sessions for a given user (force logout on all devices) */
async function invalidateUserSessions(userId: string, actorId?: string) {
  // Notify connected clients before deleting sessions
  try {
    const { emitSessionRevoked } = await import("@/lib/socket-events");
    emitSessionRevoked(userId);
  } catch { /* socket server may not be running */ }
  await db.delete(sessions).where(eq(sessions.userId, userId));
  logAudit({
    userId: actorId,
    action: "session_revoke",
    entityType: "session",
    entityId: userId,
    metadata: { targetUserId: userId },
  }).catch(() => {});
}

/**
 * "Non-compliant password" error attached to the form's `field` field
 * (response `{ error, code, fields }`). The unmet rules are translated
 * here, in the request language, then passed as the `details` parameter.
 * Also used by profile-service and the `api/auth/*` routes.
 */
export async function passwordNotCompliantError(
  strength: PasswordStrength,
  { field = "password", status = 422 }: { field?: string; status?: number } = {},
): Promise<AppError> {
  const t = await getServerTranslator(await resolveRequestLocale());
  const details = strength.checks
    .filter((c) => !c.met)
    .map((c) => translateKey(t, `validation.password.${c.key}`, c.params) ?? c.key)
    .join(", ");
  const spec: FieldErrorSpec = { code: "validation.password.notCompliant", params: { details } };
  return new AppError(spec.code, { status, params: spec.params, fields: { [field]: spec } });
}

/** Password rejected (blacklist, already used): error carried by the `field` field. */
export function passwordRejectedError(
  code: "users.errors.passwordBlacklisted" | "users.errors.passwordReused",
  { field = "password", status = 400 }: { field?: string; status?: number } = {},
): AppError {
  return new AppError(code, { status, fields: { [field]: { code } } });
}

async function validatePassword(password: string) {
  const config = await getConfigValues([...PWD_CONFIG_KEYS]);
  const policy = policyFromConfig(config);
  const strength = evaluatePassword(password, policy);
  if (!strength.valid) throw await passwordNotCompliantError(strength);
}

export async function createUser(data: CreateUser & { qualificationIds?: string[] }, creatorId?: string) {
  const { password, qualificationIds, generateRandomPassword, forcePasswordChange, ...userData } = data;

  await checkUniqueness(userData.username, userData.email);
  // Password policy checked BEFORE the insert: otherwise the account was
  // created without a password despite the error (and the login became "already taken").
  if (password && !(generateRandomPassword && userData.email)) await validatePassword(password);

  // Load default preferences from app config
  const defaultConfig = await getConfigValues([
    "DEFAULT_HOME_PAGE", "DEFAULT_PLANNING_VIEW", "DEFAULT_COLUMN_VIEW", "DEFAULT_THEME", "DEFAULT_NOTIFICATIONS", "DEFAULT_PUSH_NOTIFICATIONS", "DEFAULT_SMS_NOTIFICATIONS",
  ]);

  const defaultPreferences: Record<string, unknown> = {};
  if (defaultConfig.DEFAULT_HOME_PAGE) defaultPreferences.defaultHomePage = defaultConfig.DEFAULT_HOME_PAGE;
  if (defaultConfig.DEFAULT_PLANNING_VIEW) defaultPreferences.defaultView = defaultConfig.DEFAULT_PLANNING_VIEW;
  if (defaultConfig.DEFAULT_COLUMN_VIEW) defaultPreferences.columnView = defaultConfig.DEFAULT_COLUMN_VIEW;
  if (defaultConfig.DEFAULT_THEME) defaultPreferences.theme = defaultConfig.DEFAULT_THEME;

  const defaultNotifications = defaultConfig.DEFAULT_NOTIFICATIONS === "true";
  const defaultPushNotifications = defaultConfig.DEFAULT_PUSH_NOTIFICATIONS === "true";
  const defaultSmsNotifications = defaultConfig.DEFAULT_SMS_NOTIFICATIONS === "true";

  // If generating random password, set forcePasswordChange automatically
  const userValues = {
    ...userData,
    forcePasswordChange: generateRandomPassword ? true : (forcePasswordChange ?? false),
    preferences: defaultPreferences,
    notifications: userData.notifications !== undefined ? userData.notifications : defaultNotifications,
    pushNotifications: userData.pushNotifications !== undefined ? userData.pushNotifications : defaultPushNotifications,
    smsNotifications: userData.smsNotifications !== undefined ? userData.smsNotifications : defaultSmsNotifications,
  };
  const [user] = await db.insert(users).values(userValues).returning();

  // Generate random password and send by email
  if (generateRandomPassword && userData.email) {
    const config = await getConfigValues([...PWD_CONFIG_KEYS]);
    const clearPwd = generatePasswordFromConfig(config);
    const hashed = await hashPassword(clearPwd);
    await db.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hashed,
    });
    addPasswordToHistory(user.id, hashed).catch((err) => logger.error("auth", "Failed to add password to history", { error: err instanceof Error ? err.message : String(err) }));
    logAudit({ userId: creatorId, action: "password_change", entityType: "user", entityId: user.id, metadata: { method: "random_password", targetUser: userData.name, targetLogin: userData.username } }).catch((err) => logger.error("auth", "Failed to log audit for random password", { error: err instanceof Error ? err.message : String(err) }));
    // Send email — await to prevent race condition on rapid clicks
    const appConfig = await getConfigValues(["APP_TITLE", "APP_BASE_URL"]);
    // New account: no known language → instance language.
    const template = randomPasswordTemplate(
      userData.name,
      userData.username,
      clearPwd,
      appConfig.APP_TITLE ?? "HumblePlanning",
      appConfig.APP_BASE_URL || "http://localhost:3000",
      await resolveRecipientLocale(null)
    );
    await sendEmail({ to: userData.email, ...template });
  } else if (password) {
    // Create credential account if password provided (policy checked above)
    const hashed = await hashPassword(password);
    await db.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hashed,
    });
    addPasswordToHistory(user.id, hashed).catch((err) => logger.error("auth", "Failed to add password to history", { error: err instanceof Error ? err.message : String(err) }));
    logAudit({ userId: creatorId, action: "password_change", entityType: "user", entityId: user.id, metadata: { method: "manual", targetUser: userData.name, targetLogin: userData.username } }).catch((err) => logger.error("auth", "Failed to log audit for manual password", { error: err instanceof Error ? err.message : String(err) }));
  }

  if (qualificationIds && qualificationIds.length > 0) {
    await db.insert(userQualifications).values(
      qualificationIds.map((qualificationId) => ({ userId: user.id, qualificationId }))
    );
  }

  await logAudit({
    userId: creatorId,
    action: "create",
    entityType: "user",
    entityId: user.id,
    newValues: pickAuditFields(user as unknown as Record<string, unknown>, "user"),
  });

  return user;
}

export async function updateUser(id: string, data: UpdateUser & { qualificationIds?: string[] }, modifierId?: string) {
  assertNotDemoAccount(id);
  const { password, qualificationIds, generateRandomPassword, forcePasswordChange, forceTwoFactor, ...userData } = data;

  if (userData.username !== undefined || userData.email !== undefined) {
    await checkUniqueness(userData.username ?? "", userData.email, id);
  }

  // Include forcePasswordChange and forceTwoFactor in userData if provided
  const updateValues: Record<string, unknown> = { ...userData };
  if (forcePasswordChange !== undefined) {
    updateValues.forcePasswordChange = forcePasswordChange;
  }
  if (forceTwoFactor !== undefined) {
    updateValues.forceTwoFactor = forceTwoFactor;
  }

  // When admin re-enables notifications, reset user preference to true
  // (user can disable later in /profile if desired)
  if (userData.notifications === true) {
    updateValues.notificationsUser = true;
  }
  if (userData.pushNotifications === true) {
    updateValues.pushNotificationsUser = true;
  }
  if ((userData as any).smsNotifications === true) {
    updateValues.smsNotificationsUser = true;
  }

  // Generate random password and send by email
  if (generateRandomPassword) {
    const currentUser = await db.query.users.findFirst({ where: eq(users.id, id), columns: { email: true, name: true, username: true, locale: true } });
    if (currentUser?.email) {
      const config = await getConfigValues([...PWD_CONFIG_KEYS]);
      const clearPwd = generatePasswordFromConfig(config);
      const hashed = await hashPassword(clearPwd);
      const existing = await db.query.accounts.findFirst({
        where: drizzleAnd(eq(accounts.userId, id), eq(accounts.providerId, "credential")),
        columns: { id: true },
      });
      if (existing) {
        await db.update(accounts).set({ password: hashed }).where(eq(accounts.id, existing.id));
      } else {
        await db.insert(accounts).values({
          id: crypto.randomUUID(),
          userId: id,
          accountId: id,
          providerId: "credential",
          password: hashed,
        });
      }
      addPasswordToHistory(id, hashed).catch((err) => logger.error("auth", "Failed to add password to history", { error: err instanceof Error ? err.message : String(err) }));
      logAudit({ userId: modifierId, action: "password_change", entityType: "user", entityId: id, metadata: { method: "random_password", targetUser: currentUser.name, targetLogin: currentUser.username } }).catch((err) => logger.error("auth", "Failed to log audit for random password", { error: err instanceof Error ? err.message : String(err) }));
      updateValues.forcePasswordChange = true;
      // Send email — await to prevent race condition on rapid clicks
      const appConfig = await getConfigValues(["APP_TITLE", "APP_BASE_URL"]);
      const template = randomPasswordTemplate(
        currentUser.name,
        currentUser.username ?? "",
        clearPwd,
        appConfig.APP_TITLE ?? "HumblePlanning",
        appConfig.APP_BASE_URL || "http://localhost:3000",
        await resolveRecipientLocale(currentUser.locale)
      );
      await sendEmail({ to: currentUser.email, ...template });
    }
  } else if (password) {
    // Update or create credential password if provided
    await validatePassword(password);
    // Check blacklist
    const blacklisted = await isPasswordBlacklisted(password);
    if (blacklisted) throw passwordRejectedError("users.errors.passwordBlacklisted");
    // Check password history
    const reused = await isPasswordReused(id, password);
    if (reused) throw passwordRejectedError("users.errors.passwordReused", { status: 409 });
    const hashed = await hashPassword(password);
    const existing = await db.query.accounts.findFirst({
      where: drizzleAnd(eq(accounts.userId, id), eq(accounts.providerId, "credential")),
      columns: { id: true },
    });
    if (existing) {
      await db.update(accounts).set({ password: hashed }).where(eq(accounts.id, existing.id));
    } else {
      await db.insert(accounts).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hashed,
      });
    }
    addPasswordToHistory(id, hashed).catch((err) => logger.error("auth", "Failed to add password to history", { error: err instanceof Error ? err.message : String(err) }));
    const targetUser = await db.query.users.findFirst({ where: eq(users.id, id), columns: { name: true, username: true } });
    logAudit({ userId: modifierId, action: "password_change", entityType: "user", entityId: id, metadata: { method: "manual", targetUser: targetUser?.name, targetLogin: targetUser?.username } }).catch((err) => logger.error("auth", "Failed to log audit for manual password update", { error: err instanceof Error ? err.message : String(err) }));
  }

  // Invalidate all sessions if password was changed or force password change is set
  if (generateRandomPassword || forcePasswordChange === true) {
    await invalidateUserSessions(id);
  }

  const oldUser = await db.query.users.findFirst({ where: eq(users.id, id) });

  // Invalidate sessions if user is being deactivated
  if (userData.active === false && oldUser?.active === true) {
    await invalidateUserSessions(id);
  }

  const [user] = await db.update(users).set(updateValues).where(eq(users.id, id)).returning();

  // Invalidate the permissions cache if one of its fields changed.
  // loadUserPermissions caches: roleId, teamId, businessUnitId, isAdmin, permissions[].
  if (
    userData.roleId !== undefined ||
    userData.teamId !== undefined ||
    userData.businessUnitId !== undefined ||
    userData.active !== undefined
  ) {
    invalidatePermissionsCache(id);
    // Real-time sync: the affected user refreshes their UI without F5.
    const { emitPermissionsChanged } = await import("@/lib/socket-events");
    emitPermissionsChanged([id]);
  }

  if (qualificationIds !== undefined) {
    await db.delete(userQualifications).where(eq(userQualifications.userId, id));
    if (qualificationIds.length > 0) {
      await db.insert(userQualifications).values(
        qualificationIds.map((qualificationId) => ({ userId: id, qualificationId }))
      );
    }
  }

  if (user && oldUser) {
    const changes = computeChanges(
      oldUser as unknown as Record<string, unknown>,
      userData as Record<string, unknown>,
      "user"
    );
    if (changes) {
      await logAudit({
        userId: modifierId,
        action: "update",
        entityType: "user",
        entityId: id,
        oldValues: changes.old,
        newValues: changes.new,
        changeCount: changes.count,
      });
    }
  }

  return user;
}

export async function archiveUser(id: string, active: boolean, modifierId?: string) {
  assertNotDemoAccount(id);
  const oldUser = await db.query.users.findFirst({
    where: eq(users.id, id),
    with: { role: { columns: { isAdmin: true } } },
  });

  // Protect Super Admin accounts from deactivation
  if (!active && (oldUser as any)?.role?.isAdmin) {
    throw new AppError("users.errors.cannotDeactivateSuperAdmin");
  }

  const [user] = await db.update(users).set({ active }).where(eq(users.id, id)).returning();

  // The active status affects the effective permissions and the visible scope
  // (a deactivated user must no longer appear in scoped lists).
  invalidatePermissionsCache(id);
  // Real-time sync for the user's other tabs/sessions (the final archiving
  // also triggers `emitSessionRevoked`, which redirects to /login).
  const { emitPermissionsChanged } = await import("@/lib/socket-events");
  emitPermissionsChanged([id]);

  if (user && oldUser) {
    await logAudit({
      userId: modifierId,
      action: "update",
      entityType: "user",
      entityId: id,
      oldValues: { active: oldUser.active },
      newValues: { active },
      changeCount: 1,
    });
  }

  // Invalidate sessions when deactivating
  if (!active) {
    await invalidateUserSessions(id);
  }

  return user;
}

export async function deleteUser(id: string, deleterId?: string) {
  assertNotDemoAccount(id);
  const oldUser = await db.query.users.findFirst({
    where: eq(users.id, id),
    with: { role: { columns: { isAdmin: true } } },
  });
  if (!oldUser) return null;

  // Protect Super Admin accounts from deletion
  if ((oldUser as any).role?.isAdmin) {
    throw new AppError("users.errors.cannotDeleteSuperAdmin");
  }

  // Check if user owns projects (FK is NOT NULL, cannot cascade)
  const ownedProjects = await db.query.projects.findMany({
    where: eq(projects.ownerId, id),
    columns: { id: true, name: true },
  });
  if (ownedProjects.length > 0) {
    const names = ownedProjects.map((p) => p.name).join(", ");
    throw new AppError("users.errors.ownsProjects", { params: { count: ownedProjects.length, names } });
  }

  // Notify connected clients BEFORE deleting (sessions will be cascade-deleted)
  try {
    const { emitSessionRevoked } = await import("@/lib/socket-events");
    emitSessionRevoked(id);
  } catch { /* socket server may not be running */ }

  // Audit before hard delete (data will be lost)
  await logAudit({
    userId: deleterId,
    action: "delete",
    entityType: "user",
    entityId: id,
    oldValues: pickAuditFields(oldUser as unknown as Record<string, unknown>, "user", true),
  });

  // Find tasks where this user is the only assignee → delete them
  const userTaskIds = await db
    .select({ taskId: taskUsers.taskId })
    .from(taskUsers)
    .where(eq(taskUsers.userId, id));

  if (userTaskIds.length > 0) {
    const taskIdsToCheck = userTaskIds.map((t) => t.taskId);
    // Count assignees per task — keep only those where this user is the sole assignee
    const orphanTasks = await db
      .select({ taskId: taskUsers.taskId, count: sql<number>`count(*)::int` })
      .from(taskUsers)
      .where(sql`${taskUsers.taskId} IN (${sql.join(taskIdsToCheck.map((id) => sql`${id}`), sql`, `)})`)
      .groupBy(taskUsers.taskId)
      .having(sql`count(*) = 1`);

    if (orphanTasks.length > 0) {
      const orphanIds = orphanTasks.map((t) => t.taskId);
      // Nullify creator/modifier refs on orphan tasks before deleting them
      for (const taskId of orphanIds) {
        await db.delete(tasks).where(eq(tasks.id, taskId));
      }
    }
  }

  // Nullify non-cascade FK references on remaining tasks
  await db.update(tasks).set({ creatorId: null }).where(eq(tasks.creatorId, id));
  await db.update(tasks).set({ lastModifierId: null }).where(eq(tasks.lastModifierId, id));

  // Hard delete — cascades to sessions, accounts, password_history, task_users, etc.
  await db.delete(users).where(eq(users.id, id));

  return oldUser;
}

export async function getPlanningUsers() {
  return db.query.users.findMany({
    where: (users, { and, eq }) => and(eq(users.active, true), eq(users.visibleOnPlanning, true)),
    with: { team: true },
    orderBy: (users, { asc }) => [asc(users.name)],
  });
}

export async function reorderTeamUsers(teamId: string, userIds: string[]) {
  const updates = userIds.map((userId, index) =>
    db.update(users)
      .set({ sortOrder: index })
      .where(drizzleAnd(eq(users.id, userId), eq(users.teamId, teamId)))
  );
  await Promise.all(updates);
}
