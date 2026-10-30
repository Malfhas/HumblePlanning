import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getAllFiles } from "@/lib/services/file-service";
import { fileFiltersSchema } from "@/lib/validators/file";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:files");

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const filters = fileFiltersSchema.parse(params);
    const result = await getAllFiles(filters);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
