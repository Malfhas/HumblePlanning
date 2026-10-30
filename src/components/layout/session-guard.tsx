"use client";

import { useEffect } from "react";
import { useSocket } from "@/hooks/use-socket";
import { useProfile } from "@/hooks/use-profile";

/** Mounts the socket listener globally and enforces forcePasswordChange redirect */
export function SessionGuard() {
  useSocket();

  const { data: profile } = useProfile();

  useEffect(() => {
    if (profile?.forcePasswordChange) {
      window.location.href = "/change-password";
    }
  }, [profile?.forcePasswordChange]);

  return null;
}
