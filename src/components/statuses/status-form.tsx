"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/shared/color-picker";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

interface StatusFormData {
  name: string;
  color: string;
  displayMode: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  sortOrder: number;
  percentage: number;
  isDefault: boolean;
}

interface StatusFormProps {
  initialData?: { id: string; name: string; color?: string | null; displayMode?: string | null; bold?: boolean | null; italic?: boolean | null; underline?: boolean | null; strikethrough?: boolean | null; sortOrder?: number | null; percentage?: number | null; isDefault?: boolean | null };
  onSubmit: (data: StatusFormData) => void;
  isPending?: boolean;
  serverError?: Error | null;
}

/** Display modes; labels: `projects.statuses.displayModes.<mode>`. */
const displayModes = ["tp", "t", "p"] as const;

export function StatusForm({ initialData, onSubmit, isPending, serverError }: StatusFormProps) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { register, handleSubmit, setValue, watch, reset } = useForm<StatusFormData>({
    defaultValues: {
      name: "",
      color: "#3b82f6",
      displayMode: "tp",
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      sortOrder: 0,
      percentage: 0,
      isDefault: false,
    },
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialData) {
      reset({
        name: initialData.name,
        color: initialData.color || "#3b82f6",
        displayMode: initialData.displayMode || "tp",
        bold: initialData.bold ?? false,
        italic: initialData.italic ?? false,
        underline: initialData.underline ?? false,
        strikethrough: initialData.strikethrough ?? false,
        sortOrder: initialData.sortOrder ?? 0,
        percentage: initialData.percentage ?? 0,
        isDefault: initialData.isDefault ?? false,
      });
    }
  }, [initialData, reset]);

  // Parse server errors into per-field errors (Zod validation messages etc.)
  useEffect(() => {
    if (serverError) {
      setFieldErrors(parseFieldErrors(serverError));
    }
  }, [serverError]);

  const color = watch("color");
  const displayMode = watch("displayMode");
  const bold = watch("bold");
  const italic = watch("italic");
  const underline = watch("underline");
  const strikethrough = watch("strikethrough");
  const isDefault = watch("isDefault");

  const submit = handleSubmit((values) => {
    // Client-side required validation (backend re-validates)
    const errors: Record<string, string> = {};
    if (!values.name.trim()) errors.name = t("validation.nameRequired");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    onSubmit(values);
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className={cn("space-y-2", fieldErrors.name && "field-error")}>
        <Label htmlFor="name">{t("fields.name")} *</Label>
        <Input
          id="name"
          autoComplete="off"
          {...register("name", {
            onChange: () => clearFieldError(setFieldErrors, "name"),
          })}
          placeholder={t("statuses.form.namePlaceholder")}
          className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
        />
        {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="status-color">{t("fields.color")}</Label>
        <ColorPicker
          id="status-color"
          value={color}
          onChange={(c) => setValue("color", c)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="status-display-mode">{t("fields.displayMode")}</Label>
        <Select name="displayMode" value={displayMode} onValueChange={(v) => setValue("displayMode", v)}>
          <SelectTrigger id="status-display-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {displayModes.map((m) => (
              <SelectItem key={m} value={m}>
                {t(`statuses.displayModes.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="bold">{t("statuses.form.bold")}</Label>
          <Switch id="bold" checked={bold} onCheckedChange={(c) => setValue("bold", c)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="italic">{t("statuses.form.italic")}</Label>
          <Switch id="italic" checked={italic} onCheckedChange={(c) => setValue("italic", c)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="underline">{t("statuses.form.underline")}</Label>
          <Switch id="underline" checked={underline} onCheckedChange={(c) => setValue("underline", c)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="strikethrough">{t("statuses.form.strikethrough")}</Label>
          <Switch id="strikethrough" checked={strikethrough} onCheckedChange={(c) => setValue("strikethrough", c)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={cn("space-y-2", fieldErrors.sortOrder && "field-error")}>
          <Label htmlFor="sortOrder">{t("fields.sortOrder")}</Label>
          <Input
            id="sortOrder"
            type="number"
            {...register("sortOrder", {
              valueAsNumber: true,
              onChange: () => clearFieldError(setFieldErrors, "sortOrder"),
            })}
            className={cn(fieldErrors.sortOrder && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.sortOrder && <p className="text-xs text-destructive mt-1">{fieldErrors.sortOrder}</p>}
        </div>
        <div className={cn("space-y-2", fieldErrors.percentage && "field-error")}>
          <Label htmlFor="percentage">{t("statuses.form.percentage")}</Label>
          <Input
            id="percentage"
            type="number"
            min={0}
            max={100}
            {...register("percentage", {
              valueAsNumber: true,
              min: 0,
              max: 100,
              onChange: () => clearFieldError(setFieldErrors, "percentage"),
            })}
            className={cn(fieldErrors.percentage && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.percentage && <p className="text-xs text-destructive mt-1">{fieldErrors.percentage}</p>}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="isDefault">{t("statuses.form.isDefault")}</Label>
        <Switch
          id="isDefault"
          checked={isDefault}
          onCheckedChange={(c) => setValue("isDefault", c)}
        />
      </div>

      {serverError && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{serverError.message}</p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? tc("states.saving") : initialData ? tc("actions.edit") : tc("actions.create")}
      </Button>
    </form>
  );
}
