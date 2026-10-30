"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { socket, SOCKET_ENABLED } from "@/lib/socket-client";
import { throwIfNotOk } from "@/lib/api-client";

interface Notification {
  id: string;
  userId: string;
  type: string;
  /** Text frozen at creation (recipient's language): fallback for `titleKey` / `messageKey`. */
  title: string;
  message: string;
  /** `notifications.*` keys + raw parameters: translated at display time (useNotificationText). */
  titleKey?: string | null;
  messageKey?: string | null;
  params?: Record<string, string | number> | null;
  actionUrl?: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  data: Notification[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}

async function fetchNotifications(page = 1, limit = 20): Promise<NotificationsResponse> {
  const res = await fetch(`/api/notifications?page=${page}&limit=${limit}`);
  await throwIfNotOk(res);
  return res.json();
}

export function useNotifications(page = 1) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications", page],
    queryFn: () => fetchNotifications(page),
    refetchInterval: 120_000,
  });

  // Listen for real-time push notifications via Socket.io
  useEffect(() => {
    if (!SOCKET_ENABLED) return;

    function onNewNotification() {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }

    socket.on("notification:new", onNewNotification);
    return () => {
      socket.off("notification:new", onNewNotification);
    };
  }, [queryClient]);

  return query;
}

export function useUnreadCount() {
  const { data } = useNotifications(1);
  return data?.unreadCount ?? 0;
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}`, { method: "PATCH" });
      await throwIfNotOk(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/read-all", { method: "PATCH" });
      await throwIfNotOk(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
      await throwIfNotOk(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useDeleteAllNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/delete-all", { method: "DELETE" });
      await throwIfNotOk(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
