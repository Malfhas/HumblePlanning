"use client";

import { useState } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronDown, Lock, Navigation, Search } from 'lucide-react';
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip } from "./ui/misc";
import { cn } from "@/lib/utils";

export interface ScopeProject {
  id: string;
  number: string;
  name: string;
}

/** Initial-letter badge, as everywhere else in the application. */
function InitialBadge({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-ai-sm text-[9px] font-bold',
        accent ? 'bg-ai-accent text-ai-on-accent' : 'bg-ai-sunken text-ai-secondary',
      )}
    >
      {text.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Conversation scope: the whole schedule, or one specific project. On the whole
 * schedule, the assistant can move from one project to another; on a project,
 * it sticks to it. In both cases the permissions remain those of
 * the user, project by project.
 */
export function ScopeSelect({
  workspace,
  projects,
  projectId,
  onChange,
  locked,
  followsNavigation,
}: {
  /** The global scope ("Whole planning", `aiChat.scope.global.name`); null if it is not offered. */
  workspace: { name: string } | null;
  projects: ScopeProject[];
  projectId: string | null;
  onChange: (projectId: string | null) => void;
  /** Lock of a started conversation: its replies rely on this scope. */
  locked?: boolean;
  /** Floating assistant conversation: the scope is the screen's, at every message. */
  followsNavigation?: boolean;
}) {
  const t = useTranslations("aiChat.scope");
  const [open, setOpen] = useState(false);
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const searchable = projects.length > 8;

  if (followsNavigation) {
    // The chip is self-explanatory: "follows navigation" reads without explanation
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-ai-md bg-ai-sunken px-2 py-1 text-ai-xs text-ai-secondary">
        <InitialBadge text={project?.number ?? workspace?.name ?? '?'} accent />
        <span className="truncate">{project?.number ?? workspace?.name ?? t('none')}</span>
        <Navigation className="size-3 shrink-0 text-ai-accent" />
        <span className="shrink-0 text-ai-muted">{t('followsNavigation')}</span>
      </span>
    );
  }

  if (locked) {
    return (
      <Tooltip content={t('lockedTooltip')}>
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-ai-md bg-ai-sunken px-2 py-1 text-ai-xs text-ai-secondary">
          <InitialBadge text={project?.number ?? workspace?.name ?? '?'} accent />
          <span className="truncate">{project?.number ?? workspace?.name ?? t('none')}</span>
          <Lock className="size-3 shrink-0 text-ai-muted" />
        </span>
      </Tooltip>
    );
  }

  const choose = (value: string | null) => {
    onChange(value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1.5 rounded-ai-md bg-ai-sunken px-2 py-1 text-ai-xs text-ai-secondary hover:text-ai-primary max-md:min-h-9"
        >
          {project ? (
            <>
              <InitialBadge text={project.number} accent />
              <span className="truncate">{project.number}</span>
            </>
          ) : workspace ? (
            <>
              <InitialBadge text={workspace.name} accent />
              <span className="truncate">{workspace.name}</span>
            </>
          ) : (
            <span className="text-ai-placeholder">{t('choose')}</span>
          )}
          <ChevronDown className="size-3 shrink-0 text-ai-muted" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" collisionPadding={8} className="w-72 p-0">
        <Command loop shouldFilter={searchable}>
          <p className="px-3 pb-1 pt-2 text-[11px] text-ai-muted">{t('useDataFrom')}</p>
          {searchable ? (
            <div className="mx-1.5 flex items-center gap-1.5 rounded-ai-sm border border-ai-border-subtle bg-ai-sunken px-2">
              <Search className="size-3.5 shrink-0 text-ai-placeholder" strokeWidth={1.5} />
              <Command.Input
                placeholder={t('searchProject')}
                className="w-full bg-transparent py-1 text-ai-xs text-ai-primary outline-none placeholder:text-ai-placeholder max-md:text-base"
              />
            </div>
          ) : null}

          <Command.List className="max-h-64 overflow-y-auto p-1.5">
            <Command.Empty className="px-1.5 py-1 text-ai-xs italic text-ai-placeholder">
              {t('noProject')}
            </Command.Empty>

            {workspace ? (
              <Command.Item
                value={`${t('global.name')} ${workspace.name}`}
                data-tooltip-row="auto"
                onSelect={() => choose(null)}
                className={cn(
                  'flex cursor-pointer select-none items-center gap-2 rounded-ai-sm px-1.5 py-1.5 text-ai-sm max-md:py-2.5',
                  'data-[selected=true]:bg-ai-surface-hover',
                  projectId ? 'text-ai-secondary' : 'text-ai-primary',
                )}
              >
                <InitialBadge text={workspace.name} accent />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{workspace.name}</span>
                  <span className="truncate text-ai-xs text-ai-muted">
                    {t('global.description')}
                  </span>
                </span>
                {projectId ? null : <Check className="size-3.5 shrink-0" />}
              </Command.Item>
            ) : null}

            <Command.Group
              heading={t('projects')}
              className="[&_[cmdk-group-heading]]:px-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ai-muted"
            >
              {projects.map((candidate) => (
                <Command.Item
                  key={candidate.id}
                  data-tooltip-row="auto"
                  value={`${candidate.number} ${candidate.name}`}
                  onSelect={() => choose(candidate.id)}
                  className={cn(
                    'flex cursor-pointer select-none items-center gap-2 rounded-ai-sm px-1.5 py-1.5 text-ai-sm max-md:py-2.5',
                    'data-[selected=true]:bg-ai-surface-hover',
                    candidate.id === projectId ? 'text-ai-primary' : 'text-ai-secondary',
                  )}
                >
                  <InitialBadge text={candidate.number} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{candidate.number}</span>
                    <span className="truncate text-ai-xs text-ai-muted">{candidate.name}</span>
                  </span>
                  {candidate.id === projectId ? <Check className="size-3.5 shrink-0" /> : null}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
