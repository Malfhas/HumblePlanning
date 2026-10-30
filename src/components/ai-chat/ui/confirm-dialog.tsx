"use client";

import type { ReactNode } from 'react';
import { useTranslations } from "next-intl";
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';

/** Confirmation of a sensitive action (deletion, irreversible switch…). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = 'danger',
  loading,
  disabled,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  loading?: boolean;
  /** Confirmation impossible as things stand: the text explains why. */
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("common.actions");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        footer={
          <>
            {/* Phone: the two buttons share the row, easy to hit */}
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              className="max-md:flex-1"
            >
              {t("cancel")}
            </Button>
            <Button
              variant={variant}
              loading={loading}
              disabled={disabled}
              onClick={onConfirm}
              className="max-md:flex-1"
            >
              {confirmLabel ?? t("confirm")}
            </Button>
          </>
        }
      >
        <div className="text-ai-sm text-ai-secondary">{description}</div>
      </DialogContent>
    </Dialog>
  );
}
