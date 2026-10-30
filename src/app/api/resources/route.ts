import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getResources, createResource } from "@/lib/services/resource-service";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  resourceTypeId: z.string().uuid().optional().nullable(),
  businessUnitId: z.string().uuid("Business Unit requise"),
  serialNumber: z.string().max(50).optional().nullable(),
  color: z.string().max(7).optional(),
  status: z.enum(["available", "maintenance", "out_of_service"]).optional(),
  comment: z.string().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    await requireAuth();
    // Auth-only: resources are reference data used by planning/forms.
    const url = new URL(request.url);
    const includeOutOfService = url.searchParams.get("includeOutOfService") !== "false";
    const resources = await getResources(includeOutOfService);
    return apiSuccess(resources);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "resources:create");
    const data = await validateBody(request, createSchema);
    const resource = await createResource(data);
    return apiSuccess(resource, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
