"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useCreateVehicleType, useUpdateVehicleType } from "@/hooks/use-vehicle-types";
import type { VehicleType } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/shared/color-picker";
import { Button } from "@/components/ui/button";
import { IconPicker, QualificationIcon } from "@/components/shared/icon-picker";
import { cn, contrastColor } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle } from "lucide-react";

interface VehicleTypeFormProps {
  initialData?: VehicleType | null;
  onClose: () => void;
}

export function VehicleTypeForm({ initialData, onClose }: VehicleTypeFormProps) {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const createVT = useCreateVehicleType();
  const updateVT = useUpdateVehicleType();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: "",
    icon: "Truck",
    color: "#3b82f6",
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name ?? "",
        icon: initialData.icon ?? "Truck",
        color: initialData.color ?? "#3b82f6",
      });
    }
  }, [initialData]);

  const isEdit = !!initialData;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side required validation (backend re-validates too)
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
        createVT.reset();
        updateVT.reset();
      }
    };
    if (isEdit) {
      updateVT.mutate({ id: initialData!.id, data }, { onSuccess: onClose, onError });
    } else {
      createVT.mutate(data, { onSuccess: onClose, onError });
    }
  }

  const isPending = createVT.isPending || updateVT.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="vt-name">{t("form.nameLabel")}</Label>
          <Input
            id="vt-name"
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
          <Label htmlFor="vt-icon">{t("form.iconLabel")}</Label>
          <IconPicker
            id="vt-icon"
            value={form.icon}
            onChange={(icon) => setForm({ ...form, icon })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vt-color">{t("form.colorLabel")}</Label>
          <ColorPicker
            id="vt-color"
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

      {(createVT.error || updateVT.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createVT.error || updateVT.error)?.message}</p>
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
