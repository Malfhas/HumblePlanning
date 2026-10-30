"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useCreateQualification, useUpdateQualification } from "@/hooks/use-qualifications";
import type { Qualification } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ColorPicker } from "@/components/shared/color-picker";
import { Button } from "@/components/ui/button";
import { IconPicker, QualificationIcon } from "@/components/shared/icon-picker";
import { cn, contrastColor } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle } from "lucide-react";

interface QualificationFormProps {
  initialData?: Qualification | null;
  onClose: () => void;
}

export function QualificationForm({ initialData, onClose }: QualificationFormProps) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const createQualification = useCreateQualification();
  const updateQualification = useUpdateQualification();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: "",
    emoji: "Award",
    color: "#ffffff",
    description: "",
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name ?? "",
        emoji: initialData.emoji ?? "Award",
        color: initialData.color ?? "#3b82f6",
        description: initialData.description ?? "",
      });
    }
  }, [initialData]);

  const isEdit = !!initialData;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side required validation (backend re-validates too)
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t("shared.validation.nameRequired");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const data = {
      name: form.name,
      emoji: form.emoji,
      color: form.color,
      description: form.description || null,
    };

    const onError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createQualification.reset();
        updateQualification.reset();
      }
    };
    if (isEdit) {
      updateQualification.mutate({ id: initialData!.id, data }, { onSuccess: onClose, onError });
    } else {
      createQualification.mutate(data, { onSuccess: onClose, onError });
    }
  }

  const isPending = createQualification.isPending || updateQualification.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Name */}
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="qual-name">{t("shared.fields.nameRequired")}</Label>
          <Input
            id="qual-name"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              clearFieldError(setFieldErrors, "name");
            }}
            maxLength={100}
            className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
        </div>

        {/* Icon */}
        <div className="space-y-1.5">
          <Label htmlFor="qual-icon">{t("qualifications.form.icon")}</Label>
          <IconPicker
            id="qual-icon"
            value={form.emoji}
            onChange={(emoji) => setForm({ ...form, emoji })}
          />
        </div>

        {/* Color */}
        <div className="space-y-1.5">
          <Label htmlFor="qual-color">{t("shared.fields.colorRequired")}</Label>
          <ColorPicker
            id="qual-color"
            value={form.color}
            onChange={(color) => setForm({ ...form, color })}
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="qual-description">{t("shared.fields.description")}</Label>
        <Textarea
          id="qual-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          placeholder={t("shared.fields.descriptionPlaceholder")}
        />
      </div>

      {/* Preview (section title, not a form field → we use a span
          styled as a label to avoid the a11y "orphan label" warning). */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium leading-none select-none">{t("shared.fields.preview")}</span>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ backgroundColor: form.color, color: contrastColor(form.color) }}
          >
            <QualificationIcon name={form.emoji} className="size-3.5" />
            {form.name || t("qualifications.form.previewFallback")}
          </span>
        </div>
      </div>

      {/* Error display */}
      {(createQualification.error || updateQualification.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createQualification.error || updateQualification.error)?.message}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {tc("actions.cancel")}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? tc("actions.saving") : isEdit ? tc("actions.edit") : tc("actions.create")}
        </Button>
      </div>
    </form>
  );
}
