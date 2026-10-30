import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getStatuses, createStatus } from "@/lib/services/status-service";
import { z } from "zod";

const createStatusSchema = z.object({
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
});

export async function GET() {
  try {
    await requireAuth();
    // Auth-only: statuses are reference data used by planning, task form, filters.
    const statuses = await getStatuses();
    return apiSuccess(statuses);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "statuses:edit");
    const data = await validateBody(request, createStatusSchema);
    const status = await createStatus(data);
    return apiSuccess(status, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
