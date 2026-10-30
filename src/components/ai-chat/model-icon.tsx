"use client";

import { Bot } from 'lucide-react';
import { cn } from "@/lib/utils";
import { modelLogo } from "./models";

/**
 * The provider logo of a model, or a neutral icon when it is
 * unknown. The files are served by us (`public/modeles/`,
 * see the license next to them): nothing is loaded from a third-party site. Monochrome
 * logos are drawn in black; in dark theme, they are inverted.
 */
export function ModelIcon({ model, className }: { model: string; className?: string }) {
  const logo = modelLogo(model);
  if (!logo) return <Bot aria-hidden className={cn('size-4 shrink-0 text-ai-muted', className)} />;
  return (
    <img
      src={logo.src}
      alt=""
      aria-hidden
      className={cn('size-4 shrink-0', logo.mono && 'dark:invert', className)}
    />
  );
}
