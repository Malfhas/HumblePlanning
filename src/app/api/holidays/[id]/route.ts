import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError, assertUuid } from "@/lib/utils/api";
import { getHolidayById, updateHoliday, deleteHoliday } from "@/lib/services/holiday-service";
import { z } from "zod";

const updateHolidaySchema = z.object({
  date: z.string().date(),
  label: z.string().max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
}).partial();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:holidays");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const holiday = await getHolidayById(id);
    if (!holiday) return apiError("admin.holidays.errors.notFound");
    return apiSuccess(holiday);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "holidays:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const data = await validateBody(request, updateHolidaySchema);
    const holiday = await updateHoliday(id, data);
    if (!holiday) return apiError("admin.holidays.errors.notFound");
    return apiSuccess(holiday);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "holidays:edit");
    const { id } = await params;
    const uuidErr = assertUuid(id); if (uuidErr) return uuidErr;
    const holiday = await deleteHoliday(id);
    if (!holiday) return apiError("admin.holidays.errors.notFound");
    return apiSuccess(holiday);
  } catch (error) {
    return handleApiError(error);
  }
}
