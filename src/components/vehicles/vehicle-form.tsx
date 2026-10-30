"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useCreateVehicle, useUpdateVehicle } from "@/hooks/use-vehicles";
import { useVehicleTypes } from "@/hooks/use-vehicle-types";
import { useBusinessUnits } from "@/hooks/use-business-units";
import type { VehicleWithType } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ColorPicker } from "@/components/shared/color-picker";
import { Button } from "@/components/ui/button";
import { QualificationIcon } from "@/components/shared/icon-picker";
import { cn, contrastColor } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle, Building2, ChevronsUpDown, Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface VehicleFormProps {
  initialData?: VehicleWithType | null;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, { labelKey: "available" | "inMaintenance" | "outOfService"; className: string }> = {
  available: { labelKey: "available", className: "text-green-600" },
  maintenance: { labelKey: "inMaintenance", className: "text-amber-600" },
  out_of_service: { labelKey: "outOfService", className: "text-red-600" },
};

export function VehicleForm({ initialData, onClose }: VehicleFormProps) {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const { data: vehicleTypes } = useVehicleTypes();
  const { data: businessUnits } = useBusinessUnits();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [buPopoverOpen, setBuPopoverOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    vehicleTypeId: "",
    businessUnitId: "",
    registrationNumber: "",
    color: "#3b82f6",
    status: "available",
    comment: "",
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name ?? "",
        vehicleTypeId: initialData.vehicleTypeId ?? "",
        businessUnitId: initialData.businessUnitId ?? "",
        registrationNumber: initialData.registrationNumber ?? "",
        color: initialData.color ?? "#3b82f6",
        status: initialData.status ?? "available",
        comment: initialData.comment ?? "",
      });
    }
  }, [initialData]);

  const isEdit = !!initialData;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validate required fields
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t("form.nameRequired");
    if (!form.businessUnitId) errors.businessUnitId = t("form.businessUnitRequired");
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    const data = {
      name: form.name,
      vehicleTypeId: form.vehicleTypeId && form.vehicleTypeId !== "none" ? form.vehicleTypeId : null,
      businessUnitId: form.businessUnitId,
      registrationNumber: form.registrationNumber || null,
      color: form.color,
      status: form.status,
      comment: form.comment || null,
    };

    const onError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createVehicle.reset();
        updateVehicle.reset();
      }
    };
    if (isEdit) {
      updateVehicle.mutate({ id: initialData!.id, data }, { onSuccess: onClose, onError });
    } else {
      createVehicle.mutate(data, { onSuccess: onClose, onError });
    }
  }

  const isPending = createVehicle.isPending || updateVehicle.isPending;
  const selectedType = vehicleTypes?.find((vt) => vt.id === form.vehicleTypeId);
  const selectedBu = businessUnits?.find((bu) => bu.id === form.businessUnitId);
  const handleWheel = (e: React.WheelEvent) => e.stopPropagation();

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="v-name">{t("form.nameLabel")}</Label>
          <Input
            id="v-name"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              clearFieldError(setFieldErrors, "name");
            }}
            maxLength={100}
            placeholder={t("vehicles.form.namePlaceholder")}
            className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vehicle-type">{t("form.typeLabel")}</Label>
          <Select name="vehicleTypeId" value={form.vehicleTypeId || "none"} onValueChange={(v) => setForm({ ...form, vehicleTypeId: v })}>
            <SelectTrigger id="vehicle-type">
              <SelectValue placeholder={tc("states.none")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{tc("states.none")}</SelectItem>
              {vehicleTypes?.map((vt) => (
                <SelectItem key={vt.id} value={vt.id}>
                  <span className="flex items-center gap-1.5">
                    <QualificationIcon name={vt.icon} className="size-3.5" />
                    {vt.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className={cn("space-y-1.5", fieldErrors.businessUnitId && "field-error")}>
          <Label htmlFor="vehicle-bu-trigger">{t("form.businessUnitLabel")} <span className="text-destructive">*</span></Label>
          <Popover open={buPopoverOpen} onOpenChange={setBuPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                id="vehicle-bu-trigger"
                type="button"
                variant="outline"
                role="combobox"
                className={cn(
                  "w-full justify-between min-w-0 font-normal",
                  !form.businessUnitId && "text-muted-foreground",
                  fieldErrors.businessUnitId && "border-destructive ring-1 ring-destructive"
                )}
              >
                <span className="flex items-center min-w-0">
                  {selectedBu ? (
                    <>
                      <Building2 className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">{selectedBu.name}</span>
                    </>
                  ) : <span className="truncate">{t("form.noBusinessUnit")}</span>}
                </span>
                <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
              <Command defaultValue={form.businessUnitId || undefined}>
                <CommandInput placeholder={t("form.searchBusinessUnit")} />
                <CommandList onWheel={handleWheel}>
                  <CommandEmpty>{t("form.noBusinessUnitFound")}</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        setForm({ ...form, businessUnitId: "" });
                        setBuPopoverOpen(false);
                      }}
                    >
                      {t("form.noBusinessUnit")}
                      {!form.businessUnitId && <Check className="ml-auto h-4 w-4" />}
                    </CommandItem>
                    {businessUnits?.map((bu) => (
                      <CommandItem
                        key={bu.id}
                        value={bu.id}
                        keywords={[bu.name]}
                        onSelect={() => {
                          setForm({ ...form, businessUnitId: bu.id });
                          clearFieldError(setFieldErrors, "businessUnitId");
                          setBuPopoverOpen(false);
                        }}
                      >
                        <Building2 className="mr-2 h-4 w-4 shrink-0" />
                        {bu.name}
                        {form.businessUnitId === bu.id && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {fieldErrors.businessUnitId && <p className="text-xs text-destructive mt-1">{fieldErrors.businessUnitId}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="v-reg">{t("vehicles.form.registrationLabel")}</Label>
          <Input
            id="v-reg"
            value={form.registrationNumber}
            onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
            maxLength={50}
            placeholder={t("vehicles.form.registrationPlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vehicle-color">{t("form.colorLabel")}</Label>
          <ColorPicker
            id="vehicle-color"
            value={form.color}
            onChange={(color) => setForm({ ...form, color })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vehicle-status">{t("form.statusLabel")}</Label>
          <Select name="status" value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger id="vehicle-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([value, { labelKey }]) => (
                <SelectItem key={value} value={value}>
                  {t(`status.${labelKey}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="v-comment">{t("form.commentLabel")}</Label>
        <Textarea
          id="v-comment"
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
          rows={2}
          placeholder={t("form.commentPlaceholder")}
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium leading-none select-none">{t("form.preview")}</span>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ backgroundColor: selectedType?.color || form.color, color: contrastColor(selectedType?.color || form.color) }}
          >
            <QualificationIcon name={selectedType?.icon || "Truck"} className="size-3.5" />
            {form.name || t("vehicles.form.previewFallback")}
          </span>
          {form.registrationNumber && (
            <span className="text-xs text-muted-foreground">{form.registrationNumber}</span>
          )}
          <span className={`text-xs ${STATUS_LABELS[form.status]?.className || ""}`}>
            {STATUS_LABELS[form.status] ? t(`status.${STATUS_LABELS[form.status].labelKey}`) : null}
          </span>
        </div>
      </div>

      {(createVehicle.error || updateVehicle.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createVehicle.error || updateVehicle.error)?.message}</p>
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
