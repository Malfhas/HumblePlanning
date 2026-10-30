import { describe, expect, it } from 'bun:test';
import {
  formatQuotaDate,
  ledgerPurgeThreshold,
  localMidnight,
  nextReset,
  periodStart,
  quotaPercentage,
  quotaReachedError,
} from './quota';
import { getServerTranslatorSync } from '@/i18n/server-translator';

/** The refusal as `handleApiError` returns it in the given language. */
const refusal = (error: ReturnType<typeof quotaReachedError>, locale: 'fr' | 'en' = 'fr') =>
  getServerTranslatorSync(locale)('aiChat.errors.quotaReached', error.params as { date: string });

/** Readable UTC instant: « 2026-08-31T22:00:00.000Z » is midnight in Paris on September 1st (summer time). */
const iso = (date: Date) => date.toISOString();

describe('midnight in Paris', () => {
  it('accounts for summer and winter time', () => {
    expect(iso(localMidnight(2026, 9, 1))).toBe('2026-08-31T22:00:00.000Z');
    expect(iso(localMidnight(2026, 1, 5))).toBe('2026-01-04T23:00:00.000Z');
  });

  it('lets the month overflow into the neighbouring year', () => {
    expect(iso(localMidnight(2026, 0, 5))).toBe('2025-12-04T23:00:00.000Z');
    expect(iso(localMidnight(2026, 13, 5))).toBe('2027-01-04T23:00:00.000Z');
  });
});

describe('start of the current period', () => {
  const noReset = { resetAt: null, userResetAt: null };

  it('starts from the last occurrence of the configured day', () => {
    const start = periodStart({
      now: new Date('2026-08-30T10:00:00Z'),
      day: 1,
      ...noReset,
    });
    expect(iso(start)).toBe('2026-07-31T22:00:00.000Z');
  });

  it('goes back to the previous month when the configured day has not passed yet', () => {
    const start = periodStart({
      now: new Date('2026-08-03T10:00:00Z'),
      day: 15,
      ...noReset,
    });
    expect(iso(start)).toBe('2026-07-14T22:00:00.000Z');
  });

  it('starts at midnight on the day itself when today is the configured day', () => {
    const start = periodStart({
      now: new Date('2026-09-01T05:00:00Z'),
      day: 1,
      ...noReset,
    });
    expect(iso(start)).toBe('2026-08-31T22:00:00.000Z');
  });

  it('reads the current day in Paris time, not in UTC', () => {
    // 22:30 UTC on August 31st is already September 1st in Paris
    expect(
      iso(periodStart({ now: new Date('2026-08-31T22:30:00Z'), day: 1, ...noReset })),
    ).toBe('2026-08-31T22:00:00.000Z');
    // One hour earlier, it is still August 31st
    expect(
      iso(periodStart({ now: new Date('2026-08-31T21:30:00Z'), day: 1, ...noReset })),
    ).toBe('2026-07-31T22:00:00.000Z');
  });

  it('restarts from a global reset more recent than the configured day', () => {
    const start = periodStart({
      now: new Date('2026-08-30T10:00:00Z'),
      day: 1,
      resetAt: new Date('2026-08-20T08:00:00Z'),
      userResetAt: null,
    });
    expect(iso(start)).toBe('2026-08-20T08:00:00.000Z');
  });

  it('restarts from the account-specific reset when it is the most recent', () => {
    const start = periodStart({
      now: new Date('2026-08-30T10:00:00Z'),
      day: 1,
      resetAt: new Date('2026-08-20T08:00:00Z'),
      userResetAt: new Date('2026-08-25T09:00:00Z'),
    });
    expect(iso(start)).toBe('2026-08-25T09:00:00.000Z');
  });

  it('ignores a reset earlier than the configured day', () => {
    const start = periodStart({
      now: new Date('2026-08-30T10:00:00Z'),
      day: 1,
      resetAt: new Date('2026-07-10T08:00:00Z'),
      userResetAt: new Date('2026-07-20T08:00:00Z'),
    });
    expect(iso(start)).toBe('2026-07-31T22:00:00.000Z');
  });

  it('crosses the year boundary', () => {
    const start = periodStart({
      now: new Date('2026-01-03T10:00:00Z'),
      day: 5,
      ...noReset,
    });
    expect(iso(start)).toBe('2025-12-04T23:00:00.000Z');
  });
});

