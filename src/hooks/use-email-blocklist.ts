"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { throwIfNotOk } from "@/lib/api-client";

interface BlocklistEntry {
  id: string;
  email: string;
  reason: string;
  reasonDetail: string | null;
  source: string;
  blockedAt: string;
  blockedBy: string | null;
  userId: string | null;
  userLogin: string | null;
  userName: string | null;
}

export function useEmailBlocklist() {
  return useQuery({
    queryKey: ["email-blocklist"],
    queryFn: async () => {
      const res = await fetch("/api/email-blocklist");
      await throwIfNotOk(res);
      const json = await res.json();
      return (json as BlocklistEntry[]) ?? [];
    },
  });
}

export function useUnblockEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/email-blocklist/${id}`, { method: "DELETE" });
      await throwIfNotOk(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-blocklist"] });
      qc.invalidateQueries({ queryKey: ["email-blocklist-check"] });
    },
  });
}

export function useIsEmailBlocked(email: string) {
  return useQuery({
    queryKey: ["email-blocklist-check", email],
    queryFn: async () => {
      if (!email) return { blocked: false, active: false };
      const res = await fetch(`/api/email-blocklist/check?email=${encodeURIComponent(email)}`);
      if (!res.ok) return { blocked: false, active: false };
      const json = await res.json();
      return json as { blocked: boolean; active: boolean };
    },
    enabled: !!email && email.length >= 3,
    staleTime: 30_000,
  });
}
