import { NextRequest } from "next/server";
import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { getProjects, createProject } from "@/lib/services/project-service";
import { createProjectSchema } from "@/lib/validators/project";
import {
  loadUserPermissions,
  getVisibleProjectIds,
  hasPermission,
  getProjectReadScope,
  isProjectInReadScope,
  isBusinessUnitInScope,
} from "@/lib/services/permission-service";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);

    // Accept pages:projects OR pages:planning OR pages:home
    if (!hasPermission(perms, "pages:projects") && !hasPermission(perms, "pages:planning") && !hasPermission(perms, "pages:home")) {
      return apiError("errors.forbidden");
    }

    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    // Bypass projectScope when the caller has pages:projects (/projects
    // management) or any stats page (filter bars need the full project list).
    // The list then stays within the business-unit scope (scope:bu_*).
    const unscoped =
      request.nextUrl.searchParams.get("unscoped") === "true" &&
      (hasPermission(perms, "pages:projects") ||
        hasPermission(perms, "pages:stats_users") ||
        hasPermission(perms, "pages:stats_projects") ||
        hasPermission(perms, "pages:stats_roi"));
    let projects = await getProjects(search, includeArchived);

    if (unscoped) {
      const readScope = await getProjectReadScope(perms, true);
      projects = projects.filter((p) => isProjectInReadScope(p, readScope));
    } else {
      const visibleIds = await getVisibleProjectIds(perms);
      if (visibleIds) {
        const visibleSet = new Set(visibleIds);
        projects = projects.filter((p: { id: string }) => visibleSet.has(p.id));
      }
    }

    return apiSuccess(projects);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "projects:create");
    const data = await validateBody(request, createProjectSchema);
    if (!isBusinessUnitInScope(perms, data.businessUnitId)) {
      return apiError("errors.forbidden");
    }
    const project = await createProject(data, session.user.id);
    return apiSuccess(project, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
