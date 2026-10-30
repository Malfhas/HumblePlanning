import { describe, expect, it } from 'bun:test';
import { shouldNotify, canBeOffered } from './use-reply-notification';

describe('notification switch', () => {
  it('is offered neither without a possible permission, nor after a refusal', () => {
    expect(canBeOffered('unavailable')).toBe(false);
    // A refusal is final: asking again is impossible, offering it would be a lie
    expect(canBeOffered('denied')).toBe(false);
    expect(canBeOffered('default')).toBe(true);
    expect(canBeOffered('granted')).toBe(true);
  });
});

describe('decision to notify', () => {
  it('warns when the tab is in the background', () => {
    expect(shouldNotify('granted', true, 'hidden')).toBe(true);
  });

  it('stays silent in front of a watched tab', () => {
    expect(shouldNotify('granted', true, 'visible')).toBe(false);
  });

  it('stays silent as long as the user has asked for nothing', () => {
    expect(shouldNotify('granted', false, 'hidden')).toBe(false);
  });

  it('stays silent if the permission was revoked since', () => {
    // Preference kept on the device, permission revoked in the browser
    expect(shouldNotify('default', true, 'hidden')).toBe(false);
    expect(shouldNotify('denied', true, 'hidden')).toBe(false);
  });
});
