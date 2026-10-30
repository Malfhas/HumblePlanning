import { NextRequest } from "next/server";
import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getHolidays, createHoliday } from "@/lib/services/holiday-service";
import { z } from "zod";

const createHolidaySchema = z.object({
  date: z.string().date(),
  label: z.string().max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    // Auth-only: holidays are reference data used by the planning grid to mark days.
    const startDate = request.nextUrl.searchParams.get("startDate") ?? undefined;
    const endDate = request.nextUrl.searchParams.get("endDate") ?? undefined;
    const holidays = await getHolidays(startDate, endDate);
    return apiSuccess(holidays);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "holidays:edit");
    const data = await validateBody(request, createHolidaySchema);
    const holiday = await createHoliday(data);
    return apiSuccess(holiday, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
