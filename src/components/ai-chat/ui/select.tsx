"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/**
 * Custom select (verified Plane pattern): trigger button + panel with
 * built-in search, check to the right of the selected item, keyboard via cmdk.
 * Replaces ALL native <select> elements.
 */

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  /**
   * Detail rendered after the label, in the list only (the closed button
   * shows only `label`): a remainder, a counter…
   */
  complement?: ReactNode;
  disabled?: boolean;
}

/* On phone, every trigger is a finger tall. */
const triggerVariants = {
  /* Full-width form field */
  field:
    'flex h-8 w-full items-center justify-between gap-1.5 rounded-ai-md border-[0.5px] border-ai-border-default bg-ai-surface px-2.5 text-ai-sm text-ai-primary hover:bg-ai-surface-hover data-[state=open]:border-ai-border-focus max-md:h-10',
  /* Property chip (20px, thin border) */
  chip: 'inline-flex h-5 max-w-full items-center gap-1.5 rounded-ai-sm border-[0.5px] border-ai-border-strong px-2 text-ai-xs text-ai-secondary hover:bg-ai-surface-hover data-[state=open]:bg-ai-selected max-md:h-9',
  /* Ghost (toolbars) */
  ghost:
    'inline-flex h-6 items-center gap-1 rounded-ai-md px-2 text-ai-xs text-ai-secondary hover:bg-ai-surface-hover data-[state=open]:bg-ai-selected max-md:h-9',
} as const;

/** On phone, no panel overflows the screen, whatever the list. */
const MOBILE_PANEL = 'max-md:max-w-[calc(100vw-1rem)]';

/**
 * Wide panel, for lists with long labels (tasks, work packages, people):
 * it takes the width of its longest label, between 380 and 520 px, without
 * exceeding what the screen leaves (variable set by Radix).
 */
export const WIDE_PANEL =`w-max min-w-[min(380px,var(--radix-popover-content-available-width,100vw))] max-w-[min(520px,var(--radix-popover-content-available-width,100vw))] ${MOBILE_PANEL}`;

/**
 * Default panel width, everywhere: that of the longest label, at least
 * that of the button (and 13 rem so the search has room), at most 520 px or
 * what the screen leaves. A fixed 13 rem width cut the labels of
 * every list on the site; a label still cut is read in the tooltip.
 */
const DEFAULT_PANEL = `w-max min-w-[max(13rem,var(--radix-popover-trigger-width))] max-w-[min(520px,var(--radix-popover-content-available-width,100vw))] ${MOBILE_PANEL}`;

interface SelectPanelProps {
  options: SelectOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  selectedValues: string[];
  onPick: (value: string) => void;
  footer?: ReactNode;
}

/** The cmdk value of an option: what the search filters on and the keyboard tracks. */
const cmdkValue = (option: SelectOption) =>
  // i18n-ignore concatenation of two already translated texts (cmdk search value)
  option.description ? `${option.label} ${option.description}` : option.label;

