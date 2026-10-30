"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useCreateResourceType, useUpdateResourceType } from "@/hooks/use-resource-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/shared/color-picker";
import { Button } from "@/components/ui/button";
import { IconPicker, QualificationIcon } from "@/components/shared/icon-picker";
import { cn, contrastColor } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle } from "lucide-react";

interface ResourceTypeFormProps {
  initialData?: { id: string; name: string; icon: string; color: string } | null;
  onClose: () => void;
}

export function ResourceTypeForm({ initialData, onClose }: ResourceTypeFormProps) {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const createRT = useCreateResourceType();
  const updateRT = useUpdateResourceType();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: "",
    icon: "Wrench",
    color: "#3b82f6",
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name ?? "",
        icon: initialData.icon ?? "Wrench",
        color: initialData.color ?? "#3b82f6",
      });
    }
  }, [initialData]);

  const isEdit = !!initialData;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t("form.nameRequired");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const data = {
      name: form.name,
      icon: form.icon,
      color: form.color,
    };
    const onError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createRT.reset();
        updateRT.reset();
      }
    };
    if (isEdit) {
      updateRT.mutate({ id: initialData!.id, data }, { onSuccess: onClose, onError });
    } else {
      createRT.mutate(data, { onSuccess: onClose, onError });
    }
  }

  const isPending = createRT.isPending || updateRT.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="rt-name">{t("form.nameLabel")}</Label>
          <Input
            id="rt-name"
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
        <div className="space-y-1.5">
          <Label htmlFor="rt-icon">{t("form.iconLabel")}</Label>
          <IconPicker
            id="rt-icon"
            value={form.icon}
            onChange={(icon) => setForm({ ...form, icon })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rt-color">{t("form.colorLabel")}</Label>
          <ColorPicker
            id="rt-color"
            value={form.color}
            onChange={(color) => setForm({ ...form, color })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium leading-none select-none">{t("form.preview")}</span>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ backgroundColor: form.color, color: contrastColor(form.color) }}
          >
            <QualificationIcon name={form.icon} className="size-3.5" />
            {form.name || t("form.typePreviewFallback")}
          </span>
        </div>
      </div>

      {(createRT.error || updateRT.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createRT.error || updateRT.error)?.message}</p>
        </div>
      )}

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
