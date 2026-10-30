"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";

/**
 * Normalize a string for search: lowercase + strip diacritics.
 * "Éléonore" → "eleonore", "Müller" → "muller", "Café" → "cafe"
 */
function normalizeForSearch(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Custom global filter: accent-insensitive, case-insensitive, operates on all
 * accessor/visible columns. Handles numbers, strings, arrays, and nested objects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function accentInsensitiveGlobalFilter(row: any, _columnId: string, filterValue: string): boolean {
  if (!filterValue) return true;
  const needle = normalizeForSearch(filterValue);
  if (!needle) return true;

  // Walk visible cell values via TanStack's row API
  for (const cell of row.getAllCells()) {
    const value = cell.getValue();
    if (value == null) continue;
    if (typeof value === "object") {
      // Flatten object/array values one level deep
      const flat = Array.isArray(value) ? value : Object.values(value);
      for (const v of flat) {
        if (v != null && normalizeForSearch(v).includes(needle)) return true;
      }
    } else if (normalizeForSearch(value).includes(needle)) {
      return true;
    }
  }
  return false;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchable?: boolean;
  searchPlaceholder?: string;
  pagination?: boolean;
  pageSize?: number;
  onRowSelection?: (rows: TData[]) => void;
  toolbar?: React.ReactNode;
  className?: string;
  isLoading?: boolean;
  /**
   * "External search bar" mode. When enabled, the `DataTable`
   * does NOT render its own search bar; the parent controls the
   * value via `searchValue` + `onSearchChange` and places the bar where
   * it wants (typically inline with its filters to save
   * vertical space on mobile). Use with `<DataTableSearchToggle>`.
   */
  externalSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
}

/** "Select all" checkbox (component: translated label). */
function SelectAllCheckbox({ checked, onCheckedChange }: { checked: boolean | "indeterminate"; onCheckedChange: (value: boolean) => void }) {
  const t = useTranslations("common.actions");
  return <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(!!value)} aria-label={t("selectAll")} />;
}

function SelectRowCheckbox({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) {
  const t = useTranslations("common.actions");
  return <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(!!value)} aria-label={t("select")} />;
}

export function selectColumn<T>(): ColumnDef<T, unknown> {
  return {
    id: "select",
    header: ({ table }) => (
      <SelectAllCheckbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(value)}
      />
    ),
    cell: ({ row }) => (
      <SelectRowCheckbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(value)}
      />
    ),
    enableSorting: false,
    size: 40,
  };
}

export function sortableHeader(label: string) {
  return function SortableHeader({ column }: { column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc"; clearSorting: () => void } }) {
    const sorted = column.getIsSorted();
    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8"
        onClick={() => {
          if (sorted === "desc") column.clearSorting();
          else column.toggleSorting(sorted === "asc");
        }}
      >
        {label}
        {sorted === "asc" ? (
          <ArrowUp className="ml-1 h-3.5 w-3.5" />
        ) : sorted === "desc" ? (
          <ArrowDown className="ml-1 h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
        )}
      </Button>
    );
  };
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchable = true,
  searchPlaceholder: searchPlaceholderProp,
  pagination = true,
  pageSize = 30,
  onRowSelection,
  toolbar,
  className,
  isLoading,
  externalSearch = false,
  searchValue,
  onSearchChange,
}: DataTableProps<TData, TValue>) {
  const t = useTranslations("ui");
  const tCommon = useTranslations("common");
  const searchPlaceholder = searchPlaceholderProp ?? tCommon("actions.searchPlaceholder");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [internalSearch, setInternalSearch] = useState("");
  // If `externalSearch` is enabled, the value is read from props
  // (controlled by the parent). Otherwise, the internal state is used.
  const globalFilter = externalSearch ? (searchValue ?? "") : internalSearch;
  // TanStack Table may call `setGlobalFilter` with either a value
  // or an updater function. Both cases are handled.
  const setGlobalFilter = (updater: string | ((old: string) => string)) => {
    const next =
      typeof updater === "function" ? updater(globalFilter) : updater;
    if (externalSearch) onSearchChange?.(next);
    else setInternalSearch(next);
  };
  // Mobile: collapsible search bar. By default only a magnifier icon
  // is shown; on click, the input expands (auto focus).
  // If the user leaves the input with an empty value, it collapses again.
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchExpanded) searchInputRef.current?.focus();
  }, [searchExpanded]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, rowSelection },
    globalFilterFn: accentInsensitiveGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(next);
      if (onRowSelection) {
        const selectedRows = Object.keys(next)
          .filter((k) => next[k])
          .map((k) => data[parseInt(k)]);
        onRowSelection(selectedRows);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: pagination ? getPaginationRowModel() : undefined,
    initialState: { pagination: { pageSize } },
  });

  return (
    <div className={className ? className : "space-y-3"}>
      <div className="flex items-center gap-2">
        {searchable && !externalSearch && (
          <>
            {/* Desktop ≥ sm: input always visible */}
            <Input
              name="search"
              autoComplete="off"
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="hidden sm:block max-w-xs h-9"
            />
            {/* Mobile < sm: collapsible magnifier icon */}
            <div className="sm:hidden flex-1 flex items-center">
              {searchExpanded ? (
                <div className="relative w-full">
                  <Input
                    ref={searchInputRef}
                    name="search-mobile"
                    autoComplete="off"
                    placeholder={searchPlaceholder}
                    value={globalFilter}
                    onChange={(e) => setGlobalFilter(e.target.value)}
                    onBlur={() => {
                      if (!globalFilter) setSearchExpanded(false);
                    }}
                    className="h-9 pr-9"
                  />
                  <button
                    type="button"
                    aria-label={t("search.close")}
                    onClick={() => {
                      setGlobalFilter("");
                      setSearchExpanded(false);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSearchExpanded(true)}
                  aria-label={tCommon("actions.search")}
                  className="h-9 w-9"
                >
                  <Search className="h-4 w-4" />
                </Button>
              )}
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">{toolbar}</div>
      </div>

      <div className="rounded-md border flex-1 min-h-0 overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, headerIdx) => {
                  const isActions = header.id === "actions" || (!header.column.columnDef.header && headerIdx === headerGroup.headers.length - 1);
                  return (
                    <TableHead
                      key={header.id}
                      className={`sticky top-0 z-10 bg-background${isActions ? " sticky right-0 z-20 border-l" : ""}`}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => {
                    const isActions = cell.column.id === "actions";
                    return (
                      <TableCell
                        key={cell.id}
                        className={isActions ? "sticky right-0 bg-background z-10 border-l" : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {tCommon("table.noResults")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {table.getFilteredSelectedRowModel().rows.length > 0
              ? t("dataTable.selectedOf", {
                  selected: table.getFilteredSelectedRowModel().rows.length,
                  count: table.getFilteredRowModel().rows.length,
                })
              : t("dataTable.count", { count: table.getFilteredRowModel().rows.length })}
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{t("dataTable.perPage")}</span>
              <Select
                value={String(table.getState().pagination.pageSize)}
                onValueChange={(v) => table.setPageSize(Number(v))}
              >
                <SelectTrigger className="h-8 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50, 100].map((size) => (
                    <SelectItem key={size} value={String(size)} className="text-xs">
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label={tCommon("pagination.previous")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2">
                {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label={tCommon("pagination.next")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
