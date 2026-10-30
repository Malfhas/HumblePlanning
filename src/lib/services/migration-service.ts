import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import JSZip from "jszip";
import { parse } from "csv-parse/sync";
import postgres from "postgres";
import { hashPassword } from "@/lib/password";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { parseDatabaseUrl } from "@/lib/utils/database";

// ─── Constants ───────────────────────────────────────────────────────────────

const IMPORT_DIR = path.resolve(process.cwd(), "data/imports");
const MIGRATION_ZIP = "pending_migration.zip";
const MIGRATION_CACHE = "pending_migration.json";
// SoPlanning versions accepted by the analyzer. Processing (CSV parsing,
// entity mapping, email deduplication, etc.) is identical for all
// these versions: the export (www/process/backup.php) produces the same
// CSV files with the same columns from 1.55 to 1.57. The internal changes
// of 1.56 (indexes, decimal types, notif_* columns, AI_OLLAMA_*,
// language) and 1.57 (Compétences module, login/QR/mobile API tables,
// link_id varchar(50)) do not appear in the export. Only 1.57 change on
// the export side: config.csv excludes SMTP_LOGIN / SMTP_PASSWORD (not read here).
// Any patch version of a supported series is accepted (e.g. 1.57.01):
// the export format only changes with minor versions.
const SUPPORTED_VERSION_SERIES = ["1.55", "1.56", "1.57"] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Analysis warning: key `settings.panels.migration.warnings.<key>` + parameters, translated at render time. */
export interface MigrationWarning {
  key: "duplicateEmails" | "inactiveUsers" | "skillsNotExported" | "orphanTasks";
  params?: Record<string, string | number>;
}

/** `entity`: stable identifier, label `settings.panels.migration.entities.<entity>` translated at render time. */
export interface MigrationAnalysis {
  version: string;
  tables: { entity: string; count: number }[];
  totalRecords: number;
  valid: boolean;
  warnings: MigrationWarning[];
}

export interface MigrationResult {
  success: boolean;
  version: string;
  userPassword: string;
  adminLogin: string;
  adminPassword: string;
  /** Number of items imported per entity (identifiers from `settings.panels.migration.entities`). */
  imported: Record<string, number>;
  forceReload: boolean;
}

interface ParsedData {
  version: string;
  users: Record<string, string>[];
  userGroupes: Record<string, string>[];
  groupes: Record<string, string>[];
  projets: Record<string, string>[];
  periodes: Record<string, string>[];
  statuts: Record<string, string>[];
  feries: Record<string, string>[];
  config: Record<string, string>[];
}

// ─── Default statuses recreated after the migration ──────────────────────────
// 1:1 copy of the `statuses` table on the HumblePlanning prod side. All
// imported SoPlanning tasks will be attached to the "A faire" status (fixed id
// so it can be referenced directly).
const STATUS_ID_TODO       = "11111111-1111-1111-1111-111111111101";
const STATUS_ID_IN_PROGRESS = "11111111-1111-1111-1111-111111111102";
const STATUS_ID_DONE       = "11111111-1111-1111-1111-111111111103";
const STATUS_ID_CANCELLED  = "11111111-1111-1111-1111-111111111104";
const STATUS_ID_ARCHIVED   = "11111111-1111-1111-1111-111111111105";

