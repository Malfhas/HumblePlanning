"use client";

import { useState, type KeyboardEvent } from 'react';
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * In-place rename: the title becomes a field, where it is shown, with no
 * window. Enter confirms; Escape or a click elsewhere cancels (an unchanged
 * or empty title is not sent either). The text is selected right away:
 * the title is retyped more often than corrected.
 */
export function EditableTitle({
  value,
  onConfirm,
  onCancel,
  className,
}: {
  value: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const t = useTranslations("aiChat.conversations");
  const [title, setTitle] = useState(value);
  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === value) onCancel();
    else onConfirm(trimmed);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <input
      autoFocus
      value={title}
      maxLength={200}
      aria-label={t("renameAriaLabel")}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      onFocus={(event) => event.target.select()}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'min-w-0 flex-1 rounded-ai-md border border-ai-border-focus bg-ai-surface px-1.5 py-0.5 text-ai-primary outline-none',
        className,
        // iOS Safari zooms on any field under 16 px: 16 px on phone only
        'max-md:text-base',
      )}
    />
  );
}
