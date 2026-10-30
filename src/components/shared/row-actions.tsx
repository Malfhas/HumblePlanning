"use client";

import * as React from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface RowAction {
  /** Text label (shown in the menu on mobile, as a tooltip on desktop) */
  label: string;
  /** Icon (rendered as a ReactNode) */
  icon: React.ReactNode;
  /** Click callback */
  onClick: () => void;
  /**
   * If false, the action is disabled. Shows the "tooltipDisallowed" tooltip.
   * Default true.
   */
  allowed?: boolean;
  /** Tooltip shown when `allowed=false` (missing permission…). */
  tooltipDisallowed?: string;
  /** Destructive (red) variant for Delete / other risky actions. */
  destructive?: boolean;
  /** Separator BEFORE this item (only applies in mobile/dropdown mode). */
  separatorBefore?: boolean;
}

/**
 * Responsive "actions" cell for list tables.
 *
 * - **Desktop (≥ sm)**: row of icon buttons with tooltips — unchanged UX.
 * - **Mobile (< sm)**: a single "⋮" button that opens a DropdownMenu with
 *   all the actions as rows (icon + label). Saves
 *   ~5×32 px of width in the cell, so the other table columns
 *   are easier to read.
 *
 * Disabled actions (missing permission) are rendered
 * `disabled`/`muted` but keep an explanatory tooltip if provided.
 */
export function RowActions({ actions }: { actions: RowAction[] }) {
  const visible = actions.filter(Boolean);

  return (
    <div className="flex items-center justify-end">
      {/* Desktop: row of icon buttons */}
      <div className="hidden sm:flex items-center gap-1">
        {visible.map((a, i) => {
          const button = (
            <Button
              variant="ghost"
              size="sm"
              onClick={a.onClick}
              disabled={a.allowed === false}
              className={cn(
                a.destructive && "text-destructive hover:text-destructive",
                a.allowed === false && "opacity-40",
              )}
            >
              {a.icon}
            </Button>
          );
          // If disabled, wrap in a span so the tooltip still
          // triggers (a disabled button does not fire
          // mouse events in every browser).
          const trigger =
            a.allowed === false ? (
              <span tabIndex={0} className="inline-flex">
                {button}
              </span>
            ) : (
              button
            );
          const tip =
            a.allowed === false ? (a.tooltipDisallowed ?? a.label) : a.label;
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent>{tip}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Mobile: a single three-dot button that opens a dropdown menu */}
      <div className="flex sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {visible.map((a, i) => (
              <React.Fragment key={i}>
                {a.separatorBefore && i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onClick={a.onClick}
                  disabled={a.allowed === false}
                  variant={a.destructive ? "destructive" : "default"}
                  // Icon passed as a direct child (not inside a
                  // <span>) so that the Tailwind rule of the
                  // destructive DropdownMenuItem `*:[svg]:text-destructive!`
                  // matches the icon and colors it red.
                >
                  {a.icon}
                  <span>{a.label}</span>
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