const DEFAULT_STATUSES = [
  { id: STATUS_ID_TODO,        name: "A faire",        color: "#4dabf5", strikethrough: false, bold: false, italic: false, underline: false, isDefault: true, showInList: true, percentage: 0,   priority: 1, includeInCalculation: true, sortOrder: 0 },
  // i18n-ignore data (statuses created in the database, editable)
  { id: STATUS_ID_CANCELLED,   name: "Abandonné",      color: "#ff0f0f", strikethrough: false, bold: false, italic: true,  underline: false, isDefault: true, showInList: true, percentage: 0,   priority: 4, includeInCalculation: true, sortOrder: 1 },
  // i18n-ignore data (statuses created in the database, editable)
  { id: STATUS_ID_ARCHIVED,    name: "Archivé",        color: "#865ece", strikethrough: true,  bold: false, italic: true,  underline: false, isDefault: true, showInList: true, percentage: 100, priority: 5, includeInCalculation: true, sortOrder: 2 },
  // i18n-ignore data (statuses created in the database, editable)
  { id: STATUS_ID_DONE,        name: "Fait / terminé", color: "#1fcb27", strikethrough: true,  bold: false, italic: false, underline: false, isDefault: true, showInList: true, percentage: 100, priority: 3, includeInCalculation: true, sortOrder: 3 },
  { id: STATUS_ID_IN_PROGRESS, name: "En cours",       color: "#ffeb3b", strikethrough: false, bold: true,  italic: false, underline: true,  isDefault: true, showInList: true, percentage: 50,  priority: 2, includeInCalculation: true, sortOrder: 4 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureImportDir() {
  if (!fs.existsSync(IMPORT_DIR)) {
    fs.mkdirSync(IMPORT_DIR, { recursive: true });
  }
}

function parseCsv(content: string): Record<string, string>[] {
  return parse(content, {
    delimiter: ";",
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

function generatePassword(length = 16): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function normalizeColor(color: string | undefined): string | null {
  if (!color || color.trim() === "") return null;
  const c = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  return `#${c}`;
}

function parseDate(d: string | undefined): string | null {
  if (!d || d.trim() === "") return null;
  // Accept YYYY-MM-DD or DD/MM/YYYY
  const trimmed = d.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function parseTimestamp(d: string | undefined): string | null {
  if (!d || d.trim() === "") return null;
  return d.trim();
}

function parseSoPlanningBool(val: string | undefined): boolean {
  return val?.trim().toLowerCase() === "oui";
}

// ─── SoPlanning rights → Humble Planning system role ─────────────────────────

// System role IDs (see src/db/seed.ts).
const ROLE_ID_ADMINISTRATOR  = "00000000-0000-0000-0000-000000000001";
const ROLE_ID_MANAGER        = "00000000-0000-0000-0000-000000000002";
// Membre+ (003) is not used for the migration: imported users
// land in Administrateur, Manager or Membre (004) depending on their rights.
const ROLE_ID_MEMBER         = "00000000-0000-0000-0000-000000000004";
const ROLE_ID_SUPER_ADMIN    = "00000000-0000-0000-0000-000000000005";

/**
 * Maps a set of SoPlanning rights to one of the 3 target system roles
 * of the migration:
 *   - `parameters_all` (= access to system settings) → Administrateur
 *   - project management, users or full task editing → Manager
 *   - everything else → Membre
 *
 * The 4th system role (Membre+) and Super Administrateur are deliberately
 * excluded: Membre+ is reserved for standard users created after migration,
 * Super Administrateur is reserved for the humbleplanning service account.
 */
function classifyUserToSystemRole(rights: string[]): string {
  const has = (r: string) => rights.includes(r);

  if (has("parameters_all")) {
    return ROLE_ID_ADMINISTRATOR;
  }
  if (
    has("users_manage_all") ||
    has("projects_manage_all") ||
    has("tasks_modify_all")
  ) {
    return ROLE_ID_MANAGER;
  }
  return ROLE_ID_MEMBER;
}

function extractUserRights(user: Record<string, string>): string[] {
  try {
    const parsed = JSON.parse(user.droits || "[]");
    return (parsed as string[]).filter((r) => r && r !== "null" && r.trim() !== "");
  } catch {
    return [];
  }
}

// The HumblePlanning system roles (Administrateur / Manager / Membre+ /
// Membre / Super Administrateur) are managed exclusively by src/db/seed.ts
// (called on first deployment by `provision.ts migrate`). The SoPlanning
// migration relies on their presence in the database (cf. classifyUserToSystemRole)
// and never modifies them — they are neither truncated nor reinserted.

// ─── Duplicate email detection ───────────────────────────────────────────────

function findDuplicateEmails(users: Record<string, string>[]): Set<string> {
  const emailCount = new Map<string, number>();
  for (const u of users) {
    const email = u.email?.trim().toLowerCase();
    if (email) {
      emailCount.set(email, (emailCount.get(email) || 0) + 1);
    }
  }
  const duplicates = new Set<string>();
  for (const [email, count] of emailCount) {
    if (count > 1) duplicates.add(email);
  }
  return duplicates;
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

export async function analyzeMigration(zipBuffer: Buffer): Promise<MigrationAnalysis> {
  ensureImportDir();

  // Save ZIP
  const zipPath = path.join(IMPORT_DIR, MIGRATION_ZIP);
  fs.writeFileSync(zipPath, zipBuffer);

  // Extract
  const zip = await JSZip.loadAsync(zipBuffer);

  // Find files — handle both root-level and subfolder layouts
  function findFile(name: string): JSZip.JSZipObject | null {
    const direct = zip.file(name);
    if (direct) return direct;
    // Search inside subfolders (e.g. export/user.csv)
    const found = zip.file(new RegExp(`(^|/)${name}$`))[0];
    return found || null;
  }

  // Validate version
  const versionFile = findFile("version.info");
  if (!versionFile) {
    cleanup();
    throw new AppError("settings.errors.migrationVersionInfoMissing");
  }
  const versionContent = (await versionFile.async("string")).trim();
  const versionMatch = versionContent.match(/version;(.+)/);
  const detectedVersion = versionMatch?.[1]?.trim() || "?";

  const detectedSeries = /^(\d+\.\d+)\.\d+$/.exec(detectedVersion)?.[1];
  if (!detectedSeries || !SUPPORTED_VERSION_SERIES.includes(detectedSeries as typeof SUPPORTED_VERSION_SERIES[number])) {
    cleanup();
    throw new AppError("settings.errors.migrationUnsupportedVersion", {
      params: { version: detectedVersion, supported: SUPPORTED_VERSION_SERIES.map((s) => `${s}.xx`).join(", ") },
    });
  }

  // Parse CSV files — SoPlanning exports in ISO-8859-1 (Latin-1)
  const decoder = new TextDecoder("iso-8859-1");
  const readCsv = async (name: string): Promise<Record<string, string>[]> => {
    const f = findFile(name);
    if (!f) return [];
    const buf = await f.async("uint8array");
    const content = decoder.decode(buf);
    return parseCsv(content);
  };

  const data: ParsedData = {
    version: detectedVersion,
    users: await readCsv("user.csv"),
    userGroupes: await readCsv("user_groupe.csv"),
    groupes: await readCsv("groupe.csv"),
    projets: await readCsv("projet.csv"),
    periodes: await readCsv("periode.csv"),
    statuts: await readCsv("status.csv"),
    feries: await readCsv("feries.csv"),
    config: await readCsv("config.csv"),
  };

  // Cache parsed data for executeMigration
  const cachePath = path.join(IMPORT_DIR, MIGRATION_CACHE);
  fs.writeFileSync(cachePath, JSON.stringify(data));

  // Build analysis
  const warnings: MigrationWarning[] = [];

  // Detect duplicate emails
  const dupEmails = findDuplicateEmails(data.users);
  if (dupEmails.size > 0) {
    warnings.push({ key: "duplicateEmails", params: { count: dupEmails.size, emails: [...dupEmails].join(", ") } });
  }

  // Count inactive users
  const inactiveCount = data.users.filter((u) => !parseSoPlanningBool(u.login_actif)).length;
  if (inactiveCount > 0) {
    warnings.push({ key: "inactiveUsers", params: { count: inactiveCount } });
  }

  // SoPlanning 1.57 adds the Compétences module, but backup.php does not export
  // it (neither the skills table nor periode.competence_id).
  if (detectedVersion.localeCompare("1.57.00", "en", { numeric: true }) >= 0) {
    warnings.push({ key: "skillsNotExported" });
  }

  // Tasks without valid project (exact match first, case-insensitive fallback)
  const projectIdsExact = new Set(data.projets.map((p) => p.projet_id));
  const projectIdsLower = new Set(data.projets.map((p) => p.projet_id.toLowerCase()));
  const orphanTasks = data.periodes.filter((p) => {
    const pid = p.projet_id || "";
    return !projectIdsExact.has(pid) && !projectIdsLower.has(pid.toLowerCase());
  }).length;
  if (orphanTasks > 0) {
    warnings.push({ key: "orphanTasks", params: { count: orphanTasks } });
  }

  const tables = [
    { entity: "users", count: data.users.length },
    { entity: "teams", count: data.userGroupes.length },
    { entity: "defaultStatuses", count: DEFAULT_STATUSES.length },
    { entity: "projectGroups", count: data.groupes.length },
    { entity: "projects", count: data.projets.length },
    { entity: "tasks", count: data.periodes.length - orphanTasks },
    { entity: "statuses", count: data.statuts.length },
    { entity: "holidays", count: data.feries.length },
  ];

  const totalRecords = tables.reduce((sum, t) => sum + t.count, 0);

  logger.info("migration", `Analysis finished: ${totalRecords} records, ${warnings.length} warning(s)`);

  return {
    version: detectedVersion,
    tables,
    totalRecords,
    valid: true,
    warnings,
  };
}

// ─── Execute ─────────────────────────────────────────────────────────────────

export async function executeMigration(userId: string): Promise<MigrationResult> {
  const cachePath = path.join(IMPORT_DIR, MIGRATION_CACHE);
  if (!fs.existsSync(cachePath)) {
    throw new AppError("settings.errors.migrationNoPending");
  }

  const data: ParsedData = JSON.parse(fs.readFileSync(cachePath, "utf-8"));

  // Generate passwords
  const userPassword = generatePassword(14);
  const adminPassword = generatePassword(16);
  const hashedUserPwd = await hashPassword(userPassword);
  const hashedAdminPwd = await hashPassword(adminPassword);

  // Build ID maps
  const teamMap = new Map<string, string>(); // soGroupeId → uuid
  const projectGroupMap = new Map<string, string>(); // soGroupeId → uuid
  const statusMap = new Map<string, string>(); // soStatusId → uuid
  const userMap = new Map<string, string>(); // soUserId → uuid
  const projectMap = new Map<string, string>(); // soProjetId → uuid
  const taskMap = new Map<string, string>(); // soPeriodeId → uuid

  // ── Transform teams ──
  const teams: { id: string; name: string; color: string }[] = [];
  for (const g of data.userGroupes) {
    const id = crypto.randomUUID();
    teamMap.set(g.user_groupe_id, id);
    teams.push({ id, name: g.nom, color: "#3b82f6" });
  }

  // HumblePlanning roles: kept in the database, no processing here.
  // SoPlanning users are classified into Administrateur / Manager / Membre
  // based on their rights (see classifyUserToSystemRole). The
  // humbleplanning account created at the end points to Super Administrateur.

  // ── Statuses ──
  // SoPlanning statuses are ignored and the 5 default HumblePlanning statuses
  // are recreated (identical to those of the prod seed). All imported tasks
  // get the "A faire" status (see STATUS_ID_TODO above).
  interface StatusRow {
    id: string; name: string; color: string | null;
    strikethrough: boolean; bold: boolean; italic: boolean; underline: boolean;
    isDefault: boolean; showInList: boolean; percentage: number;
    priority: number; includeInCalculation: boolean; sortOrder: number;
  }
  const statuses: StatusRow[] = DEFAULT_STATUSES.map((s) => ({ ...s, color: s.color }));
  const defaultStatusId = STATUS_ID_TODO;
  // statusMap stays empty — each task falls back to defaultStatusId.

  // ── Transform project groups ──
  const projectGroups: { id: string; name: string; color: string; sortOrder: number }[] = [];
  for (let i = 0; i < data.groupes.length; i++) {
    const g = data.groupes[i];
    const id = crypto.randomUUID();
    projectGroupMap.set(g.groupe_id, id);
    projectGroups.push({
      id,
      name: g.nom,
      color: "#6366f1",
      sortOrder: parseInt(g.ordre) || i,
    });
  }

  // ── Transform users ──
  const dupEmails = findDuplicateEmails(data.users);
  const usedUsernames = new Set<string>();
  const usedEmails = new Set<string>();

  interface UserRow {
    id: string; teamId: string | null; roleId: string | null; name: string;
    firstName: string | null; username: string; email: string | null; color: string;
    visibleOnPlanning: boolean; notifications: boolean; active: boolean;
    forcePasswordChange: boolean; preferences: string; sortOrder: number;
    createdAt: string; updatedAt: string;
  }
  interface AccountRow {
    id: string; userId: string; accountId: string; providerId: string; password: string;
  }

  const userRows: UserRow[] = [];
  const accountRows: AccountRow[] = [];

  // Load default user preferences from app config (same keys as createUser)
  // so that migrated users get the same defaults as newly created ones.
  const defaultPrefs: Record<string, string> = {};
  try {
    const { getConfigValues } = await import("./config-service");
    const cfg = await getConfigValues([
      "DEFAULT_HOME_PAGE", "DEFAULT_PLANNING_VIEW", "DEFAULT_COLUMN_VIEW", "DEFAULT_THEME",
    ]);
    if (cfg.DEFAULT_HOME_PAGE) defaultPrefs.defaultHomePage = cfg.DEFAULT_HOME_PAGE;
    if (cfg.DEFAULT_PLANNING_VIEW) defaultPrefs.defaultView = cfg.DEFAULT_PLANNING_VIEW;
    if (cfg.DEFAULT_COLUMN_VIEW) defaultPrefs.columnView = cfg.DEFAULT_COLUMN_VIEW;
    if (cfg.DEFAULT_THEME) defaultPrefs.theme = cfg.DEFAULT_THEME;
  } catch { /* fallback: no defaults */ }

  for (let i = 0; i < data.users.length; i++) {
    const u = data.users[i];
    const login = u.login?.trim();
    if (!login) continue; // skip users without login

    // Avoid duplicate logins
    if (usedUsernames.has(login.toLowerCase())) continue;
    usedUsernames.add(login.toLowerCase());

    const id = crypto.randomUUID();
    userMap.set(u.user_id, id);

    // Email handling
    let email: string | null = u.email?.trim() || null;
    if (email) {
      const emailLower = email.toLowerCase();
      if (dupEmails.has(emailLower) || usedEmails.has(emailLower)) {
        email = null;
      } else {
        usedEmails.add(emailLower);
      }
    }

    // Preferences mapping — start from app defaults, overlay SoPlanning prefs
    const prefs: Record<string, string> = { ...defaultPrefs };
    try {
      const parsed = JSON.parse(u.preferences || "{}");
      if (parsed.vueDefaut === "vueMois") prefs.columnView = "days";
      if (parsed.dateformat === "fr") prefs.dateFormat = "fr";
      if (parsed.dateformat === "us") prefs.dateFormat = "us";
      if (parsed.masquerLigneVide === "1") prefs.hideEmptyRows = "true";
    } catch { /* ignore */ }

    const roleId = classifyUserToSystemRole(extractUserRights(u));

    userRows.push({
      id,
      teamId: teamMap.get(u.user_groupe_id) || null,
      roleId,
      name: u.nom || login,
      firstName: null,
      username: login,
      email,
      color: normalizeColor(u.couleur) || "#FFFFFF",
      visibleOnPlanning: parseSoPlanningBool(u.visible_planning),
      notifications: parseSoPlanningBool(u.notifications),
      active: parseSoPlanningBool(u.login_actif),
      forcePasswordChange: true,
      preferences: JSON.stringify(prefs),
      sortOrder: i,
      createdAt: parseTimestamp(u.date_creation) || new Date().toISOString(),
      updatedAt: parseTimestamp(u.date_modif) || new Date().toISOString(),
    });

    accountRows.push({
      id: crypto.randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: hashedUserPwd,
    });
  }

  // ── Super admin account ──
  const adminUserId = crypto.randomUUID();
  usedUsernames.add("humbleplanning");
  userRows.push({
    id: adminUserId,
    teamId: null,
    roleId: ROLE_ID_SUPER_ADMIN,
    name: "Humble Planning",
    firstName: null,
    username: "humbleplanning",
    email: null,
    color: "#7c3aed",
    visibleOnPlanning: false,
    notifications: false,
    active: true,
    forcePasswordChange: true,
    preferences: "{}",
    sortOrder: -1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  accountRows.push({
    id: crypto.randomUUID(),
    userId: adminUserId,
    accountId: adminUserId,
    providerId: "credential",
    password: hashedAdminPwd,
  });

  // ── Transform projects ──
  interface ProjectRow {
    id: string; businessNumber: string | null; name: string; color: string;
    status: string; sortOrder: number; groupId: string | null; ownerId: string;
    deliveryDate: string | null; budgetAmount: string | null; budgetTime: string | null;
    createdAt: string; updatedAt: string;
  }
  const projectRows: ProjectRow[] = [];

  for (let i = 0; i < data.projets.length; i++) {
    const p = data.projets[i];
    const id = crypto.randomUUID();
    // Store both exact and lowercase for case-insensitive fallback
    projectMap.set(p.projet_id, id);
    if (!projectMap.has(p.projet_id.toLowerCase())) {
      projectMap.set(p.projet_id.toLowerCase(), id);
    }

    let status = "todo";
    if (p.statut === "progress") status = "active";
    else if (p.statut === "done") status = "done";
    else if (p.statut === "archive") status = "archived";

    projectRows.push({
      id,
      businessNumber: p.projet_id || null,
      name: p.nom || p.projet_id,
      color: normalizeColor(p.couleur) || "#FFFFFF",
      status,
      sortOrder: i,
      groupId: projectGroupMap.get(p.groupe_id) || null,
      ownerId: userMap.get(p.createur_id) || adminUserId,
      deliveryDate: parseDate(p.livraison),
      budgetAmount: p.budget_montant && p.budget_montant.trim() ? p.budget_montant.trim() : null,
      budgetTime: p.budget_temps && p.budget_temps.trim() ? p.budget_temps.trim() : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Transform tasks + task_users ──
  interface TaskRow {
    id: string; parentSpId: string; projectId: string; startDate: string;
    endDate: string | null; duration: string | null; durationDetails: string | null;
    title: string | null; notes: string | null; statusId: string;
    creatorId: string | null; lastModifierId: string | null;
    createdAt: string; updatedAt: string;
  }
  interface TaskUserRow { id: string; taskId: string; userId: string }

  const taskRows: TaskRow[] = [];
  const taskUserRows: TaskUserRow[] = [];
  let skippedTasks = 0;

  for (const p of data.periodes) {
    // Exact match first, case-insensitive fallback
    const pid = p.projet_id || "";
    const pProjectId = projectMap.get(pid) || projectMap.get(pid.toLowerCase());
    if (!pProjectId) {
      skippedTasks++;
      continue;
    }

    const id = crypto.randomUUID();
    taskMap.set(p.periode_id, id);

    taskRows.push({
      id,
      parentSpId: p.parent_id || "",
      projectId: pProjectId,
      startDate: p.date_debut,
      endDate: parseDate(p.date_fin),
      duration: p.duree && p.duree.trim() ? p.duree.trim() : null,
      durationDetails: p.duree_details && p.duree_details.trim() ? p.duree_details.trim() : null,
      title: p.titre || null,
      notes: p.notes || null,
      statusId: statusMap.get(p.statut_tache) || defaultStatusId,
      creatorId: userMap.get(p.createur_id) || null,
      lastModifierId: userMap.get(p.modifier_id) || null,
      createdAt: parseTimestamp(p.date_creation) || new Date().toISOString(),
      updatedAt: parseTimestamp(p.date_modif) || new Date().toISOString(),
    });

    // task_users junction
    const assignedUserId = userMap.get(p.user_id);
    if (assignedUserId) {
      taskUserRows.push({
        id: crypto.randomUUID(),
        taskId: id,
        userId: assignedUserId,
      });
    }
  }

  // ── Transform holidays ──
  const seenDates = new Set<string>();
  const holidayRows: { id: string; date: string; label: string | null; color: string | null }[] = [];
  for (const f of data.feries) {
    const d = parseDate(f.date_ferie);
    if (!d || seenDates.has(d)) continue;
    seenDates.add(d);
    holidayRows.push({
      id: crypto.randomUUID(),
      date: d,
      label: f.libelle || null,
      color: normalizeColor(f.couleur),
    });
  }

  // ── Execute SQL transaction ──
  const { host, port, user: dbUser, password: dbPassword, database } = parseDatabaseUrl();
  const connectionUrl = `postgres://${dbUser}:${encodeURIComponent(dbPassword)}@${host}:${port}/${database}`;
  const sql = postgres(connectionUrl, { max: 1 });

  try {
    await sql.begin(async (tx) => {
      logger.info("migration", "Starting transaction...");

      // TRUNCATE all business and auxiliary tables — we start from a
      // blank slate. HumblePlanning roles (system + permissions) are
      // KEPT: the migration relies on them to map SoPlanning rights
      // to Administrateur / Manager / Membre (see
      // classifyUserToSystemRole).
      // i18n-ignore SQL
      await tx.unsafe(`
        TRUNCATE
          task_users, tasks, projects, project_groups,
          account, session, verification, password_history,
          users, teams, statuses, holidays,
          business_units,
          labor_types,
          user_qualifications, qualifications,
          vehicles, vehicle_types,
          resources, resource_types,
          places,
          audit_logs, notifications, saved_filters,
          mcp_tokens, mcp_authorization_codes, mcp_clients
        CASCADE
      `);
      logger.info("migration", "Tables truncated (HumblePlanning roles preserved)");

      // 0. Business Unit "SoPlanning" (must be created FIRST since teams/project_groups
      //    now have a required businessUnitId FK. Users and projects are assigned below.)
      const buId = crypto.randomUUID();
      await tx.unsafe(
        `INSERT INTO business_units (id, name, number, color, address, latitude, longitude, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [buId, "SoPlanning", "SP", "#6b7280", "Migration SoPlanning", "0", "0"]
      );
      logger.info("migration", `Business Unit "SoPlanning" created (${buId})`);

      // 1. Teams
      for (const t of teams) {
        await tx.unsafe(
          `INSERT INTO teams (id, name, color, business_unit_id, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4::uuid, NOW(), NOW())`,
          [t.id, t.name, t.color, buId]
        );
      }
      logger.info("migration", `${teams.length} teams inserted`);

      // 2. Roles: KEPT (not truncated). The 5 HumblePlanning system roles
      //    and their permissions are intact. No insert to do here.

      // 3. Statuses
      for (const s of statuses) {
        await tx.unsafe(
          `INSERT INTO statuses (id, name, color, strikethrough, bold, italic, underline, is_default, show_in_list, percentage, priority, include_in_calculation, sort_order, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
          [s.id, s.name, s.color, s.strikethrough, s.bold, s.italic, s.underline, s.isDefault, s.showInList, s.percentage, s.priority, s.includeInCalculation, s.sortOrder]
        );
      }
      logger.info("migration", `${statuses.length} statuses inserted`);

      // 4. Project groups
      for (const g of projectGroups) {
        await tx.unsafe(
          `INSERT INTO project_groups (id, name, color, sort_order, business_unit_id, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4, $5::uuid, NOW(), NOW())`,
          [g.id, g.name, g.color, g.sortOrder, buId]
        );
      }
      logger.info("migration", `${projectGroups.length} project groups inserted`);

      // 5. Users
      for (const u of userRows) {
        await tx.unsafe(
          // i18n-ignore SQL
          `INSERT INTO users (id, team_id, role_id, name, first_name, login, email, color, visible_on_planning, notifications, active, force_password_change, preferences, sort_order, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15::timestamptz, $16::timestamptz)`,
          [u.id, u.teamId, u.roleId, u.name, u.firstName, u.username, u.email, u.color, u.visibleOnPlanning, u.notifications, u.active, u.forcePasswordChange, u.preferences, u.sortOrder, u.createdAt, u.updatedAt]
        );
      }
      logger.info("migration", `${userRows.length} users inserted`);

      // 6. Accounts
      for (const a of accountRows) {
        await tx.unsafe(
          `INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at) VALUES ($1, $2::uuid, $3, $4, $5, NOW(), NOW())`,
          [a.id, a.userId, a.accountId, a.providerId, a.password]
        );
      }
      logger.info("migration", `${accountRows.length} auth accounts inserted`);

      // 7. Projects
      for (const p of projectRows) {
        await tx.unsafe(
          // i18n-ignore SQL
          `INSERT INTO projects (id, business_number, name, color, status, sort_order, group_id, owner_id, delivery_date, budget_amount, budget_time, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11, $12::timestamptz, $13::timestamptz)`,
          [p.id, p.businessNumber, p.name, p.color, p.status, p.sortOrder, p.groupId, p.ownerId, p.deliveryDate, p.budgetAmount, p.budgetTime, p.createdAt, p.updatedAt]
        );
      }
      logger.info("migration", `${projectRows.length} projects inserted`);

      // 8. Tasks (first pass — no parentId)
      for (const t of taskRows) {
        await tx.unsafe(
          // i18n-ignore SQL
          `INSERT INTO tasks (id, project_id, start_date, end_date, duration, duration_details, title, notes, status_id, creator_id, last_modifier_id, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7, $8, $9::uuid, $10, $11, $12::timestamptz, $13::timestamptz)`,
          [t.id, t.projectId, t.startDate, t.endDate, t.duration, t.durationDetails, t.title, t.notes, t.statusId, t.creatorId, t.lastModifierId, t.createdAt, t.updatedAt]
        );
      }
      logger.info("migration", `${taskRows.length} tasks inserted`);

      // 9. Tasks second pass — update parentId
      let parentUpdates = 0;
      for (const t of taskRows) {
        if (t.parentSpId) {
          const parentUuid = taskMap.get(t.parentSpId);
          if (parentUuid) {
            await tx.unsafe(`UPDATE tasks SET parent_id = $1::uuid WHERE id = $2::uuid`, [parentUuid, t.id]);
            parentUpdates++;
          }
        }
      }
      if (parentUpdates > 0) {
        logger.info("migration", `${parentUpdates} parent-child links updated`);
      }

      // 10. Task users
      for (const tu of taskUserRows) {
        await tx.unsafe(
          `INSERT INTO task_users (id, task_id, user_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING`,
          [tu.id, tu.taskId, tu.userId]
        );
      }
      logger.info("migration", `${taskUserRows.length} task assignments inserted`);

      // 11. Holidays
      for (const h of holidayRows) {
        await tx.unsafe(
          // i18n-ignore SQL
          `INSERT INTO holidays (id, date, label, color, created_at) VALUES ($1::uuid, $2::date, $3, $4, NOW()) ON CONFLICT DO NOTHING`,
          [h.id, h.date, h.label, h.color]
        );
      }
      logger.info("migration", `${holidayRows.length} public holidays inserted`);

      // 12. Assign SoPlanning BU to all users and projects
      //     (BU was created at step 0 so teams/project_groups could reference it.)
      await tx.unsafe(`UPDATE users SET business_unit_id = $1::uuid`, [buId]);
      await tx.unsafe(`UPDATE projects SET business_unit_id = $1::uuid`, [buId]);
      logger.info("migration", `SoPlanning BU assigned to all users and projects`);
    });

    logger.info("migration", "Transaction completed successfully");
  } finally {
    await sql.end();
  }

  // The SoPlanning migration wipes and re-seeds the roles table from the
  // source dump, which will NOT contain the Super Administrateur role.
  // Restore it now so admin access is always available after a migration.
  try {
    const { ensureSuperAdminRole } = await import("./role-service");
    await ensureSuperAdminRole();
    logger.info("migration", "Super Administrateur role restored");
  } catch (err) {
    logger.error("migration", "Failed to restore the Super Administrateur role", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Delete all backup dump files (the backup_history table was truncated
  // but the physical files remain on disk)
  const backupDir = path.resolve(process.cwd(), "data/backups");
  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir);
    for (const file of files) {
      try { fs.unlinkSync(path.join(backupDir, file)); } catch { /* ignore */ }
    }
    logger.info("migration", `${files.length} backup file(s) deleted`);
  }

  // Delete all uploaded task files and avatars — the tasks/users tables have
  // been truncated so these files are now orphaned and must not leak data
  // from the previous installation.
  for (const subDir of ["tasks", "avatars"]) {
    const dir = path.resolve(process.cwd(), "uploads", subDir);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      logger.info("migration", `uploads/${subDir} purged`);
    }
  }

  // Cleanup temp files
  cleanup();

  const imported: Record<string, number> = {
    teams: teams.length,
    defaultStatuses: statuses.length,
    projectGroups: projectGroups.length,
    users: userRows.length,
    projects: projectRows.length,
    tasks: taskRows.length,
    taskUsers: taskUserRows.length,
    holidays: holidayRows.length,
  };

  logger.info("migration", `Migration finished: ${JSON.stringify(imported)}`);

  return {
    success: true,
    version: data.version,
    userPassword,
    adminLogin: "humbleplanning",
    adminPassword,
    imported,
    forceReload: true,
  };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function cleanup() {
  try {
    const zipPath = path.join(IMPORT_DIR, MIGRATION_ZIP);
    const cachePath = path.join(IMPORT_DIR, MIGRATION_CACHE);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
}

export function cleanupMigration(): void {
  cleanup();
  logger.info("migration", "Temporary files cleaned up");
}