describe('next reset', () => {
  it('targets the next occurrence of the configured day', () => {
    expect(iso(nextReset(new Date('2026-08-30T10:00:00Z'), 1))).toBe(
      '2026-08-31T22:00:00.000Z',
    );
    expect(iso(nextReset(new Date('2026-08-03T10:00:00Z'), 15))).toBe(
      '2026-08-14T22:00:00.000Z',
    );
  });

  it('on the day itself, the next one is a month later', () => {
    expect(iso(nextReset(new Date('2026-09-01T05:00:00Z'), 1))).toBe(
      '2026-09-30T22:00:00.000Z',
    );
  });

  it('moves to the next year in December', () => {
    expect(iso(nextReset(new Date('2026-12-20T10:00:00Z'), 5))).toBe(
      '2027-01-04T23:00:00.000Z',
    );
  });

  it('does not depend on a manual reset', () => {
    // The reset moves the period start forward, not the displayed date
    const now = new Date('2026-08-30T10:00:00Z');
    expect(formatQuotaDate(nextReset(now, 1))).toBe('01/09/2026');
  });
});

describe('displayed date', () => {
  it('is written in French, in Paris time', () => {
    expect(formatQuotaDate(new Date('2026-08-31T22:00:00.000Z'))).toBe('01/09/2026');
    expect(formatQuotaDate(new Date('2026-08-31T21:59:00.000Z'))).toBe('31/08/2026');
  });

  it('follows the user language (en-GB: day/month/year as well)', () => {
    expect(formatQuotaDate(new Date('2026-08-31T22:00:00.000Z'), 'Europe/Paris', 'en')).toBe('01/09/2026');
  });
});

describe('quota percentage', () => {
  it('rounds down and caps at 100', () => {
    expect(quotaPercentage(0, 5)).toBe(0);
    expect(quotaPercentage(3.5, 5)).toBe(70);
    expect(quotaPercentage(4.999, 5)).toBe(99);
    expect(quotaPercentage(5, 5)).toBe(100);
    expect(quotaPercentage(7.25, 5)).toBe(100);
  });

  it('is zero without an amount', () => {
    expect(quotaPercentage(12, 0)).toBe(0);
  });
});

describe('refusal message', () => {
  it('gives the next reset date, word for word (403)', () => {
    const error = quotaReachedError(new Date('2026-08-31T22:00:00.000Z'));
    expect(error.status).toBe(403);
    expect(refusal(error)).toBe(
      'Votre quota mensuel du chat IA est atteint : il sera réinitialisé le 01/09/2026.',
    );
    expect(refusal(quotaReachedError(new Date('2026-08-31T22:00:00.000Z'), 'Europe/Paris', 'en'), 'en')).toBe(
      'Your monthly AI chat quota has been reached: it will reset on 01/09/2026.',
    );
  });
});

describe('ledger purge threshold', () => {
  it('never goes past the start of the current period', () => {
    const start = new Date('2026-08-31T22:00:00.000Z');
    // Short retention: the limit would fall inside the period, the start holds it back
    expect(iso(ledgerPurgeThreshold(new Date('2026-09-10T00:00:00Z'), start))).toBe(
      '2026-08-31T22:00:00.000Z',
    );
    // Long retention: the limit is earlier, it applies as is
    expect(iso(ledgerPurgeThreshold(new Date('2025-08-01T00:00:00Z'), start))).toBe(
      '2025-08-01T00:00:00.000Z',
    );
  });
});

describe('instance time zone (configurable)', () => {
  it('midnight in New York, summer and winter time', () => {
    expect(iso(localMidnight(2026, 9, 1, 'America/New_York'))).toBe('2026-09-01T04:00:00.000Z');
    expect(iso(localMidnight(2026, 1, 5, 'America/New_York'))).toBe('2026-01-05T05:00:00.000Z');
  });

  it('reads the current day in the configured time zone', () => {
    // 02:00 UTC on September 1st: still August 31st in New York
    const now = new Date('2026-09-01T02:00:00Z');
    expect(iso(periodStart({ now, day: 1, resetAt: null, userResetAt: null, timeZone: 'America/New_York' }))).toBe(
      '2026-08-01T04:00:00.000Z',
    );
    expect(iso(nextReset(now, 1, 'America/New_York'))).toBe('2026-09-01T04:00:00.000Z');
  });

  it('crosses the switch to winter time (Paris, 25 October 2026)', () => {
    expect(iso(localMidnight(2026, 10, 25))).toBe('2026-10-24T22:00:00.000Z');
    expect(iso(localMidnight(2026, 10, 26))).toBe('2026-10-25T23:00:00.000Z');
  });

  it('displayed date and refusal message in the configured time zone', () => {
    expect(formatQuotaDate(new Date('2026-09-01T02:00:00Z'), 'America/New_York')).toBe('31/08/2026');
    expect(refusal(quotaReachedError(new Date('2026-09-01T04:00:00Z'), 'America/New_York'))).toContain('01/09/2026');
  });
});
