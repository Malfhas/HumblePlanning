"use client";

import type { ChatStatus, UIMessage } from 'ai';
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { tDyn } from "@/i18n/dynamic";
import type { ReplyPhase } from "./replies-store";

/**
 * Three breathing dots, in the AI tools purple: the "working"
 * mark, in the thread as next to a conversation title. The
 * motion fades for those who asked for fewer animations (see app.css).
 */
export function ReplyDots({ small, className }: { small?: boolean; className?: string }) {
  return (
    <span className={cn('ia-points', small && 'ia-points--petit', className)} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/** Translator scoped to `aiChat.phase` (the one from `useTranslations`). */
type PhaseTranslator = Parameters<typeof tDyn>[0];

export function phaseLabel(t: PhaseTranslator, phase: ReplyPhase, tool?: string): string {
  const tr = t as unknown as (key: string, values?: Record<string, string>) => string;
  if (phase === 'tools') return tool ? tr('toolsNamed', { tool }) : tr('tools');
  if (phase === 'writing') return tr('writing');
  return tr('thinking');
}

/** The assistant is replying: the phase in plain words, shared by the tab and the floating assistant. */
export function ReplyIndicator({ phase, tool }: { phase: ReplyPhase; tool?: string }) {
  const t = useTranslations('aiChat.phase');
  return (
    <p className="flex items-center gap-2 text-ai-xs text-ai-muted" role="status" data-phase={phase}>
      <ReplyDots />
      <span>{phaseLabel(t, phase, tool)}</span>
    </p>
  );
}

/**
 * Phase read from the local stream, when this thread receives the reply: the
 * last part of the last reply says what the model is doing. Before the
 * first chunk, it is thinking; after a tool result, it is still
 * looking things up, until the first written word.
 */
export function localPhase(
  messages: Pick<UIMessage, 'role' | 'parts'>[],
  status: ChatStatus,
): { phase: ReplyPhase; tool?: string } | null {
  if (status !== 'submitted' && status !== 'streaming') return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return { phase: 'thinking' };
  const part = last.parts[last.parts.length - 1];
  if (!part) return { phase: 'thinking' };
  if (part.type === 'text') return { phase: 'writing' };
  if (part.type === 'reasoning') return { phase: 'thinking' };
  if (part.type === 'dynamic-tool') return { phase: 'tools', tool: part.toolName };
  if (part.type.startsWith('tool-')) {
    return { phase: 'tools', tool: part.type.slice('tool-'.length) };
  }
  return { phase: 'thinking' };
}
