import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getQualificationById, updateQualification, deleteQualification } from "@/lib/services/qualification-service";
import { z } from "zod";

const updateQualificationSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().max(10),
  color: z.string().max(7),
  description: z.string().optional().nullable(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:qualifications");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const qualification = await getQualificationById(id);
    if (!qualification) return apiError("users.errors.qualificationNotFound", 404);
    return apiSuccess(qualification);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "qualifications:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateQualificationSchema);
    const qualification = await updateQualification(id, data);
    if (!qualification) return apiError("users.errors.qualificationNotFound", 404);
    return apiSuccess(qualification);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "qualifications:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const qualification = await deleteQualification(id);
    if (!qualification) return apiError("users.errors.qualificationNotFound", 404);
    return apiSuccess(qualification);
  } catch (error) {
    return handleApiError(error);
  }
}
