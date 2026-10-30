"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useConfig } from "@/hooks/use-config";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";

export function DynamicFavicon() {
  const { data: config } = useConfig();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const faviconPath = resolveThemedAsset(config, "APP_FAVICON", resolvedTheme);
    if (!faviconPath) return;

    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = `/api/${faviconPath.startsWith("branding/") ? "" : "files/"}${faviconPath}?v=${Date.now()}`;
  }, [config, resolvedTheme]);

  return null;
}
