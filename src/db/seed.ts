import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { statuses, users, accounts, appConfig, roles, rolePermissions } from "./schema";
import { hashPassword } from "../lib/password";

const db = drizzle(process.env.DATABASE_URL!);

// ─── Roles (well-known IDs) ──────────────────────────────────────────────────

const SYSTEM_ROLES = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Administrateur",
    description: "Accès complet par défaut. Rôle insuppressible mais entièrement éditable : nom, description et permissions peuvent être ajustés selon les besoins de l'organisation.",
    isSystem: true,
    // is_admin = false: Administrateur has an explicit, editable permission
    // list instead of the isAdmin bypass. This lets admins narrow its scope
    // without having to create a custom role.
    isAdmin: false,
    color: "#ef4444",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Manager",
    description: "Gestion des projets, tâches et utilisateurs",
    isSystem: true,
    isAdmin: false,
    color: "#3b82f6",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Membre+",
    description: "Accès standard : voir et modifier ses propres tâches",
    isSystem: true,
    isAdmin: false,
    color: "#10b981",
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    name: "Membre",
    description: "Accès en lecture seule",
    isSystem: true,
    isAdmin: false,
    color: "#6b7280",
  },
  {
    id: "00000000-0000-0000-0000-000000000005",
    name: "Super Administrateur",
    description: "Accès complet à toutes les fonctionnalités. Rôle système insuppressible, recréé automatiquement après un import ou une migration.",
    isSystem: true,
    isAdmin: true,
    color: "#7c3aed",
  },
];

// ════════════════════════════════════════════════════════════════════════
// Default permissions of the 4 explicit roles (Administrateur / Manager /
// Membre+ / Membre). The lists below are the single reference used
// in production (called by `provision.ts migrate` with SEED_NO_ADMIN=1).
// Super Administrateur (0005) uses the isAdmin bypass, no explicit permission.
// ════════════════════════════════════════════════════════════════════════

// Administrateur: full access by default, explicit permissions (no
// isAdmin bypass) so a Super Admin can restrict this role.
const ADMIN_PERMISSIONS = [
  "audit:purge", "audit:restore",
  "business_units:create", "business_units:delete", "business_units:edit",
  "export:use",
  "files:delete", "files:purge", "files:upload", "files:view",
  "groups:edit",
  "holidays:edit",
  "labor_types:edit",
  "ai_chat:use", "ai_chat:write",
  "mcp:use", "mcp:write",
  "notifications:view",
  "pages:business_units", "pages:files", "pages:holidays", "pages:home",
  "pages:labor_types", "pages:places", "pages:planning", "pages:projects",
  "pages:qualifications", "pages:resource_types", "pages:resources",
  "pages:roles", "pages:stats_projects", "pages:stats_roi", "pages:stats_users",
  "pages:tasks", "pages:teams", "pages:users",
  "pages:vehicle_types", "pages:vehicles",
  "places:edit",
  "planning:view_calendar", "planning:view_resources", "planning:view_team_day",
  "planning:view_vehicles",
  "projects:archive", "projects:create", "projects:delete", "projects:edit",
  "qualifications:edit",
  "resource_types:edit",
  "resources:create", "resources:delete", "resources:edit",
  "roles:create",
  "scope:bu_all", "scope:modify_all", "scope:projects_all", "scope:users_all",
  "statuses:edit",
  "tasks:assign", "tasks:create", "tasks:delete", "tasks:lock", "tasks:move", "tasks:resize",
  "teams:edit",
  "users:create", "users:delete", "users:edit",
  "vehicle_types:create", "vehicle_types:delete", "vehicle_types:edit",
  "vehicles:create", "vehicles:delete", "vehicles:edit",
];

