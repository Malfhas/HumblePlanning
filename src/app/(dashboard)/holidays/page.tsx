"use client";

import { useState, useEffect, useMemo, useCallback, type WheelEvent } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { useHolidays, useDeleteHoliday, useImportHolidays } from "@/hooks/use-holidays";
import { HolidayForm } from "@/components/holidays/holiday-form";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { TruncatedCell } from "@/components/shared/truncated-cell";
import { Plus, Pencil, Trash2, Download, Check, ChevronsUpDown, AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PermissionButton } from "@/components/shared/permission-button";
import { RowActions } from "@/components/shared/row-actions";
import { DataTableSearchToggle } from "@/components/shared/data-table-search-toggle";
import { usePermissions } from "@/hooks/use-permissions";
import { ErrorState } from "@/components/shared/error-state";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ===== Types Nager.Date =====
interface NagerCountry {
  countryCode: string;
  name: string;
}

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  types: string[];
}

/** Imported label: name in the country's language (`localName`) or English name (`name`). */
type LabelSource = "local" | "english";

// ===== Import Dialog Component =====
function ImportHolidaysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.holidays.import");
  const tc = useTranslations("common");
  const { formatDate, intlTag } = useDateFormat();
  const importMutation = useImportHolidays();

  // State
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const [countries, setCountries] = useState<NagerCountry[]>([]);
  const [countryCode, setCountryCode] = useState("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [holidays, setHolidays] = useState<NagerHoliday[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [labelSource, setLabelSource] = useState<LabelSource>("local");

  // Country names in the UI language (fallback: English name from Nager.Date)
  const regionNames = new Intl.DisplayNames([intlTag], { type: "region" });
  const countryName = (c: NagerCountry) => {
    try {
      return regionNames.of(c.countryCode) ?? c.name;
    } catch {
      return c.name;
    }
  };
  const sortedCountries = [...countries].sort((a, b) => countryName(a).localeCompare(countryName(b), intlTag));
  const holidayLabel = (h: NagerHoliday) => (labelSource === "english" ? h.name : h.localName);

  // Detect browser country
  const browserCountry = useMemo(() => {
    if (typeof navigator === "undefined") return "FR";
    return navigator.language?.split("-")[1]?.toUpperCase() || "FR";
  }, []);

  // Year options: current ± 5
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, i) => (currentYear - 5 + i).toString()),
    [currentYear]
  );

  // Prevent wheel events from leaking to Dialog scroll lock
  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) {
      e.stopPropagation();
    }
  }, []);

  // On open: check API status + fetch countries
  useEffect(() => {
    if (!open) return;
    // Reset state
    setApiAvailable(null);
    setCountries([]);
    setHolidays([]);
    setResult(null);
    setCountryCode("");
    setYear(currentYear.toString());

    let cancelled = false;

    async function init() {
      // Health check
      try {
        const res = await fetch("/api/holidays/nager?type=status");
        const data = await res.json();
        if (cancelled) return;
        setApiAvailable(data.available === true);
        if (!data.available) return;
      } catch {
        if (!cancelled) setApiAvailable(false);
        return;
      }

      // Fetch countries
      setLoadingCountries(true);
      try {
        const res = await fetch("/api/holidays/nager?type=countries");
        const data = await res.json();
        if (cancelled) return;
        setCountries(data);
        // Auto-select browser country if available
        if (data.some((c: NagerCountry) => c.countryCode === browserCountry)) {
          setCountryCode(browserCountry);
        }
      } catch {
        // Silently fail — countries list will be empty
      } finally {
        if (!cancelled) setLoadingCountries(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [open, browserCountry, currentYear]);

  // Fetch holidays when country + year change
  const fetchHolidays = useCallback(async (cc: string, y: string) => {
    if (!cc || !y) return;
    setHolidays([]);
    setResult(null);
    setLoadingHolidays(true);
    try {
      const res = await fetch(`/api/holidays/nager?type=holidays&country=${cc}&year=${y}`);
      const data = await res.json();
      setHolidays(data);
    } catch {
      setHolidays([]);
    } finally {
      setLoadingHolidays(false);
    }
  }, []);

  useEffect(() => {
    if (open && countryCode && year) {
      fetchHolidays(countryCode, year);
    }
  }, [open, countryCode, year, fetchHolidays]);

  // Selected country label
  const selectedCountry = countries.find((c) => c.countryCode === countryCode);

  // Import handler
  const handleImport = () => {
    if (holidays.length === 0) return;
    importMutation.mutate(
      {
        holidays: holidays.map((h) => ({ date: h.date, label: holidayLabel(h) })),
        country: countryCode,
        year: parseInt(year),
      },
      {
        onSuccess: (data) => {
          setResult(data);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        {/* API unavailable */}
        {apiAvailable === false && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t("unavailable")}
            </AlertDescription>
          </Alert>
        )}

        {/* Loading API check */}
        {apiAvailable === null && (
          <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("checkingService")}
          </div>
        )}

        {/* API available — show controls */}
        {apiAvailable === true && (
          <div className="space-y-4">
            {/* Country + Year selectors */}
            <div className="flex gap-3">
              {/* Country Combobox */}
              <div className="flex-1">
                <label htmlFor="import-holiday-country" className="text-sm font-medium mb-1.5 block">{t("country")}</label>
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="import-holiday-country"
                      variant="outline"
                      role="combobox"
                      className={cn(
                        "w-full justify-between font-normal",
                        !countryCode && "text-muted-foreground"
                      )}
                      disabled={loadingCountries}
                    >
                      <span className="truncate">
                        {loadingCountries
                          ? tc("states.loading")
                          : selectedCountry
                            ? countryName(selectedCountry)
                            : t("countryPlaceholder")}
                      </span>
                      <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start" onWheel={handleWheel}>
                    <Command>
                      <CommandInput placeholder={t("countrySearch")} />
                      <CommandList onWheel={handleWheel} className="overscroll-contain">
                        <CommandEmpty>{t("countryEmpty")}</CommandEmpty>
                        <CommandGroup>
                          {sortedCountries.map((c) => (
                            <CommandItem
                              key={c.countryCode}
                              value={c.countryCode}
                              keywords={[countryName(c), c.name]}
                              onSelect={() => {
                                setCountryCode(c.countryCode);
                                setPopoverOpen(false);
                              }}
                            >
                              {countryName(c)}
                              <span className="ml-auto text-xs text-muted-foreground">{c.countryCode}</span>
                              {countryCode === c.countryCode && <Check className="ml-2 h-4 w-4" />}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Year Select */}
              <div className="w-[120px]">
                <label htmlFor="import-holiday-year" className="text-sm font-medium mb-1.5 block">{t("year")}</label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger id="import-holiday-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Imported label: local name (default) or English name */}
            <div>
              <label htmlFor="import-holiday-label-source" className="text-sm font-medium mb-1.5 block">{t("labelSource")}</label>
              <Select value={labelSource} onValueChange={(v) => setLabelSource(v as LabelSource)}>
                <SelectTrigger id="import-holiday-label-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{t("labelSourceLocal")}</SelectItem>
                  <SelectItem value="english">{t("labelSourceEnglish")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Preview list */}
            {loadingHolidays && (
              <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loadingHolidays")}
              </div>
            )}

            {!loadingHolidays && countryCode && holidays.length > 0 && (
              <div className="border rounded-md max-h-[260px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur">
                    <tr className="border-b">
                      <th className="text-left px-3 py-2 font-medium">{t("columns.date")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("columns.label")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidays.map((h) => (
                      <tr key={h.date} className="border-b last:border-0">
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                          {formatDate(h.date)}
                        </td>
                        <td className="px-3 py-1.5">{holidayLabel(h)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loadingHolidays && countryCode && holidays.length === 0 && !loadingCountries && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("empty")}
              </p>
            )}

            {/* Result message */}
            {result && (
              <Alert>
                <AlertDescription>
                  {result.skipped > 0
                    ? t.rich("resultWithSkipped", { count: result.imported, skipped: result.skipped, b: (c) => <strong>{c}</strong> })
                    : t.rich("result", { count: result.imported, b: (c) => <strong>{c}</strong> })}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{tc("actions.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tc("actions.cancel")}
              </Button>
              <Button
                onClick={handleImport}
                disabled={!apiAvailable || holidays.length === 0 || importMutation.isPending || loadingHolidays}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    {t("importing")}
                  </>
                ) : (
                  <>
                    <Download className="mr-1 h-4 w-4" />
                    {t("importButton", { count: holidays.length })}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== Main Page =====
export default function HolidaysPage() {
  const t = useTranslations("admin.holidays");
  const ta = useTranslations("admin.common");
  const tc = useTranslations("common");
  const { formatDate } = useDateFormat();
  const { data, isLoading } = useHolidays();
  const deleteHoliday = useDeleteHoliday();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    date: string;
    label: string;
    color: string;
  } | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const { can, isLoading: permLoading } = usePermissions();
  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:holidays")) return <ErrorState code={403} compact showBack={false} />;

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "date",
      header: sortableHeader(t("columns.date")),
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "label",
      header: sortableHeader(t("columns.label")),
      cell: ({ row }) => <TruncatedCell value={row.original.label} maxWidth="max-w-[260px]" />,
    },
    {
      accessorKey: "color",
      header: t("columns.color"),
      cell: ({ row }) => {
        const color = row.original.color;
        return color ? (
          <div className="flex items-center gap-2">
            <div
              className="h-4 w-4 rounded border"
              style={{ backgroundColor: color }}
            />
            <span className="text-sm text-muted-foreground">{color}</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <RowActions
          actions={[
            {
              label: tc("actions.edit"),
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => {
                setEditing({
                  id: row.original.id,
                  date: row.original.date,
                  label: row.original.label ?? "",
                  color: row.original.color ?? "#ff0000",
                });
                setDialogOpen(true);
              },
              allowed: can("holidays:edit"),
            },
            {
              label: tc("actions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => setDeleteTarget(row.original.id),
              allowed: can("holidays:edit"),
              destructive: true,
              separatorBefore: true,
            },
          ]}
        />
      ),
      size: 80,
    },
  ];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <div className="flex items-center gap-2">
        <DataTableSearchToggle
          value={searchValue}
          onChange={setSearchValue}
          placeholder={t("searchPlaceholder")}
          inputClassName="max-w-[260px]"
        />
      </div>

      <DataTable
        className="flex flex-col gap-3 flex-1 min-h-0"
        columns={columns}
        data={data ?? []}
        externalSearch
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        toolbar={
          <div className="flex gap-2">
            {can("holidays:edit") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setImportOpen(true)}
              >
                <Download className="mr-1 h-4 w-4" /> {tc("actions.import")}
              </Button>
            )}
            {!can("holidays:edit") ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button size="sm" disabled>
                      <Plus className="mr-1 h-4 w-4" /> {tc("actions.add")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{ta("permissionDenied")}</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> {tc("actions.add")}
              </Button>
            )}
          </div>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t("dialog.editTitle") : t("dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? t("dialog.editDescription")
                : t("dialog.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <HolidayForm
            initialData={editing}
            onSuccess={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <ImportHolidaysDialog open={importOpen} onOpenChange={setImportOpen} />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("deleteTitle")}
        onConfirm={() => {
          if (deleteTarget) deleteHoliday.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
        isPending={deleteHoliday.isPending}
      />
    </div>
  );
}
