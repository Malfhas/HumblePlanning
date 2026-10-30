"use client";

import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/shared/color-picker";
import { useCreateTeam, useUpdateTeam } from "@/hooks/use-teams";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { cn } from "@/lib/utils";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";
import { XCircle, Building2, Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface TeamFormProps {
  initialData: { id: string; name: string; color?: string; businessUnitId?: string | null } | null;
  onSuccess: () => void;
}

export function TeamForm({ initialData, onSuccess }: TeamFormProps) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const { data: businessUnits } = useBusinessUnits();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [buPopoverOpen, setBuPopoverOpen] = useState(false);

  const form = useForm<{ name: string; color: string; businessUnitId: string }>({
    defaultValues: { name: "", color: "#FFFFFF", businessUnitId: "" },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.name,
        color: initialData.color ?? "#FFFFFF",
        businessUnitId: initialData.businessUnitId ?? "",
      });
    } else {
      form.reset({ name: "", color: "#FFFFFF", businessUnitId: "" });
    }
  }, [initialData, form]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  const onSubmit = form.handleSubmit((values) => {
    const errors: Record<string, string> = {};
    if (!values.name.trim()) errors.name = t("shared.validation.nameRequired");
    if (!values.businessUnitId) errors.businessUnitId = t("shared.validation.businessUnitRequired");
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const data = { name: values.name, color: values.color, businessUnitId: values.businessUnitId };
    const onError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createTeam.reset();
        updateTeam.reset();
      }
    };
    if (initialData) {
      updateTeam.mutate({ id: initialData.id, data }, { onSuccess, onError });
    } else {
      createTeam.mutate(data, { onSuccess, onError });
    }
  });

  const isLoading = createTeam.isPending || updateTeam.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className={cn("space-y-2", fieldErrors.name && "field-error")}>
        <Label htmlFor="name">{t("shared.fields.nameRequired")}</Label>
        <Input
          id="name"
          autoComplete="off"
          {...form.register("name", { onChange: () => clearFieldError(setFieldErrors, "name") })}
          className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
        />
        {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
      </div>

      <div className={cn("space-y-1.5", fieldErrors.businessUnitId && "field-error")}>
        <Label htmlFor="team-bu-trigger">{t("shared.fields.businessUnitRequired")}</Label>
        <Controller
          control={form.control}
          name="businessUnitId"
          render={({ field }) => {
            const selectedBu = businessUnits?.find((bu) => bu.id === field.value);
            return (
            <Popover open={buPopoverOpen} onOpenChange={setBuPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="team-bu-trigger"
                  type="button"
                  variant="outline"
                  role="combobox"
                  className={cn(
                    "w-full justify-between min-w-0 font-normal",
                    !field.value && "text-muted-foreground",
                    fieldErrors.businessUnitId && "border-destructive ring-1 ring-destructive"
                  )}
                >
                  <span className="flex items-center min-w-0">
                    {field.value && selectedBu ? (
                      <>
                        <Building2 className="mr-2 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{selectedBu.name}</span>
                      </>
                    ) : (
                      <span className="truncate">{t("shared.selectBu")}</span>
                    )}
                  </span>
                  <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                <Command defaultValue={field.value || undefined}>
                  <CommandInput placeholder={tc("actions.searchPlaceholder")} />
                  <CommandList onWheel={handleWheel}>
                    <CommandEmpty>{t("shared.noBu")}</CommandEmpty>
                    <CommandGroup>
                      {businessUnits?.map((bu) => (
                        <CommandItem
                          key={bu.id}
                          value={bu.id}
                          keywords={[bu.name, bu.number ?? ""]}
                          onSelect={() => {
                            field.onChange(bu.id);
                            setBuPopoverOpen(false);
                            clearFieldError(setFieldErrors, "businessUnitId");
                          }}
                        >
                          <Building2 className="mr-2 h-3.5 w-3.5 shrink-0" />
                          {bu.name}
                          {field.value === bu.id && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            );
          }}
        />
        {fieldErrors.businessUnitId && <p className="text-xs text-destructive mt-1">{fieldErrors.businessUnitId}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="team-color">{t("shared.fields.colorRequired")}</Label>
        {/* No Controller here: HexColorPicker (react-colorful)
            fires onChange on every mouse move while dragging,
            which cascades Controller re-renders and loses the
            drag handle's internal state. We use watch + setValue,
            which only subscribes to `color` (fine-grained). */}
        <ColorPicker
          id="team-color"
          value={form.watch("color")}
          onChange={(c) => form.setValue("color", c, { shouldDirty: true })}
        />
      </div>
      {(createTeam.error || updateTeam.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createTeam.error || updateTeam.error)?.message}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading
            ? tc("actions.saving")
            : initialData
              ? tc("actions.edit")
              : tc("actions.create")}
        </Button>
      </div>
    </form>
  );
}
