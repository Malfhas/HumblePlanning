"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { useTranslations } from 'next-intl';

/**
 * Browser notification when the assistant has finished replying.
 *
 * A deep analysis takes the time it takes: you ask the question, you
 * go do something else, and the reply gets lost in a tab you no longer
 * look at. Two rules govern this whole file:
 *
 * - permission is only requested from an explicit gesture. A spontaneous request on
 *   load is ignored by Chrome and penalized by Firefox; above all, a
 *   refusal is final - the browser never asks again. So there is
 *   only one shot, to fire only when the user understands
 *   what they grant;
 * - we only notify if the tab is in the background. Warning someone who
 *   is already watching the reply being written is just noise.
 */

/**
 * Preference kept on the device: it only affects reading comfort, and
 * the permission it relates to already belongs to this browser.
 */
const PREFERENCE_KEY = 'ai-chat:notifications';

/** Shared tag: a reply replaces the previous one instead of piling up. */
const NOTIFICATION_TAG = 'ai-chat-reply';

const readPreference = (): boolean => {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * The preference is shared by every surface that shows or uses
 * it: the Assistant page switch, the floating assistant one,
 * and the global listener that warns at the end of a reply. A local state per
 * surface would have let them contradict each other until the next mount.
 */
const usePreference = create<{ preferred: boolean; setPreferred: (value: boolean) => void }>()(
  (set) => ({
    preferred: readPreference(),
    setPreferred: (preferred) => {
      try {
        localStorage.setItem(PREFERENCE_KEY, preferred ? '1' : '0');
      } catch {
        /* storage unavailable: the preference only applies to the page */
      }
      set({ preferred });
    },
  }),
);

/** `unavailable` covers browsers that do not know the Notifications API. */
export type NotificationAuthorization = 'unavailable' | NotificationPermission;

export const readAuthorization = (): NotificationAuthorization =>
  typeof Notification === 'undefined' ? 'unavailable' : Notification.permission;

/**
 * Can the switch still be offered? A refusal cannot be asked again, and a
 * browser that cannot do it will not be convinced: in both
 * cases, better to show nothing than a setting with no effect.
 */
export const canBeOffered = (authorization: NotificationAuthorization) =>
  authorization === 'default' || authorization === 'granted';

/** The only rule that decides to disturb the user - hence its isolation. */
export const shouldNotify = (
  authorization: NotificationAuthorization,
  preferred: boolean,
  visibility: DocumentVisibilityState,
) => preferred && authorization === 'granted' && visibility !== 'visible';

export function useReplyNotification() {
  const t = useTranslations('aiChat.browserNotifications');
  const [authorization, setAuthorization] = useState<NotificationAuthorization>(readAuthorization);
  const preferred = usePreference((state) => state.preferred);
  const setPreferred = usePreference((state) => state.setPreferred);
  /**
   * Permission request in progress. The browser only answers once
   * the user has decided - and Chrome, after ignored requests, only shows
   * a crossed-out bell in the address bar. Meanwhile,
   * the switch does not move: this must be said, otherwise it looks stuck.
   */
  const [requesting, setRequesting] = useState(false);
  const shownRef = useRef<Notification | null>(null);

  const close = useCallback(() => {
    shownRef.current?.close();
    shownRef.current = null;
  }, []);

  /**
   * Coming back to the tab is the expected response: the notification has done its
   * job and no longer needs to linger in the notification center. Leaving the
   * thread removes it for the same reason - it pointed there.
   */
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') close();
    };
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      close();
    };
  }, [close]);

  /**
   * Shows a notification, and says when the browser cannot do it:
   * the site permission is not enough - on Mac, the browser itself must
   * be allowed in the system settings, and a Focus mode silences
   * everyone. Without this feedback, the switch is on and nothing
   * comes, without anyone knowing why.
   */
  const show = useCallback(
    (title: string, body: string, onClick?: () => void) => {
      let notification: Notification;
      try {
        notification = new Notification(title, { body, tag: NOTIFICATION_TAG });
      } catch {
        toast.error(t('unsupported'));
        return;
      }
      notification.onerror = () => toast.error(t('displayFailed'), { duration: 8000 });
      notification.onclick = () => {
        // Bring the tab to the foreground, then the announced conversation:
        // the reply finished on the server side, wherever the user went since.
        window.focus();
        close();
        onClick?.();
      };
      shownRef.current = notification;
    },
    [close, t],
  );

  const toggle = async (wanted: boolean) => {
    if (!wanted) {
      setPreferred(false);
      close();
      return;
    }
    // This click, and only this one, makes the request acceptable to the browser.
    let decision: NotificationPermission = 'granted';
    if (authorization !== 'granted') {
      setRequesting(true);
      try {
        decision = await Notification.requestPermission();
      } finally {
        setRequesting(false);
      }
    }
    setAuthorization(decision);
    if (decision === 'denied') {
      // The switch disappears right after: it is the only chance to explain it.
      toast.error(t('denied'), { duration: 8000 });
      return;
    }
    if (decision !== 'granted') {
      // `default`: the request was closed without an answer - nothing is lost.
      toast.warning(t('dismissed'), { duration: 8000 });
      return;
    }
    setPreferred(true);
    /**
     * Immediate proof, while the tab is being watched. If nothing shows
     * now, nothing will show later: better to know right away,
     * and not after waiting for a reply from another tab.
     */
    show(t('enabled.title'), t('enabled.body'));
  };

  const notify = useCallback(
    (conversation: string, onClick?: () => void) => {
      // Re-read right now: a permission revoked in the browser settings
      // does not notify the page, and the preference may have changed
      // from another screen.
      const { preferred: wanted } = usePreference.getState();
      if (!shouldNotify(readAuthorization(), wanted, document.visibilityState)) return;
      /**
       * The conversation title, and nothing else: replies carry
       * business data, which must not leave the application
       * for the system notification center.
       */
      show(t('replyTitle'), conversation, onClick);
    },
    [show, t],
  );

  return {
    offerable: canBeOffered(authorization),
    /** On only if the browser agrees: the permission may have been revoked since. */
    active: preferred && authorization === 'granted',
    /** The browser is waiting for the user's answer to its permission request. */
    requesting,
    toggle,
    notify,
  };
}
