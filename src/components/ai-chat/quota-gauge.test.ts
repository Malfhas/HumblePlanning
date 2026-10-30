// The reset date is shown in the browser time zone: the original project's one for the test
process.env.TZ = 'Europe/Paris';

import { describe, expect, it } from 'bun:test';
import { quotaColor, quotaText } from './quota-gauge';
import { getServerTranslatorSync } from '@/i18n/server-translator';

/** The screen's `aiChat.quota` translator, rebuilt for one language. */
const translator = (locale: 'fr' | 'en') => {
  const t = getServerTranslatorSync(locale) as unknown as (k: string, v?: Record<string, unknown>) => string;
  return ((k: string, v?: Record<string, unknown>) => t(`aiChat.quota.${k}`, v)) as unknown as Parameters<typeof quotaText>[1];
};
const QUOTA = { enabled: true, unlimited: false, percent: 42, reached: false, resetsAt: '2026-08-31T22:00:00.000Z' };

describe('quota gauge color', () => {
  it('stays green up to 69%', () => {
    expect(quotaColor(0)).toBe('success');
    expect(quotaColor(42)).toBe('success');
    expect(quotaColor(69)).toBe('success');
  });

  it('turns orange from 70 to 89%', () => {
    expect(quotaColor(70)).toBe('warning');
    expect(quotaColor(89)).toBe('warning');
  });

  it('turns red from 90%, up to full', () => {
    expect(quotaColor(90)).toBe('danger');
    expect(quotaColor(100)).toBe('danger');
  });
});

describe('gauge tooltip', () => {
  it('gives the percentage and the reset date, on two lines', () => {
    expect(quotaText(QUOTA, translator('fr'), 'fr-FR')).toBe('42 % du quota mensuel utilisé\nRéinitialisation le 01/09/2026');
    expect(quotaText(QUOTA, translator('en'), 'en-GB')).toBe('42% of the monthly quota used\nResets on 01/09/2026');
  });

  it('says nothing more than "unlimited" for an exempt account', () => {
    expect(quotaText({ ...QUOTA, unlimited: true, percent: 100, reached: true }, translator('fr'), 'fr-FR')).toBe('Quota illimité');
  });
});
