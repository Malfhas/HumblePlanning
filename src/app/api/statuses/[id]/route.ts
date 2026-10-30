import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getStatusById, updateStatus, deleteStatus } from "@/lib/services/status-service";
import { z } from "zod";

const updateStatusSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  displayMode: z.string().max(5).optional(),
  strikethrough: z.boolean().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  showInList: z.boolean().optional(),
  percentage: z.number().int().min(0).max(100).optional(),
  priority: z.number().int().optional(),
  includeInCalculation: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:projects");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const status = await getStatusById(id);
    if (!status) return apiError("projects.errors.statusNotFound", 404);
    return apiSuccess(status);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "statuses:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateStatusSchema);
    const status = await updateStatus(id, data);
    if (!status) return apiError("projects.errors.statusNotFound", 404);
    return apiSuccess(status);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "statuses:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const status = await deleteStatus(id);
    if (!status) return apiError("projects.errors.statusNotFound", 404);
    return apiSuccess(status);
  } catch (error) {
    return handleApiError(error);
  }
}
