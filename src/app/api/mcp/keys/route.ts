import { requireAuth, requirePermission, apiSuccess, handleApiError } from "@/lib/utils/api";
import { db } from "@/db";
import { mcpTokens, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { activeMcpTokenCondition } from "@/lib/services/mcp-service";

export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "pages:settings");

    const keys = await db
      .select({
        id: mcpTokens.id,
        name: mcpTokens.clientName,
        clientId: mcpTokens.clientId,
        userId: mcpTokens.userId,
        userName: users.name,
        userFirstName: users.firstName,
        userLogin: users.username,
        lastUsedAt: mcpTokens.lastUsedAt,
        createdAt: mcpTokens.createdAt,
      })
      .from(mcpTokens)
      .leftJoin(users, eq(mcpTokens.userId, users.id))
      .where(activeMcpTokenCondition())
      .orderBy(desc(mcpTokens.createdAt));

    return apiSuccess(keys);
  } catch (error) {
    return handleApiError(error);
  }
}
