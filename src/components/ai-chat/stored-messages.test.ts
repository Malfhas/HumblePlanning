import { describe, expect, it } from 'bun:test';
import type { UIMessage } from 'ai';
import { forModel, mergeContinuations, restoredParts } from './lib/stored-messages';
import { toolSummary } from './lib/tool-summary';

type Part = UIMessage['parts'][number];

describe('restoredParts: a reply re-read is drawn as it was seen', () => {
  it('without kept steps: its text, or nothing', () => {
    expect(restoredParts(null, 'Bonjour')).toEqual([{ type: 'text', text: 'Bonjour' }]);
    expect(restoredParts(undefined, '  ')).toEqual([]);
  });

  it('keeps the reasoning and the tools; a write left without outcome is no longer a decision to take', () => {
    const parts = restoredParts(
      [
        { type: 'reasoning', text: 'Je cherche.', state: 'streaming' },
        { type: 'tool-list-users', toolCallId: 'c1', state: 'output-available', input: {}, output: [] } as unknown as Part,
        {
          type: 'tool-create-task',
          toolCallId: 'c2',
          state: 'approval-requested',
          input: { title: 'RTT' },
          approval: { id: 'a1' },
        } as unknown as Part,
        { type: 'text', text: 'Je crée la tâche.' },
      ],
      'Je crée la tâche.',
    ) as (Part & { state?: string })[];
    expect(parts.map((part) => part.type)).toEqual(['reasoning', 'tool-list-users', 'tool-create-task', 'text']);
    expect(parts[0].state).toBe('done');
    expect(parts[2].state).toBe('output-available');
  });
});

describe('forModel: the history sent back', () => {
  it('a re-read message goes back as its text; one without text is left out; the others as they are', () => {
    const live: UIMessage = { id: 'live', role: 'user', parts: [{ type: 'text', text: 'Et demain ?' }] };
    const messages: UIMessage[] = [
      {
        id: 'a',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: '…', state: 'done' }, { type: 'text', text: 'Réponse' }],
        metadata: { stored: true, text: 'Réponse' },
      },
      { id: 'b', role: 'assistant', parts: [{ type: 'reasoning', text: '…', state: 'done' }], metadata: { stored: true, text: '' } },
      live,
    ];
    expect(forModel(messages)).toEqual([
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Réponse' }], metadata: { stored: true, text: 'Réponse' } },
      live,
    ]);
  });
});

describe('mergeContinuations: the reply after an approval completes the one that asked for it', () => {
  const proposal = { type: 'tool-create-task', toolCallId: 'c1', state: 'output-available', input: { title: 'RTT' } } as unknown as Part;
  const executed = { ...proposal, output: { id: 'task-1' } } as unknown as Part;
  const asked: UIMessage = {
    id: 'a1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Je crée la tâche.' }, proposal],
    metadata: { stored: true, text: 'Je crée la tâche.' },
  };
  const continued: UIMessage = {
    id: 'a2',
    role: 'assistant',
    parts: [executed, { type: 'text', text: 'C’est fait.' }],
    metadata: { stored: true, text: 'C’est fait.' },
  };

  it('one message, the write with its outcome in place, then the rest', () => {
    const [merged, ...rest] = mergeContinuations([asked, continued]);
    expect(rest).toEqual([]);
    expect(merged.id).toBe('a1');
    expect(merged.parts).toEqual([{ type: 'text', text: 'Je crée la tâche.' }, executed, { type: 'text', text: 'C’est fait.' }]);
    expect(merged.metadata).toEqual({ stored: true, text: 'Je crée la tâche.\n\nC’est fait.' });
  });

  it('two replies without a shared tool stay apart, a question in between too', () => {
    const regenerated: UIMessage = { id: 'a3', role: 'assistant', parts: [{ type: 'text', text: 'Autre' }] };
    expect(mergeContinuations([asked, regenerated])).toHaveLength(2);
    const question: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: '?' }] };
    expect(mergeContinuations([asked, question, continued])).toHaveLength(3);
  });
});

describe('toolSummary', () => {
  it('each tool once, in the order of its first call, with its count', () => {
    expect(toolSummary(['list-users', 'list-users', 'get-user-schedule', 'list-users', 'list-holidays', 'list-users'])).toBe(
      'list-users ×4, get-user-schedule, list-holidays',
    );
    expect(toolSummary(['list-tasks'])).toBe('list-tasks');
  });
});
