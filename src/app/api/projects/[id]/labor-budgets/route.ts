import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, assertUuid } from "@/lib/utils/api";
import { getProjectLaborBudgetsWithHours, upsertProjectLaborBudgets } from "@/lib/services/project-labor-budget-service";
import { assertProjectReadable } from "@/lib/services/permission-service";
import { z } from "zod";
import { uuidSchema } from "@/lib/validators/common";

const upsertSchema = z.object({
  budgets: z.array(z.object({
    laborTypeId: uuidSchema,
    plannedHours: z.string(),
  })),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "pages:projects");
    const { id } = await params;
    assertUuid(id);
    await assertProjectReadable(perms, id);
    const budgets = await getProjectLaborBudgetsWithHours(id);
    return apiSuccess(budgets);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const perms = await requirePermission(session.user.id, "projects:edit");
    const { id } = await params;
    assertUuid(id);
    await assertProjectReadable(perms, id);
    const data = await validateBody(request, upsertSchema);
    const budgets = await upsertProjectLaborBudgets(id, data.budgets);
    return apiSuccess(budgets);
  } catch (error) {
    return handleApiError(error);
  }
}
