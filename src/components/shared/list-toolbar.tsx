import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ListToolbarProps {
  /** Left side: filter icon, filters, search, clear button, counter. */
  children?: ReactNode;
  /** Right side: page actions (Add, Import, Purge…). Use `size="sm"` buttons (h-8, like the filters). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Single toolbar row placed between a list page title and its table:
 * filters and search on the left, page actions on the right.
 *
 * The left side has a zero flex-basis, so the actions always stay right-aligned
 * beside the filters; when space runs out (mobile), the filters wrap inside the
 * left side instead. `items-end` keeps the actions on the last line of filters,
 * right above the table they act on.
 */
export function ListToolbar({ children, actions, className }: ListToolbarProps) {
  return (
    <div data-slot="list-toolbar" className={cn("flex flex-wrap items-end gap-2", className)}>
      <div data-slot="list-toolbar-filters" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
      {!!actions && (
        <div data-slot="list-toolbar-actions" className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
