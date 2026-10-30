/**
 * The tools a page deserves.
 *
 * Declaring every tool on each floating-sphere turn costs prefill and
 * blurs the model's choice. When we know which page the user is viewing, we
 * only give the base set and the page's family. Without a known page
 * (full-screen Assistant page, page not in the list), everything is
 * open.
 */

/** Always there: get oriented, search. */
const BASE_TOOLS = [
  "whoami",
  "get-app-info",
  "list-projects",
  "get-project",
  "list-statuses",
  "list-users",
  "get-user",
  "list-tasks",
  "get-task",
  "search-tasks",
];

const FAMILIES: Record<string, string[]> = {
  planning: [
    "create-task",
    "update-task",
    "delete-task",
    "move-task",
    "copy-task",
    "get-user-schedule",
    "get-user-availability",
    "list-teams",
    "get-team",
    "get-team-availability",
    "list-holidays",
    "list-places",
    "check-vehicle-conflicts",
    "check-resource-conflicts",
  ],
  projects: [
    "create-project",
    "update-project",
    "get-project-hours",
    "get-project-status",
    "list-business-units",
    "list-labor-types",
  ],
  team: [
    "list-teams",
    "get-team",
    "get-team-availability",
    "get-user-availability",
    "get-user-schedule",
    "list-qualifications",
    "list-business-units",
  ],
  logistics: [
    "list-vehicles",
    "get-vehicle-assignments",
    "check-vehicle-conflicts",
    "list-vehicle-types",
    "list-resources",
    "get-resource-assignments",
    "check-resource-conflicts",
    "list-resource-types",
  ],
  stats: ["stats-users", "stats-projects", "stats-roi", "get-project-hours", "get-project-status"],
};

/** Families open per page (identifier returned by `pageFromPath`). */
const PAGES: Record<string, string[]> = {
  planning: ["planning"],
  home: ["planning", "projects"],
  projects: ["projects"],
  team: ["team"],
  logistics: ["logistics"],
  stats: ["stats"],
};

/** All tools listed here: a test checks that they exist in `mcp-tools.ts`. */
export function listedTools(): Set<string> {
  return new Set([...BASE_TOOLS, ...Object.values(FAMILIES).flat()]);
}

/**
 * The tool filter for a page; `null` or an unknown page: everything passes.
 * The base set is always there.
 */
export function toolsForPage(page: string | null | undefined): (name: string) => boolean {
  const families = page ? PAGES[page] : undefined;
  if (!families) return () => true;
  const kept = new Set(BASE_TOOLS);
  for (const family of families) for (const name of FAMILIES[family] ?? []) kept.add(name);
  return (name) => kept.has(name);
}

/**
 * The page being viewed, from the path (client side): `/planning` and `/tasks`
 * → planning; `/home` → planning and projects; `/projects` → projects;
 * `/users`, `/teams`, `/qualifications` → team; vehicles and resources →
 * logistics; `/stats/*` → statistics. Elsewhere: null, everything is open.
 */
export function pageFromPath(path: string): string | null {
  const segment = path.split("/").filter(Boolean)[0] ?? "";
  switch (segment) {
    case "planning":
    case "tasks":
      return "planning";
    case "home":
      return "home";
    case "projects":
    case "groups":
    case "statuses":
      return "projects";
    case "users":
    case "teams":
    case "qualifications":
      return "team";
    case "vehicles":
    case "vehicle-types":
    case "resources":
    case "resource-types":
      return "logistics";
    case "stats":
      return "stats";
    default:
      return null;
  }
}
