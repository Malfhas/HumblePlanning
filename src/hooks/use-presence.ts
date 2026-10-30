"use client";

import { useEffect, useState, useRef } from "react";
import { socket, SOCKET_ENABLED } from "@/lib/socket-client";

export type PresenceUser = {
  userId: string;
  name: string;
  color: string;
  image: string | null;
  lastActivity: number;
};

const HEARTBEAT_INTERVAL = 30_000; // 30s
const INACTIVITY_THRESHOLD = 5 * 60 * 1000; // 5 min

// Module-level state so presence persists across view changes
let _presenceUsers: PresenceUser[] = [];
const _listeners = new Set<(users: PresenceUser[]) => void>();

function _setPresence(users: PresenceUser[]) {
  _presenceUsers = users;
  _listeners.forEach((fn) => fn(users));
}

export function usePresence() {
  const [users, setUsers] = useState<PresenceUser[]>(_presenceUsers);
  const lastMouseMove = useRef(Date.now());

  // Track mouse activity without re-renders
  useEffect(() => {
    const handleMouseMove = () => {
      lastMouseMove.current = Date.now();
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("keydown", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleMouseMove);
    };
  }, []);

  useEffect(() => {
    if (!SOCKET_ENABLED) return;

    // Subscribe to module-level updates
    _listeners.add(setUsers);

    const handlePresenceUpdate = (list: PresenceUser[]) => {
      _setPresence(list);
    };

    const handleConnect = () => {
      // Request current presence list once connected
      socket.emit("presence:request");
    };

    socket.on("presence:update", handlePresenceUpdate);
    socket.on("connect", handleConnect);

    // If already connected, request immediately
    if (socket.connected) {
      socket.emit("presence:request");
    }

    // Heartbeat: send only if active in last 5 min
    const interval = setInterval(() => {
      if (Date.now() - lastMouseMove.current < INACTIVITY_THRESHOLD) {
        socket.emit("presence:heartbeat");
      }
    }, HEARTBEAT_INTERVAL);

    // Presence rebound when the tab comes back to the foreground.
    //
    // Why: when the tab stays in the background for more than 5 min, the
    // browser stops reporting mousemove/keydown → no more heartbeat
    // sent → the server cleans the `presenceMap` entry → the avatar
    // disappears from the other users' UI. When the tab comes back, the
    // next natural heartbeat is not enough because (a) it can take up
    // to 30s, and (b) the server ignores orphan heartbeats
    // (entry already removed).
    //
    // Solution: on `visibilitychange → visible`, reset the activity
    // and IMMEDIATELY force a heartbeat + a request. On the server,
    // `presence:heartbeat` is patched to re-inject the entry if it
    // was cleaned up (see server.ts), so the avatar reappears instantly.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // Activity refresh (otherwise the setInterval INACTIVITY_THRESHOLD
      // condition would keep blocking for 5 min after coming back).
      lastMouseMove.current = Date.now();
      if (!socket.connected) {
        // Force a reconnection if the socket dropped during the absence.
        // The `connect` handler will emit `presence:request` in turn.
        socket.connect();
        return;
      }
      socket.emit("presence:heartbeat");
      socket.emit("presence:request");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      _listeners.delete(setUsers);
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("connect", handleConnect);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return users;
}
