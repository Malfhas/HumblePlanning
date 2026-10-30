import { describe, expect, it } from 'bun:test';
import {
  abortOutcome,
  Cadence,
  cleanTitle,
  notificationTitle,
  phaseOfChunk,
  tooManyRepliesError,
  withoutDashes,
} from './reply-logic';
import { getServerTranslatorSync } from '@/i18n/server-translator';

const fr = getServerTranslatorSync('fr');
const en = getServerTranslatorSync('en');

describe('typography safety net', () => {
  it('replaces em and en dashes with a hyphen', () => {
    expect(withoutDashes('piloter votre planning \u2014 tâches, équipes')).toBe(
      'piloter votre planning - tâches, équipes',
    );
    expect(withoutDashes('\u2014 premier point\n\u2013 second point')).toBe(
      '- premier point\n- second point',
    );
    expect(withoutDashes('de 2024\u20132026')).toBe('de 2024-2026');
  });

  it('leaves a text without em dash untouched', () => {
    const text = 'Équipe B : 37,5 h (reste à planifier)';
    expect(withoutDashes(text)).toBe(text);
  });
});

describe('phase announced by a stream chunk', () => {
  it('recognizes reasoning, tool lookup and writing', () => {
    expect(phaseOfChunk({ type: 'reasoning-delta' })).toEqual({ phase: 'thinking' });
    expect(phaseOfChunk({ type: 'tool-call', toolName: 'list-tasks' })).toEqual({
      phase: 'tools',
      tool: 'list-tasks',
    });
    expect(phaseOfChunk({ type: 'text-delta' })).toEqual({ phase: 'writing' });
  });

  it('keeps the current phase on chunks that say nothing new', () => {
    // A tool result does not hand control back: the model may call another one
    expect(phaseOfChunk({ type: 'tool-result' })).toBeNull();
    expect(phaseOfChunk({ type: 'finish-step' })).toBeNull();
    expect(phaseOfChunk({ type: 'raw' })).toBeNull();
  });
});

describe('write pacing', () => {
  it('accepts right away, then waits for the interval', () => {
    const cadence = new Cadence(1000);
    expect(cadence.isDue(10_000)).toBe(true);
    expect(cadence.isDue(10_400)).toBe(false);
    expect(cadence.isDue(10_999)).toBe(false);
    expect(cadence.isDue(11_000)).toBe(true);
    // The interval restarts from the last accepted tick, not from the last rejection
    expect(cadence.isDue(11_500)).toBe(false);
    expect(cadence.isDue(12_000)).toBe(true);
  });
});

describe('abort cause', () => {
  it('names the requested stop without explaining it', () => {
    expect(abortOutcome(true, 5)).toEqual({ status: 'CANCELLED' });
  });

  it('explains the exceeded maximum duration, in the singular and in the plural', () => {
    expect(abortOutcome(false, 1)).toEqual({
      status: 'INTERRUPTED',
      error: { code: 'aiChat.replyErrors.maxDuration', params: { minutes: 1 } },
    });
    const { error: one } = abortOutcome(false, 1);
    const { error: five } = abortOutcome(false, 5);
    expect(fr(one!.code, one!.params)).toBe('Durée maximale de 1 minute dépassée');
    expect(fr(five!.code, five!.params)).toBe('Durée maximale de 5 minutes dépassée');
    expect(en(five!.code, five!.params)).toBe('Maximum duration of 5 minutes exceeded');
  });
});

describe('messages to the user', () => {
  it('matches the refusal to the number of replies in progress (409)', () => {
    const one = tooManyRepliesError(1);
    expect(one.status).toBe(409);
    expect(one.code).toBe('aiChat.errors.tooManyReplies');
    expect(fr('aiChat.errors.tooManyReplies', one.params)).toBe('1 réponse est déjà en cours : patientez ou arrêtez-la.');
    expect(fr('aiChat.errors.tooManyReplies', tooManyRepliesError(3).params)).toBe(
      '3 réponses sont déjà en cours : patientez ou arrêtez-en une.',
    );
    expect(en('aiChat.errors.tooManyReplies', tooManyRepliesError(3).params)).toBe(
      '3 replies are already in progress: wait or stop one of them.',
    );
  });

  it('titles the notification according to the outcome', () => {
    expect(fr(notificationTitle('DONE'))).toBe("L'assistant a répondu");
    expect(fr(notificationTitle('FAILED'))).toBe("La réponse de l'assistant a échoué");
    expect(fr(notificationTitle('INTERRUPTED'))).toBe("La réponse de l'assistant a été interrompue");
    expect(en(notificationTitle('DONE'))).toBe('The assistant has replied');
  });
});

describe('automatic title', () => {
  it('reduces the model reply to a clean title', () => {
    expect(cleanTitle('« Charge équipe B ».\n')).toBe('Charge équipe B');
    expect(cleanTitle('"Tâches en retard hangar 3"')).toBe('Tâches en retard hangar 3');
    expect(cleanTitle('Titre\nDeuxième ligne ignorée')).toBe('Titre');
    expect(cleanTitle('  ')).toBe('');
    expect(cleanTitle('Reste \u2014 à planifier')).toBe('Reste - à planifier');
    expect(cleanTitle('x'.repeat(120))).toHaveLength(80);
  });
});
