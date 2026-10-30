import { requireAuth, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { loadUserPermissions, hasPermission } from "@/lib/services/permission-service";
import { createMcpKey, listMcpKeys } from "@/lib/services/mcp-service";
import { getConfigValue } from "@/lib/services/config-service";
import { z } from "zod";

const createKeySchema = z.object({ name: z.string().min(1).max(255) });

export async function GET() {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "mcp:use")) throw new AppError("errors.forbidden");

    const mcpEnabled = await getConfigValue("MCP_ENABLED");
    if (mcpEnabled !== "true") return apiSuccess([]);

    const keys = await listMcpKeys(session.user.id);
    return apiSuccess(keys);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const perms = await loadUserPermissions(session.user.id);
    if (!hasPermission(perms, "mcp:use")) throw new AppError("errors.forbidden");

    const mcpEnabled = await getConfigValue("MCP_ENABLED");
    if (mcpEnabled !== "true") throw new AppError("mcp.errors.disabled");

    const body = await request.json();
    const data = createKeySchema.parse(body);
    const result = await createMcpKey(data.name, session.user.id);

    return apiSuccess({
      id: result.key.id,
      name: result.key.clientName,
      keyPrefix: result.key.accessToken,
      fullKey: result.fullKey,
      createdAt: result.key.createdAt,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
