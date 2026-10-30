import { requireAuth, requirePermission, validateBody, apiSuccess, handleApiError, ApiError } from "@/lib/utils/api";
import { createApiKey, listApiKeys } from "@/lib/services/api-key-service";
import { logAudit } from "@/lib/services/audit-service";
import { z } from "zod";

const createKeySchema = z.object({
  name: z.string().min(1).max(255),
});

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:settings");
    const keys = await listApiKeys();
    return apiSuccess(keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      userId: k.userId,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const data = await validateBody(request, createKeySchema);
    const result = await createApiKey(data.name, session.user.id);
    logAudit({
      userId: session.user.id,
      action: "api_key_create",
      entityType: "api_key",
      entityId: result.key.id,
      metadata: { name: data.name },
    }).catch(() => {});
    return apiSuccess({
      id: result.key.id,
      name: result.key.name,
      keyPrefix: result.key.keyPrefix,
      fullKey: result.fullKey,
      createdAt: result.key.createdAt,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
