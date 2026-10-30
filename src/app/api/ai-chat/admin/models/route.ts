import { requireAuth, requirePermission, apiSuccess, handleApiError, AppError } from "@/lib/utils/api";
import { openRouterBaseUrl } from "@/lib/ai-chat/chat-service";

export const dynamic = "force-dynamic";

/**
 * OpenRouter catalog for the admin ("Load from OpenRouter"),
 * relayed by the server: the `connect-src` CSP forbids the call from the browser.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");
    const response = await fetch(`${openRouterBaseUrl()}/models`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!response?.ok) throw new AppError("aiChat.errors.modelListUnavailable", { status: 502 });
    const rawCatalog = (await response.json()) as { data: { id: string; name: string }[] };
    return apiSuccess({
      models: rawCatalog.data
        .map((model) => {
          // "DeepSeek: DeepSeek V4 Flash": the provider is already in the identifier
          const separator = model.name.indexOf(": ");
          return { id: model.id, name: separator > 0 ? model.name.slice(separator + 2) : model.name };
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
