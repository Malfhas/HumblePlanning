import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, ApiError, assertUuid } from "@/lib/utils/api";
import { getProjectById, updateProject, deleteProject } from "@/lib/services/project-service";
import { updateProjectSchema } from "@/lib/validators/project";
import { loadUserPermissions, hasPermission, canModifyProject } from "@/lib/services/permission-service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "pages:projects") && !hasPermission(perms, "pages:planning") && !hasPermission(perms, "pages:home")) {
      throw new ApiError("errors.forbidden");
    }
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const project = await getProjectById(id);
    if (!project) return apiError("projects.errors.notFound");
    return apiSuccess(project);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const perms = await loadUserPermissions(session.user.id);
    const existing = await getProjectById(id);
    if (!existing) return apiError("projects.errors.notFound");
    if (!canModifyProject(perms, { ownerId: existing.ownerId })) {
      return apiError("projects.errors.notAllowed");
    }
    const data = await validateBody(request, updateProjectSchema);
    const project = await updateProject(id, data, session.user.id);
    if (!project) return apiError("projects.errors.notFound");
    return apiSuccess(project);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "projects:delete");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const project = await deleteProject(id, session.user.id);
    if (!project) return apiError("projects.errors.notFound");
    return apiSuccess(project);
  } catch (error) {
    return handleApiError(error);
  }
}