/** Panel shared by Select/MultiSelect - Plane recipe (search in a bordered box, 13px list). */
function SelectPanel({
  options,
  searchable,
  searchPlaceholder,
  emptyText,
  selectedValues,
  onPick,
  footer,
}: SelectPanelProps) {
  const t = useTranslations("aiChat.select");
  const tc = useTranslations("common");
  const listRef = useRef<HTMLDivElement>(null);
  const chosen = options.find((option) => selectedValues.includes(option.value));
  /**
   * On open, the value already chosen is in sight: highlighted
   * (keyboard included) and scrolled into view, instead of falling back to the top
   * of the list. The panel mounts on every open, so the effect runs each time.
   */
  useEffect(() => {
    listRef.current?.querySelector('[data-choisie]')?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <Command
      loop
      shouldFilter={searchable !== false}
      defaultValue={chosen ? cmdkValue(chosen) : undefined}
    >
      {searchable !== false && options.length > 6 ? (
        <div className="mx-1.5 mt-1.5 flex items-center gap-1.5 rounded-ai-sm border border-ai-border-subtle bg-ai-sunken px-2">
          <Search className="size-3.5 shrink-0 text-ai-placeholder" strokeWidth={1.5} />
          <Command.Input
            placeholder={searchPlaceholder ?? tc("actions.searchPlaceholder")}
            className="w-full bg-transparent py-1 text-ai-xs text-ai-primary outline-none placeholder:text-ai-placeholder max-md:py-2 max-md:text-base"
          />
        </div>
      ) : null}
      <Command.List ref={listRef}className="max-h-56 overflow-y-auto p-1.5">
        <Command.Empty className="px-1.5 py-1 text-ai-xs italic text-ai-placeholder">
          {emptyText ?? tc("states.noResults")}
        </Command.Empty>
        {options.map((option) => {
          const selected = selectedValues.includes(option.value);
          return (
            <Command.Item
              key={option.value}
              value={cmdkValue(option)}
              data-choisie={selected ? '' : undefined}
              disabled={option.disabled}
              onSelect={() => onPick(option.value)}
              className={cn(
                'flex cursor-pointer select-none items-center gap-2 rounded-ai-sm px-1.5 py-1.5 text-ai-sm max-md:min-h-10',
                'data-[selected=true]:bg-ai-surface-hover',
                selected ? 'text-ai-primary' : 'text-ai-secondary',
                option.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {option.icon ? (
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {option.icon}
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col">
                {/*
                  No `title`: the site tooltip reads any truncated text on
                  its own, above the menu layer, and stays silent precisely under a
                  `title` so as not to double the native tooltip, which took a
                  second to come.
                */}
                <span className="truncate">
                  {option.label}
                  {option.complement}
                </span>
                {option.description ? (
                  <span className="truncate text-ai-xs text-ai-muted">{option.description}</span>
                ) : null}
              </span>
              {selected ? <Check className="size-3.5 shrink-0" /> : null}
            </Command.Item>
          );
        })}
      </Command.List>
      {footer}
    </Command>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  variant = 'field',
  searchable,
  clearable,
  disabled,
  buttonClassName,
  panelClassName,
  align = 'start',
  renderValue,
  'aria-label': ariaLabel,
}: {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  variant?: keyof typeof triggerVariants;
  searchable?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  buttonClassName?: string;
  panelClassName?: string;
  align?: 'start' | 'center' | 'end';
  /** Custom rendering of the value in the button (default: icon + label). */
  renderValue?: (option: SelectOption) => ReactNode;
  /** Accessible name of the trigger, when its value alone does not say what it sets. */
  'aria-label'?: string;
}) {
  const t = useTranslations("aiChat.select");
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            triggerVariants[variant],
            disabled && 'cursor-not-allowed opacity-60',
            buttonClassName,
          )}
        >
          <span
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 truncate text-left',
              !selected && 'text-ai-placeholder',
            )}
          >
            {selected ? (
              renderValue ? (
                renderValue(selected)
              ) : (
                <>
                  {selected.icon ? (
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {selected.icon}
                    </span>
                  ) : null}
                  <span className="truncate">{selected.label}</span>
                </>
              )
            ) : (
              (placeholder ?? t('placeholder'))
            )}
          </span>
          {clearable && selected && !disabled ? (
            <X
              className="size-2.5 shrink-0 text-ai-muted hover:text-ai-primary"
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onValueChange('');
              }}
            />
          ) : null}
          <ChevronDown
            className={cn('shrink-0 text-ai-muted', variant === 'field' ? 'size-3.5' : 'size-3')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn('p-0', panelClassName ?? DEFAULT_PANEL)}>
        <SelectPanel
          options={options}
          searchable={searchable}
          selectedValues={selected ? [selected.value] : []}
          onPick={(picked) => {
            onValueChange(picked);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function MultiSelect({
  values,
  onValuesChange,
  options,
  placeholder,
  variant = 'field',
  searchable = true,
  disabled,
  buttonClassName,
  panelClassName,
  align = 'start',
  renderTrigger,
  selectAllToggle = false,
}: {
  values: string[];
  onValuesChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  variant?: keyof typeof triggerVariants;
  searchable?: boolean;
  disabled?: boolean;
  buttonClassName?: string;
  panelClassName?: string;
  align?: 'start' | 'center' | 'end';
  /** Custom rendering of the closed button (e.g. avatar stack). */
  renderTrigger?: (selected: SelectOption[]) => ReactNode;
  /** Adds a "Select all / Deselect all" toggle at the bottom of the list. */
  selectAllToggle?: boolean;
}) {
  const t = useTranslations("aiChat.select");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const selected = options.filter((o) => values.includes(o.value));

  const toggle = (value: string) => {
    onValuesChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  };
  const allSelected =
    options.length > 0 && options.every((option) => values.includes(option.value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            triggerVariants[variant],
            disabled && 'cursor-not-allowed opacity-60',
            buttonClassName,
          )}
        >
          {renderTrigger ? (
            renderTrigger(selected)
          ) : (
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left',
                !selected.length && 'text-ai-placeholder',
              )}
            >
              {selected.length === 0
                ? (placeholder ?? t('placeholder'))
                : selected.length === 1
                  ? selected[0]!.label
                  : t('selectedCount', { count: selected.length })}
            </span>
          )}
          <ChevronDown
            className={cn('shrink-0 text-ai-muted', variant === 'field' ? 'size-3.5' : 'size-3')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={cn('p-0', panelClassName ?? DEFAULT_PANEL)}>
        <SelectPanel
          options={options}
          searchable={searchable}
          selectedValues={values}
          onPick={toggle}
          footer={
            selectAllToggle && options.length ? (
              <div className="border-t border-ai-border-subtle p-1">
                <button
                  type="button"
                  className="w-full rounded-ai-sm px-1.5 py-1 text-left text-ai-xs text-ai-link hover:bg-ai-surface-hover"
                  onClick={() =>
                    onValuesChange(allSelected ? [] : options.map((option) => option.value))
                  }
                >
                  {allSelected ? tc("actions.deselectAll") : tc("actions.selectAll")}
                </button>
              </div>
            ) : null
          }
        />
      </PopoverContent>
    </Popover>
  );
}