// Manager: manages projects, tasks and users. Own business unit scope,
// can edit every task of the BU, sees all modules.
const MANAGER_PERMISSIONS = [
  "export:use",
  "files:delete", "files:upload", "files:view",
  "ai_chat:use",
  "groups:edit",
  "mcp:use",
  "notifications:view",
  "pages:home", "pages:planning", "pages:projects", "pages:qualifications",
  "pages:resource_types", "pages:resources", "pages:stats_projects",
  "pages:stats_roi", "pages:stats_users", "pages:tasks", "pages:teams",
  "pages:users", "pages:vehicle_types", "pages:vehicles",
  "planning:view_calendar", "planning:view_resources", "planning:view_team_day",
  "planning:view_vehicles",
  "projects:archive", "projects:create", "projects:delete", "projects:edit",
  "qualifications:edit",
  "resource_types:edit",
  "resources:create", "resources:delete", "resources:edit",
  "scope:bu_own", "scope:modify_all", "scope:projects_bu", "scope:users_bu",
  "statuses:edit",
  "tasks:assign", "tasks:create", "tasks:delete", "tasks:lock", "tasks:move", "tasks:resize",
  "teams:edit",
  "users:create", "users:delete", "users:edit",
  "vehicle_types:create", "vehicle_types:delete", "vehicle_types:edit",
  "vehicles:create", "vehicles:delete", "vehicles:edit",
];

// Membre+: standard user who can create and edit their own tasks.
const MEMBER_PLUS_PERMISSIONS = [
  "files:upload", "files:view",
  "notifications:view",
  "pages:home", "pages:planning",
  "planning:view_calendar", "planning:view_team_day",
  "scope:bu_own", "scope:modify_own", "scope:projects_bu", "scope:users_bu",
  "tasks:assign", "tasks:create", "tasks:delete", "tasks:move", "tasks:resize",
];

// Membre: read-only on their business unit.
const MEMBER_PERMISSIONS = [
  "files:view",
  "notifications:view",
  "pages:home", "pages:planning",
  "planning:view_calendar", "planning:view_team_day",
  "scope:bu_own", "scope:modify_readonly", "scope:projects_bu", "scope:users_bu",
];

async function seedRoles() {
  // Insert roles (idempotent: onConflictDoNothing on the id PK)
  for (const r of SYSTEM_ROLES) {
    await db.insert(roles).values(r).onConflictDoNothing();
  }
  console.log(`  ${SYSTEM_ROLES.length} system roles created`);

  // Insert permissions for Administrateur (explicit list) + Manager / Membre+ /
  // Membre. Super Administrateur (0005) relies on the isAdmin bypass.
  const permissionRows: { roleId: string; permission: string }[] = [
    ...ADMIN_PERMISSIONS.map((p) => ({ roleId: "00000000-0000-0000-0000-000000000001", permission: p })),
    ...MANAGER_PERMISSIONS.map((p) => ({ roleId: "00000000-0000-0000-0000-000000000002", permission: p })),
    ...MEMBER_PLUS_PERMISSIONS.map((p) => ({ roleId: "00000000-0000-0000-0000-000000000003", permission: p })),
    ...MEMBER_PERMISSIONS.map((p) => ({ roleId: "00000000-0000-0000-0000-000000000004", permission: p })),
  ];
  if (permissionRows.length > 0) {
    await db.insert(rolePermissions).values(permissionRows).onConflictDoNothing();
  }
  console.log(`  ${permissionRows.length} role permissions created`);
}

// ─── Main seed ──────────────────────────────────────────────────────────────

