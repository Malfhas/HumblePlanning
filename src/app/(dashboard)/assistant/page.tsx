import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/utils/api";
import { getAiChatAvailability } from "@/lib/ai-chat/availability";
import { ChatView } from "@/components/ai-chat/chat-view";

export const dynamic = "force-dynamic";

/**
 * AI Assistant page (full-page chat). Server-side guard: chat turned off,
 * not configured, without a model or without the `ai_chat:use` permission, the page
 * does not exist for the user, who is redirected to their home page.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; project?: string; projet?: string }>;
}) {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  const availability = await getAiChatAvailability(session.user.id);
  // "/" resolves the user's default page
  if (!availability.available) redirect("/");
  const { conversation, project, projet } = await searchParams;
  // `?projet=` is the former name of `?project=`: still accepted so existing links keep working
  const projectId = project ?? projet;
  return (
    <div data-ai-chat className="ai-chat-root -m-3 h-[calc(100dvh-3.5rem)] bg-ai-surface md:-m-6">
      <ChatView projectId={projectId} initialConversation={conversation} />
    </div>
  );
}
