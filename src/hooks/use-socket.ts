"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { socket, SOCKET_ENABLED } from "@/lib/socket-client";

/**
 * Number of mounted components using the shared socket. The socket only
 * disconnects when the last one unmounts: without this counter, leaving the schedule
 * (which also calls `useSocket`) cut real-time updates for the whole application
 * until reload (session guard, notifications, AI chat).
 */
let consumers = 0;

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!SOCKET_ENABLED) return;

    function onConnect() {
      setConnected(true);
      // Refetch all data after reconnection (server may have restarted)
      queryClient.invalidateQueries();
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onSessionRevoked() {
      // Cancel all pending queries to prevent a "network error" flash
      queryClient.cancelQueries();
      queryClient.clear();
      // Disconnect socket before redirecting
      socket.disconnect();
      // Immediate redirect to login
      window.location.href = "/login";
    }
    function onPermissionsChanged() {
      // The server has already purged its permissions cache; on the client,
      // invalidate the queries exposing perms / role / scope to force an immediate
      // refetch. The UI switches to the new rights without F5.
      queryClient.invalidateQueries({ queryKey: ["auth-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      // AI chat: the sphere and the menu entry follow the rights without F5
      queryClient.invalidateQueries({ queryKey: ["ai-chat-availability"] });
    }
    function onAiChatAvailability() {
      // AI chat settings changed by an administrator
      queryClient.invalidateQueries({ queryKey: ["ai-chat-availability"] });
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("session:revoked", onSessionRevoked);
    socket.on("permissions:changed", onPermissionsChanged);
    socket.on("ai-chat:availability", onAiChatAvailability);
    consumers += 1;

    if (!socket.connected) {
      socket.connect();
    } else {
      setConnected(true);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("session:revoked", onSessionRevoked);
      socket.off("permissions:changed", onPermissionsChanged);
      socket.off("ai-chat:availability", onAiChatAvailability);
      consumers -= 1;
      // Only disconnect if actually connected — avoids "WebSocket closed before
      // connection is established" warnings when React strict mode double-invokes
      // the effect (mount → unmount → mount) before the handshake completes.
      // Explicit disconnect on logout is handled in onSessionRevoked.
      // The last consumer only: other mounted components still need the socket.
      if (consumers === 0 && socket.connected) {
        socket.disconnect();
      }
    };
  }, [queryClient]);

  return { connected, enabled: SOCKET_ENABLED };
}
