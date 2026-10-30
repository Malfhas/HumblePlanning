import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getQualifications, createQualification } from "@/lib/services/qualification-service";
import { z } from "zod";

const createQualificationSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().max(10).optional(),
  color: z.string().max(7).optional(),
  description: z.string().optional().nullable(),
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: qualifications are reference data used by planning filters, user form.
    const qualifications = await getQualifications();
    return apiSuccess(qualifications);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "qualifications:edit");
    const data = await validateBody(request, createQualificationSchema);
    const qualification = await createQualification(data);
    return apiSuccess(qualification, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
