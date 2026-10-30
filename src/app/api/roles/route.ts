import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError } from "@/lib/utils/api";
import { getRoles, createRole } from "@/lib/services/role-service";
import { createRoleSchema } from "@/lib/validators/role";

export async function GET() {
  try {
    // Auth-only: allows user-form dropdown to list available roles.
    // Page gate is enforced on the /roles admin page client-side.
    await requireAuth();
    const data = await getRoles();
    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "roles:create");
    const data = await validateBody(request, createRoleSchema);
    const role = await createRole(data);
    return apiSuccess(role, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
