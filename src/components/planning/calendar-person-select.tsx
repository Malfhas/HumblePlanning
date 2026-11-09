"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useUsers } from "@/hooks/use-users";
import { useBuStore } from "@/stores/bu-store";
import { cn } from "@/lib/utils";
import { CALENDAR_EVERYONE } from "@/lib/utils/calendar-view";

export interface CalendarPerson {
  id: string;
  name: string;
  firstName?: string | null;
  /** "First name Last name", already composed by the users API. */
  displayName?: string | null;
  image?: string | null;
  color?: string | null;
}

/**
 * People the calendar can show: the users the signed-in user may see (scoped by
 * the users API), limited to the business units selected in the header.
 */
export function useCalendarPeople(): CalendarPerson[] | undefined {
  const { data: users } = useUsers(undefined, true);
  const selectedBuIds = useBuStore((s) => s.selectedBuIds);
  return useMemo(() => {
    if (selectedBuIds.length === 0 || !users) return users;
    return users.filter((u) => u.businessUnitId && selectedBuIds.includes(u.businessUnitId));
  }, [users, selectedBuIds]);
}

/** "First name Last name" (the API composes it; fallback for older payloads). */
function fullName(person: CalendarPerson): string {
  return person.displayName || [person.firstName, person.name].filter(Boolean).join(" ") || person.name;
}

interface CalendarPersonSelectProps {
  people: CalendarPerson[] | undefined;
  /** Person shown by the calendar, or `CALENDAR_EVERYONE`. */
  value: string | null;
  currentUserId: string | null;
  onChange: (personId: string) => void;
  className?: string;
}

/**
 * Person shown by the calendar view: photo (or colored initials) and first
 * name + last name, in the trigger as in the list, like the user pickers of
 * the projects. Search on first and last name. "All users" first, for whoever
 * may see someone else, then the signed-in user.
 */
export function CalendarPersonSelect({ people, value, currentUserId, onChange, className }: CalendarPersonSelectProps) {
  const t = useTranslations("planning.toolbar.calendar");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);

  const sorted = useMemo(() => {
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    return [...(people ?? [])].sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      return collator.compare(fullName(a), fullName(b));
    });
  }, [people, currentUserId]);

  // "All users": only for whoever can already pick someone else
  const canPickOthers = sorted.some((p) => p.id !== currentUserId);
  const everyone = value === CALENDAR_EVERYONE && canPickOthers;
  const selected = everyone ? undefined : sorted.find((p) => p.id === (value === CALENDAR_EVERYONE ? currentUserId : value));

  // Keeps the wheel inside the list (Radix scroll lock of the page)
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={t("person")}
          data-calendar-person
          className={cn("h-8 w-[220px] max-w-full justify-start gap-2 px-2 text-xs font-normal", className)}
        >
          {everyone ? (
            <EveryoneIcon className="size-5 [&_svg]:size-3" />
          ) : selected ? (
            <UserAvatar user={{ name: fullName(selected), image: selected.image, color: selected.color }} className="size-5" fallbackClassName="text-[9px]" />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-left">
            {everyone ? t("everyone") : selected ? fullName(selected) : t("selectUser")}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start" onWheel={handleWheel}>
        <Command>
          <CommandInput placeholder={tCommon("actions.searchPlaceholder")} />
          <CommandList onWheel={handleWheel}>
            <CommandEmpty>{t("noUser")}</CommandEmpty>
            <CommandGroup>
              {canPickOthers && (
                <CommandItem
                  value={CALENDAR_EVERYONE}
                  keywords={[t("everyone")]}
                  onSelect={() => {
                    onChange(CALENDAR_EVERYONE);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <EveryoneIcon className="size-6 [&_svg]:size-3.5" />
                  <span className="min-w-0 flex-1 truncate">{t("everyone")}</span>
                  <Check className={cn("size-4 shrink-0", everyone ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              )}
              {sorted.map((person) => {
                const name = fullName(person);
                return (
                  <CommandItem
                    key={person.id}
                    value={person.id}
                    keywords={[name, person.firstName ?? "", person.name]}
                    onSelect={() => {
                      onChange(person.id);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <UserAvatar user={{ name, image: person.image, color: person.color }} className="size-6" fallbackClassName="text-[10px]" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {person.id === currentUserId && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">{t("me")}</span>
                    )}
                    <Check className={cn("size-4 shrink-0", !everyone && selected?.id === person.id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Round mark of "All users", sized like the avatars. */
function EveryoneIcon({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary", className)} aria-hidden>
      <Users />
    </span>
  );
}
