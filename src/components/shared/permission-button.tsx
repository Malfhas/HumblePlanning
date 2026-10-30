"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type NativeButtonProps = Omit<React.ComponentProps<typeof Button>, "disabled" | "onClick">;

interface PermissionButtonProps extends NativeButtonProps {
  allowed: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  tooltipAllowed?: React.ReactNode;
  tooltipDenied?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Renders a Button wrapped in a Tooltip that works even when the button is disabled
 * (browsers block pointer events on disabled elements — a <span tabIndex={0}> wrapper
 * lets Radix Tooltip capture the hover).
 *
 * Usage:
 *   <PermissionButton
 *     allowed={can("projects:edit")}
 *     tooltipAllowed="Edit"
 *     onClick={() => openEdit(id)}
 *     variant="ghost"
 *     size="sm"
 *   >
 *     <Pencil className="h-4 w-4" />
 *   </PermissionButton>
 */
export function PermissionButton({
  allowed,
  onClick,
  tooltipAllowed,
  tooltipDenied,
  children,
  ...buttonProps
}: PermissionButtonProps) {
  const t = useTranslations("ui.permission");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {allowed ? (
          <Button {...buttonProps} onClick={onClick}>
            {children}
          </Button>
        ) : (
          <span tabIndex={0}>
            <Button {...buttonProps} disabled>
              {children}
            </Button>
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{allowed ? tooltipAllowed : (tooltipDenied ?? t("denied"))}</TooltipContent>
    </Tooltip>
  );
}