async function seed() {
  console.log("Seeding database...");

  // 1. System roles + permissions (before users, which reference role_id)
  await seedRoles();

  // 2. Default statuses
  const defaultStatuses = [
    { name: "A faire", color: "#3498db", percentage: 0, priority: 1, sortOrder: 1, isDefault: true, displayMode: "tp" },
    { name: "En cours", color: "#f39c12", percentage: 50, priority: 2, sortOrder: 2, isDefault: false, displayMode: "tp" },
    { name: "Termine", color: "#27ae60", percentage: 100, priority: 3, sortOrder: 3, isDefault: false, strikethrough: true, displayMode: "tp" },
    { name: "Annule", color: "#e74c3c", percentage: 0, priority: 4, sortOrder: 4, isDefault: false, strikethrough: true, italic: true, displayMode: "tp" },
    { name: "En attente", color: "#9b59b6", percentage: 25, priority: 5, sortOrder: 5, isDefault: false, displayMode: "tp" },
    { name: "Valide", color: "#2ecc71", percentage: 100, priority: 6, sortOrder: 6, isDefault: false, bold: true, displayMode: "tp" },
  ];

  await db.insert(statuses).values(defaultStatuses).onConflictDoNothing();
  console.log(`  ${defaultStatuses.length} statuses created`);

  // 3. Admin user (assigned to the Super Administrateur role to guarantee
  // admin access even after an import/migration that would wipe the Administrateur role).
  //
  // SEED_NO_ADMIN=1: called by `provision.ts migrate` in prod → we skip
  // creating the dev admin "admin/admin". The installer then creates the
  // administrator account chosen by the user (`provision.ts create-admin`).
  // provision.ts only runs this seed on a never-initialized database.
  if (process.env.SEED_NO_ADMIN === "1") {
    console.log("  (SEED_NO_ADMIN=1 — skipping the default dev admin creation)");
  } else {
  const existingAdmin = await db.select().from(users).where(eq(users.username, "admin")).limit(1);
  if (existingAdmin.length === 0) {
    const [admin] = await db.insert(users).values({
      name: "Administrateur",
      username: "admin",
      email: "admin@humbleplanning.local",
      emailVerified: true,
      roleId: "00000000-0000-0000-0000-000000000005", // Super Administrateur
      active: true,
      color: "#3498db",
    }).returning();

    const hashedPassword = await hashPassword("admin");
    await db.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: admin.id,
      accountId: admin.id,
      providerId: "credential",
      password: hashedPassword,
    });
    console.log("  Admin user created (login: admin@humbleplanning.local / admin)");
  } else {
    console.log("  Admin user already exists");
  }
  } // end of the SEED_NO_ADMIN else

  // 4. Default configuration
  const defaultConfig: { key: string; value: string; description: string }[] = [
    // Schedule display
    { key: "PLANNING_COL_WIDTH", value: "25", description: "Largeur colonne jour (px)" },
    { key: "PLANNING_COL_WIDTH_LARGE", value: "130", description: "Largeur colonne jour en mode large (px)" },
    { key: "PLANNING_MIN_CELL_WIDTH", value: "55", description: "Largeur minimale cellule au zoom compact (px)" },
    { key: "PLANNING_LINE_HEIGHT", value: "24", description: "Hauteur ligne planning (px)" },
    { key: "PLANNING_CELL_FONTSIZE", value: "11", description: "Taille police cellules (px)" },
    { key: "PLANNING_REPEAT_HEADER", value: "0", description: "Repeter en-tete tous les X lignes (0=desactive)" },
    { key: "PLANNING_DAYS_OF_WEEK_DISPLAY", value: JSON.stringify({
      1: { inclus: true, affiche: true, grise: false },
      2: { inclus: true, affiche: true, grise: false },
      3: { inclus: true, affiche: true, grise: false },
      4: { inclus: true, affiche: true, grise: false },
      5: { inclus: true, affiche: true, grise: false },
      6: { inclus: false, affiche: true, grise: true },
      7: { inclus: false, affiche: true, grise: true },
    }), description: "Config jours de la semaine (1=lundi, 7=dimanche)" },
    { key: "PLANNING_HIDE_WEEKEND_TASK", value: "false", description: "Masquer taches du weekend" },
    { key: "PLANNING_MASQUER_FERIES", value: "false", description: "Masquer jours feries" },
    { key: "PLANNING_ONE_ASSIGNMENT_MAX_PER_DAY", value: "false", description: "Max 1 tache par cellule/jour" },
    { key: "DEFAULT_NB_MONTHS_DISPLAYED", value: "2", description: "Nombre de mois affiches par defaut" },
    { key: "DEFAULT_NB_ROWS_DISPLAYED", value: "100", description: "Nombre de lignes affichees par defaut" },
    { key: "PLANNING_AFFICHAGE_STATUS", value: "tp", description: "Mode affichage statuts" },

    // Working hours
    { key: "AM_START", value: "08:00", description: "Debut matin" },
    { key: "AM_END", value: "12:00", description: "Fin matin" },
    { key: "PM_START", value: "14:00", description: "Debut apres-midi" },
    { key: "PM_END", value: "17:00", description: "Fin apres-midi" },
    { key: "DURATION_DAY", value: "07:30", description: "Duree journee complete" },
    { key: "HOURS_DISPLAYED", value: "8,9,10,11,14,15,16,17", description: "Heures affichees en vue horaire" },

    // Application
    { key: "APP_TITLE", value: "HumblePlanning", description: "Titre de l'application" },
    { key: "TIMEZONE", value: "auto", description: "Fuseau horaire (auto = navigateur)" },
    { key: "APP_LOCALE", value: "auto", description: "Langue par défaut (auto = langue du navigateur, fr, en)" },
    { key: "MODULE_PLACES", value: "true", description: "Activer module lieux" },
    { key: "MODULE_RESOURCES", value: "true", description: "Activer module ressources" },
    { key: "MODULE_VEHICLES", value: "true", description: "Activer module vehicules" },

    // Email
    { key: "EMAIL_PROVIDER", value: "smtp", description: "Fournisseur email (smtp/mailgun)" },
    { key: "SMTP_HOST", value: "", description: "Serveur SMTP" },
    { key: "SMTP_PORT", value: "587", description: "Port SMTP" },
    { key: "SMTP_FROM", value: "noreply@humbleplanning.local", description: "Email expediteur" },
    { key: "SMTP_LOGIN", value: "", description: "Login SMTP" },
    { key: "SMTP_PASSWORD", value: "", description: "Mot de passe SMTP" },
    { key: "SMTP_SECURE", value: "tls", description: "Securite SMTP (tls/ssl/none)" },
    { key: "MAILGUN_API_KEY", value: "", description: "Cle API Mailgun" },
    { key: "MAILGUN_DOMAIN", value: "", description: "Domaine Mailgun" },
    { key: "MAILGUN_REGION", value: "eu", description: "Region Mailgun (eu/us)" },
    { key: "APP_BASE_URL", value: "http://localhost:3000", description: "URL de base de l'application" },
    { key: "NOTIFICATION_EMAIL_COCHE", value: "false", description: "Notifications email activees" },
    { key: "EMAIL_SEND_DELAY", value: "60", description: "Delai avant envoi email (secondes, 0 = immediat)" },

    // Audit
    { key: "MODULE_AUDIT", value: "true", description: "Activer module audit" },
    { key: "AUDIT_TASKS", value: "true", description: "Auditer les taches" },
    { key: "AUDIT_PROJECTS", value: "true", description: "Auditer les projets" },
    { key: "AUDIT_USERS", value: "true", description: "Auditer les utilisateurs" },
    { key: "AUDIT_LOGINS", value: "true", description: "Auditer les connexions" },
    { key: "AUDIT_RETENTION", value: "30", description: "Retention audit (jours)" },

    // Security: password policy
    { key: "PWD_MIN_LENGTH", value: "8", description: "Longueur minimale mot de passe" },
    { key: "PWD_MAX_LENGTH", value: "128", description: "Longueur maximale mot de passe" },
    { key: "PWD_REQUIRE_UPPERCASE", value: "true", description: "Exiger une majuscule" },
    { key: "PWD_REQUIRE_LOWERCASE", value: "true", description: "Exiger une minuscule" },
    { key: "PWD_REQUIRE_DIGIT", value: "true", description: "Exiger un chiffre" },
    { key: "PWD_REQUIRE_SPECIAL", value: "false", description: "Exiger un caractere special" },
    { key: "PWD_GEN_LENGTH", value: "16", description: "Longueur par defaut des MDP generes" },
    { key: "PWD_GEN_INCLUDE_SPECIAL", value: "true", description: "Inclure caracteres speciaux dans generation" },
    { key: "WHITELIST_UPLOAD", value: "pdf,doc,docx,xls,xlsx,png,jpg,jpeg,gif,webp", description: "Extensions autorisees pour upload" },
    { key: "MAX_UPLOAD_SIZE_MB", value: "10", description: "Taille max par fichier (MB)" },
    { key: "MAX_FILES_PER_TASK", value: "5", description: "Nombre max de fichiers par tache" },

    // API
    { key: "API_ENABLED", value: "false", description: "Activer l acces API" },
    // API rate limiting
    { key: "API_RATE_LIMIT_MINUTE", value: "60", description: "Requetes API par minute" },
    { key: "API_RATE_LIMIT_HOUR", value: "1000", description: "Requetes API par heure" },
    { key: "API_RATE_LIMIT_EXPORT", value: "5", description: "Exports API par minute" },

    // Cache
    { key: "CACHE_ENABLED", value: "true", description: "Activer le cache serveur" },
    { key: "CACHE_TTL", value: "300", description: "Duree de vie du cache en secondes" },

    // Announcement
    { key: "ANNOUNCEMENT_ENABLED", value: "false", description: "Afficher une annonce" },
    { key: "ANNOUNCEMENT_CONTENT", value: "", description: "Contenu HTML de l'annonce" },
    { key: "ANNOUNCEMENT_EXPIRES_AT", value: "", description: "Date d'expiration de l'annonce" },

    // MCP / AI
    { key: "MCP_ENABLED", value: "false", description: "Activer serveur MCP" },
    { key: "MCP_TOKEN_EXPIRY", value: "3600", description: "Duree token MCP (sec)" },
    { key: "MCP_REFRESH_TOKEN_EXPIRY", value: "2592000", description: "Duree refresh token MCP (sec)" },
    { key: "MCP_MAX_TOKENS_PER_USER", value: "5", description: "Max connexions MCP par user" },

    // Backups
    { key: "BACKUP_ENABLED", value: "false", description: "Activer sauvegardes automatiques" },
    { key: "BACKUP_SCHEDULE", value: "daily", description: "Frequence sauvegardes (6h/12h/daily/weekly)" },
    { key: "BACKUP_TIME", value: "02:00", description: "Heure cible sauvegarde (HH:MM)" },
    { key: "BACKUP_RETENTION_DAYS", value: "30", description: "Retention sauvegardes (jours)" },
    { key: "BACKUP_MAX_COUNT", value: "10", description: "Nombre max sauvegardes conservees" },

    // Updates (Settings > Version): queries the GitHub Releases API at most once every 24 h
    { key: "UPDATE_CHECK_ENABLED", value: "true", description: "Vérifier les mises à jour disponibles" },

    // Default branding: paths are resolved by /api/branding/[...path]
    // with a fallback to public/branding-defaults/ if uploads/branding/ is empty.
    // The admin can upload their own assets via /settings to override them.
    { key: "APP_LOGO",               value: "branding/logo-light.svg",       description: "Logo par défaut (fallback)" },
    { key: "APP_LOGO_LIGHT",         value: "branding/logo-light.svg",       description: "Logo mode clair" },
    { key: "APP_LOGO_DARK",          value: "branding/logo-dark.svg",        description: "Logo mode sombre" },
    { key: "APP_FAVICON",            value: "branding/favicon-light.png",    description: "Favicon par défaut" },
    { key: "APP_FAVICON_LIGHT",      value: "branding/favicon-light.png",    description: "Favicon mode clair" },
    { key: "APP_FAVICON_DARK",       value: "branding/favicon-dark.png",     description: "Favicon mode sombre" },
    { key: "LOGIN_BACKGROUND",       value: "branding/login-bg.avif",        description: "Fond d'écran login par défaut" },
    { key: "LOGIN_BACKGROUND_LIGHT", value: "branding/login-bg-light.avif",  description: "Fond d'écran login mode clair" },
    { key: "LOGIN_BACKGROUND_DARK",  value: "branding/login-bg-dark.avif",   description: "Fond d'écran login mode sombre" },
  ];

  await db.insert(appConfig).values(defaultConfig).onConflictDoNothing();
  console.log(`  ${defaultConfig.length} config settings created`);

  console.log("Seed finished!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
