import { requireAuth, apiSuccess } from "@/lib/utils/api";
import { assertAiChatAvailable } from "@/lib/ai-chat/availability";
import { getModelCatalog } from "@/lib/ai-chat/chat-service";
import { effectiveDefaultModel } from "@/lib/ai-chat/config";
import { handleChatError } from "@/lib/ai-chat/http";
import { getQuotaState } from "@/lib/ai-chat/quota-service";
import { buildChatTools } from "@/lib/ai-chat/tools";

export const dynamic = "force-dynamic";

/** Chat state for the current user: level, models, quota (as a percentage only). */
export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { perms, canWrite, config } = await assertAiChatAvailable(userId);
    const catalog = await getModelCatalog();
    const listedModels = config.models.filter((model) => catalog[model]);
    const { writeDescriptions } = buildChatTools({ userId, perms, canWrite });
    return apiSuccess({
      enabled: true,
      level: canWrite ? "READ_WRITE" : "READ",
      configured: true,
      // How much of their monthly quota the user has used: a percentage, never an amount
      quota: await getQuotaState(userId, { settings: config.quota }),
      widget: { visible: config.widgetEnabled, closable: config.widgetClosable },
      defaultModel: effectiveDefaultModel(config),
      models: config.models,
      // Commercial names of the enabled models only: "DeepSeek V4 Flash"
      modelLabels: Object.fromEntries(listedModels.map((model) => [model, catalog[model]!.name])),
      // What each model can receive: decides what happens to a PDF, warns for an image
      modelCapabilities: Object.fromEntries(
        listedModels.map((model) => [model, { file: catalog[model]!.file, image: catalog[model]!.image }]),
      ),
      reasoning: config.reasoning,
      // Used to phrase the confirmation request in plain words, on screen
      toolDescriptions: writeDescriptions,
      // Whisper dictation: when disabled, the mic button is not rendered and no model is downloaded
      dictation: config.dictationEnabled,
    });
  } catch (error) {
    return handleChatError(error);
  }
}
