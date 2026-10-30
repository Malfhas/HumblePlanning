"use client";

import { useQuery } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";

interface WebhookLog {
  id: string;
  provider: string;
  eventType: string;
  eventId: string | null;
  recipient: string | null;
  messageId: string | null;
  status: string;
  errorMessage: string | null;
  receivedAt: string;
}

interface WebhookStatus {
  secretConfigured: boolean;
  lastReceivedAt: string | null;
  events24h: number;
  errors24h: number;
  webhookUrl: string | null;
}

export function useWebhookLogs(provider: string = "nuntly", page: number = 1) {
  return useQuery({
    queryKey: ["webhook-logs", provider, page],
    queryFn: async () => {
      const res = await fetch(`/api/webhook-logs?provider=${provider}&page=${page}&limit=20`);
      await throwIfNotOk(res);
      const json = await res.json();
      return json as { data: WebhookLog[]; total: number; page: number; limit: number };
    },
    refetchInterval: 30_000,
  });
}

export function useWebhookStatus() {
  return useQuery({
    queryKey: ["webhook-status"],
    queryFn: async () => {
      const res = await fetch("/api/webhook-status");
      await throwIfNotOk(res);
      const json = await res.json();
      return json as WebhookStatus;
    },
    refetchInterval: 30_000,
  });
}
