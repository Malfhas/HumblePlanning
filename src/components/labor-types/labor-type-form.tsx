"use client";

import { useEffect, useState } from "react";
import { useCreateLaborType, useUpdateLaborType } from "@/hooks/use-labor-types";
import type { LaborType } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

interface LaborTypeFormProps {
  initialData?: LaborType | null;
  onClose: () => void;
}

export function LaborTypeForm({ initialData, onClose }: LaborTypeFormProps) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const createLT = useCreateLaborType();
  const updateLT = useUpdateLaborType();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: "",
    initials: "",
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name ?? "",
        initials: initialData.initials ?? "",
      });
    }
  }, [initialData]);

  const isEdit = !!initialData;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side required validation (backend re-validates too)
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t("validation.nameRequired");
    if (!form.initials.trim()) errors.initials = t("validation.initialsRequired");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const data = { name: form.name, initials: form.initials.toUpperCase() };
    const onError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createLT.reset();
        updateLT.reset();
      }
    };
    if (isEdit) {
      updateLT.mutate({ id: initialData!.id, data }, { onSuccess: onClose, onError });
    } else {
      createLT.mutate(data, { onSuccess: onClose, onError });
    }
  }

  const isPending = createLT.isPending || updateLT.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="lt-name">{t("fields.name")} *</Label>
          <Input
            id="lt-name"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              clearFieldError(setFieldErrors, "name");
            }}
            maxLength={100}
            placeholder={t("laborTypes.form.namePlaceholder")}
            className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
        </div>
        <div className={cn("space-y-1.5", fieldErrors.initials && "field-error")}>
          <Label htmlFor="lt-initials">{t("fields.initials")} *</Label>
          <Input
            id="lt-initials"
            value={form.initials}
            onChange={(e) => {
              setForm({ ...form, initials: e.target.value.toUpperCase() });
              clearFieldError(setFieldErrors, "initials");
            }}
            maxLength={10}
            placeholder={t("laborTypes.form.initialsPlaceholder")}
            className={cn("uppercase", fieldErrors.initials && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.initials && <p className="text-xs text-destructive mt-1">{fieldErrors.initials}</p>}
        </div>
      </div>

      {(createLT.error || updateLT.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createLT.error || updateLT.error)?.message}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {tc("actions.cancel")}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? tc("states.saving") : isEdit ? tc("actions.edit") : tc("actions.create")}
        </Button>
      </div>
    </form>
  );
}
