"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface AiChatAvailabilityView {
  available: boolean;
  canWrite: boolean;
  widget: { visible: boolean; closable: boolean };
}

/**
 * Is the AI chat available to the signed-in user? Used by the sidebar and
 * the sphere: when unavailable, nothing is rendered. Refreshed when the tab
 * regains focus, on a permissions change (`permissions:changed`) and on a
 * settings change (`ai-chat:availability`, see `use-socket.ts`).
 */
export function useAiChatAvailability() {
  return useQuery({
    queryKey: ["ai-chat-availability"],
    queryFn: () => apiFetch<AiChatAvailabilityView>("/api/ai-chat/availability"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
