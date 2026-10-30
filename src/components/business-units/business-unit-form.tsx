"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useBusinessUnit, useCreateBusinessUnit, useUpdateBusinessUnit } from "@/hooks/use-business-units";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/shared/color-picker";
import { AddressMapPicker } from "@/components/shared/address-map-picker";
import { cn } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle } from "lucide-react";

interface BusinessUnitFormProps {
  id: string | null;
  onClose: () => void;
}

export function BusinessUnitForm({ id, onClose }: BusinessUnitFormProps) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const { data: bu, isLoading } = useBusinessUnit(id);
  const createBU = useCreateBusinessUnit();
  const updateBU = useUpdateBusinessUnit();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: "",
    color: "#8b5cf6",
    number: "",
    address: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  useEffect(() => {
    if (bu && id) {
      setForm({
        name: bu.name ?? "",
        color: bu.color ?? "#8b5cf6",
        number: bu.number ?? "",
        address: bu.address ?? "",
        latitude: bu.latitude ? parseFloat(bu.latitude) : null,
        longitude: bu.longitude ? parseFloat(bu.longitude) : null,
      });
    }
  }, [bu, id]);

  const isEdit = !!id;
  const [addressError, setAddressError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side required validation (backend re-validates too)
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t("shared.validation.nameRequired");
    if (!form.number.trim()) errors.number = t("shared.validation.numberRequired");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (!form.latitude || !form.longitude) {
      if (form.address.trim()) setAddressError(true);
      return;
    }
    setAddressError(false);
    setFieldErrors({});

    const data = {
      name: form.name,
      color: form.color,
      number: form.number,
      address: form.address,
      latitude: form.latitude.toString(),
      longitude: form.longitude.toString(),
    };

    const onError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createBU.reset();
        updateBU.reset();
      }
    };
    if (isEdit) {
      updateBU.mutate({ id, data }, { onSuccess: onClose, onError });
    } else {
      createBU.mutate(data, { onSuccess: onClose, onError });
    }
  }

  if (id && isLoading) {
    return <p className="py-4 text-center text-muted-foreground">{tc("states.loading")}</p>;
  }

  const isPending = createBU.isPending || updateBU.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
          <Label htmlFor="bu-name">{t("shared.fields.nameRequired")}</Label>
          <Input
            id="bu-name"
            autoComplete="off"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              clearFieldError(setFieldErrors, "name");
            }}
            maxLength={150}
            className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bu-color">{t("shared.fields.color")}</Label>
          <ColorPicker id="bu-color" value={form.color} onChange={(color) => setForm({ ...form, color })} />
        </div>
        <div className={cn("space-y-1.5", fieldErrors.number && "field-error")}>
          <Label htmlFor="bu-number">{t("businessUnits.form.number")}</Label>
          <Input
            id="bu-number"
            autoComplete="off"
            value={form.number}
            onChange={(e) => {
              setForm({ ...form, number: e.target.value });
              clearFieldError(setFieldErrors, "number");
            }}
            maxLength={50}
            className={cn(fieldErrors.number && "border-destructive ring-1 ring-destructive")}
          />
          {fieldErrors.number && <p className="text-xs text-destructive mt-1">{fieldErrors.number}</p>}
        </div>
      </div>

      <AddressMapPicker
        address={form.address}
        latitude={form.latitude}
        longitude={form.longitude}
        onAddressChange={(address) => { setForm((prev) => ({ ...prev, address })); setAddressError(false); }}
        onLocationChange={(lat, lng) => { setForm((prev) => ({ ...prev, latitude: lat, longitude: lng })); setAddressError(false); }}
        required
        height="450px"
      />
      {addressError && (
        <p className="text-xs text-destructive">{t("businessUnits.form.addressRequired")}</p>
      )}

      {(createBU.error || updateBU.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createBU.error || updateBU.error)?.message}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {tc("actions.cancel")}
        </Button>
        <Button type="submit" disabled={isPending || !form.latitude || !form.longitude}>
          {isPending ? tc("actions.saving") : isEdit ? tc("actions.edit") : tc("actions.create")}
        </Button>
      </div>
    </form>
  );
}
