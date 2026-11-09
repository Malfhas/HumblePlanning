"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarDays, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDateFormat } from "@/hooks/use-date-format";
import { cn } from "@/lib/utils";

interface PurgeBeforeDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Query key prefix of the preview (the date is appended). */
  previewKey: string;
  /** What the purge would erase before that date (YYYY-MM-DD). */
  preview(before: string): Promise<T>;
  renderPreview: (data: T) => ReactNode;
  onConfirm(before: string): Promise<unknown>;
  pending: boolean;
}

/**
 * Manual purge « before the » date: the user picks a day, sees how much would
 * be erased (server count), then confirms. The chosen day itself is kept.
 */
export function PurgeBeforeDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  previewKey,
  preview,
  renderPreview,
  onConfirm,
  pending,
}: PurgeBeforeDialogProps<T>) {
  const t = useTranslations("admin.purgeBefore");
  const tc = useTranslations("common");
  const { format: formatLocalized } = useDateFormat();
  const [before, setBefore] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const counts = useQuery({
    queryKey: [previewKey, "purge-preview", before],
    queryFn: () => preview(before),
    enabled: open && !!before,
    staleTime: 0,
  });

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setBefore("");
  };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !before && "text-muted-foreground")}>
              <CalendarDays className="mr-2 h-4 w-4" />
              {before ? t("before", { date: formatLocalized(parseISO(before), "d MMMM yyyy") }) : t("datePlaceholder")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={before ? parseISO(before) : undefined}
              onSelect={(date) => {
                setBefore(date ? format(date, "yyyy-MM-dd") : "");
                setCalendarOpen(false);
              }}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>
        {before && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" aria-live="polite">
            {counts.isFetching ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tc("states.loading")}
              </span>
            ) : counts.data ? (
              renderPreview(counts.data)
            ) : null}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!before || !counts.data || counts.isFetching || pending}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm(before).then(() => close(false), () => undefined);
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
