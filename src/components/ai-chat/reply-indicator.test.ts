import { describe, expect, it } from 'bun:test';
import { phaseLabel, localPhase } from './reply-indicator';
import { getServerTranslatorSync } from '@/i18n/server-translator';

/** The screen's `aiChat.phase` translator, rebuilt for one language. */
const translator = (locale: 'fr' | 'en') => {
  const t = getServerTranslatorSync(locale) as unknown as (k: string, v?: Record<string, unknown>) => string;
  return ((k: string, v?: Record<string, unknown>) => t(`aiChat.phase.${k}`, v)) as unknown as Parameters<typeof phaseLabel>[0];
};
const fr = translator('fr');

describe('phase read from the local stream', () => {
  it('stays silent when nothing is being written', () => {
    expect(localPhase([], 'ready')).toBeNull();
    expect(localPhase([], 'error')).toBeNull();
  });

  it('thinks as long as the reply has not started', () => {
    expect(localPhase([{ role: 'user', parts: [] }], 'submitted')).toEqual({ phase: 'thinking' });
  });

  it('follows the last part of the reply', () => {
    const reply = (type: string) => [{ role: 'assistant' as const, parts: [{ type } as never] }];
    expect(localPhase(reply('reasoning'), 'streaming')).toEqual({ phase: 'thinking' });
    expect(localPhase(reply('tool-list-tasks'), 'streaming')).toEqual({
      phase: 'tools',
      tool: 'list-tasks',
    });
    expect(localPhase(reply('text'), 'streaming')).toEqual({ phase: 'writing' });
  });
});

describe('phase label', () => {
  it('names the tool being looked up when it is known', () => {
    expect(phaseLabel(fr, 'tools', 'get-project-status')).toContain('get-project-status');
    expect(phaseLabel(fr, 'tools')).toBe('L’assistant consulte les données…');
    expect(phaseLabel(fr, 'writing')).toBe('L’assistant rédige…');
    expect(phaseLabel(translator('en'), 'thinking')).toBe('The assistant is thinking…');
  });
});
