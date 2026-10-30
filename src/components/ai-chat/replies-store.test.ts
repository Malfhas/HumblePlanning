import { describe, expect, it } from 'bun:test';
import { isReplyInProgress, isFloatingReplyInProgress } from './replies-store';

describe('reply in progress in the floating assistant', () => {
  it('only looks at conversations that follow navigation', () => {
    expect(
      isFloatingReplyInProgress({
        tab: { inProgress: true, at: 1, floating: false },
        floating: { inProgress: false, at: 1, floating: true },
      }),
    ).toBe(false);
    expect(isFloatingReplyInProgress({ floating: { inProgress: true, at: 1, floating: true } })).toBe(
      true,
    );
  });
});

describe('reply in progress in the conversation list', () => {
  const conversation = { id: 'c1', replyInProgress: true };

  it('trusts the list as long as no more recent event contradicts it', () => {
    expect(isReplyInProgress(conversation, 1000, {})).toBe(true);
    // Event older than the load: the list already accounted for the end
    expect(
      isReplyInProgress(conversation, 1000, { c1: { inProgress: false, at: 900, floating: false } }),
    ).toBe(true);
  });

  it('turns the indicator off and on as events come, without reloading', () => {
    expect(
      isReplyInProgress(conversation, 1000, { c1: { inProgress: false, at: 1500, floating: false } }),
    ).toBe(false);
    expect(
      isReplyInProgress({ id: 'c2', replyInProgress: false }, 1000, {
        c2: { inProgress: true, at: 1500, floating: false },
      }),
    ).toBe(true);
  });
});
