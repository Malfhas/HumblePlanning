"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface DataTableSearchToggleProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Max width of the desktop input. Defaults to "max-w-xs" (~ 320 px). */
  inputClassName?: string;
}

/**
 * Compact search bar meant to sit **inline with a filter
 * bar** (typically list pages with `<DataTable externalSearch>`).
 *
 * - **Desktop ≥ sm**: regular text input with `max-w-xs` width.
 * - **Mobile < sm**: a magnifier icon button; on click, the input expands
 *   in its place. If the user leaves the input with an empty value,
 *   the input collapses automatically (back to the icon).
 *
 * Groups the search with the other filters on the same
 * line instead of taking a dedicated line: vertical space saved on small
 * viewports (landscape mode especially).
 */
export function DataTableSearchToggle({
  value,
  onChange,
  placeholder: placeholderProp,
  inputClassName = "max-w-xs",
}: DataTableSearchToggleProps) {
  const t = useTranslations("ui.search");
  const tCommon = useTranslations("common.actions");
  const placeholder = placeholderProp ?? tCommon("searchPlaceholder");
  const [expanded, setExpanded] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  return (
    <>
      {/* Desktop: input always visible.
          h-8 + text-xs: vertical alignment with the surrounding filters
          (size="sm" buttons = h-8) and a more discreet font. */}
      <Input
        type="text"
        name="search"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`hidden sm:block h-8 text-xs placeholder:text-xs ${inputClassName}`}
      />

      {/* Mobile: magnifier icon → collapsible input.
          h-8 + placeholder:text-xs: matches the height of the other
          size="sm" buttons and shrinks the placeholder to stay
          discreet. The TYPED text font stays at 16 px (text-base
          from the default Input component) so iOS Safari does not
          auto-zoom when the input gets focus. */}
      <div className="sm:hidden inline-flex items-center">
        {expanded ? (
          <div className="relative">
            <Input
              ref={inputRef}
              type="text"
              name="search-mobile"
              autoComplete="off"
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => {
                if (!value) setExpanded(false);
              }}
              className="h-8 pr-8 w-[180px] placeholder:text-xs"
            />
            <button
              type="button"
              aria-label={t("close")}
              onClick={() => {
                onChange("");
                setExpanded(false);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setExpanded(true)}
            aria-label={tCommon("search")}
            className="h-8 w-8"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
      </div>
    </>
  );
}
