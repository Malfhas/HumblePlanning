import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { bulkCreateHolidays } from "@/lib/services/holiday-service";
import { z } from "zod";

const importSchema = z.object({
  holidays: z.array(z.object({
    date: z.string().date(),
    label: z.string().max(100),
  })).min(1).max(50),
  country: z.string().max(10).optional(),
  year: z.coerce.number().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "holidays:edit");
    const data = await validateBody(request, importSchema);
    const result = await bulkCreateHolidays(data.holidays, { country: data.country, year: data.year });
    return apiSuccess(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
