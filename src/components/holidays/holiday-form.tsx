"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/shared/color-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarDays, XCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import { useCreateHoliday, useUpdateHoliday } from "@/hooks/use-holidays";
import { parseFieldErrors, clearFieldError } from "@/lib/utils/field-errors";

interface HolidayFormProps {
  initialData: {
    id: string;
    date: string;
    label: string;
    color: string;
  } | null;
  onSuccess: () => void;
}

export function HolidayForm({ initialData, onSuccess }: HolidayFormProps) {
  const t = useTranslations("admin.holidays.form");
  const tc = useTranslations("common");
  const { format: formatLocalized } = useDateFormat();
  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const form = useForm({
    defaultValues: { date: "", label: "", color: "#ff0000" },
  });

  const dateValue = form.watch("date");

  useEffect(() => {
    if (initialData) {
      form.reset({
        date: initialData.date,
        label: initialData.label,
        color: initialData.color || "#ff0000",
      });
    } else {
      form.reset({ date: "", label: "", color: "#ff0000" });
    }
  }, [initialData, form]);

  const onSubmit = form.handleSubmit((values) => {
    const data = {
      date: values.date,
      label: values.label || undefined,
      color: values.color || undefined,
    };
    const onError = (err: Error) => {
      const parsed = parseFieldErrors(err);
      setFieldErrors(parsed);
      if (Object.keys(parsed).length > 0) {
        createHoliday.reset();
        updateHoliday.reset();
      }
    };
    if (initialData) {
      updateHoliday.mutate({ id: initialData.id, data }, { onSuccess, onError });
    } else {
      createHoliday.mutate(data, { onSuccess, onError });
    }
  });

  const isLoading = createHoliday.isPending || updateHoliday.isPending;

  const [calendarOpen, setCalendarOpen] = useState(false);
  const selectedDate = dateValue ? parseISO(dateValue) : undefined;

  const handleDateSelect = (day: Date | undefined) => {
    if (day) {
      form.setValue("date", format(day, "yyyy-MM-dd"), { shouldValidate: true });
      setCalendarOpen(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="holiday-date-trigger">{t("date")}</Label>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              id="holiday-date-trigger"
              type="button"
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !dateValue && "text-muted-foreground"
              )}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              {dateValue
                ? formatLocalized(parseISO(dateValue), "d MMMM yyyy")
                : t("datePlaceholder")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              defaultMonth={selectedDate}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>
        <input type="hidden" {...form.register("date", { required: true })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="label">{t("label")}</Label>
        <Input id="label" {...form.register("label")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="holiday-color">{t("color")}</Label>
        <ColorPicker
          id="holiday-color"
          value={form.watch("color") || "#3b82f6"}
          onChange={(c) => form.setValue("color", c)}
        />
      </div>
      {(createHoliday.error || updateHoliday.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createHoliday.error || updateHoliday.error)?.message}</p>
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
