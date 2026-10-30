"use client";

import { create } from 'zustand';

/**
 * Floating assistant state. Collapsing the panel or hiding the sphere only
 * applies to the open page: a reload puts everything back. This is
 * intended: hiding is not a setting, it is a gesture of the moment.
 *
 * The current conversation, however, belongs to the browser: it is kept
 * in its local storage, and it is the one found again on the next load.
 * It is never "the most recent of the account": on another device, the
 * panel opens blank, and nothing else forces its way into the
 * panel.
 */
const STORAGE_KEY = 'ai-chat.assistant.conversation';

const storedConversation = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const rememberConversation = (id: string | null): void => {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (strict private browsing): the selection does not survive a reload
  }
};

interface Selection {
  /** Resumed conversation; null for a blank thread requested by the user. */
  id: string | null;
  /**
   * Mount identity of the thread. It only changes on a user gesture
   * (new conversation, resuming an old one): if it followed the
   * identifier created on the first message, the thread would be remounted and lose that
   * message at the very moment it is sent.
   */
  key: string;
  /** Time of the choice: only a list re-read afterwards is authoritative (see FloatingAssistant). */
  chosenAt: number;
}

interface AssistantState {
  /** The panel is expanded. */
  open: boolean;
  /** The cross was clicked: the sphere only comes back on the next page load. */
  hidden: boolean;
  /** The sphere is on screen: toasts shift so as not to cover it. */
  sphereVisible: boolean;
  /** Conversation chosen in this browser; null for a blank thread. */
  selection: Selection | null;
  /** A reply finished while the panel was collapsed, not seen yet. */
  replyReady: boolean;
  markReplyReady: () => void;
  toggle: () => void;
  collapse: () => void;
  hide: () => void;
  setSphereVisible: (visible: boolean) => void;
  newConversation: () => void;
  resume: (id: string) => void;
  /** Expands the panel on a given conversation (click on a notification). */
  openOn: (id: string) => void;
  /** The thread just created its conversation: it is kept without remounting the thread. */
  created: (id: string) => void;
}

export const useAssistantStore = create<AssistantState>()((set) => ({
  open: false,
  hidden: false,
  sphereVisible: false,
  selection: (() => {
    const id = storedConversation();
    return id ? { id, key: id, chosenAt: Date.now() } : null;
  })(),
  replyReady: false,
  markReplyReady: () => set({ replyReady: true }),
  // Opening the panel means seeing the reply: the indicator turns off
  toggle: () =>
    set((state) => ({ open: !state.open, replyReady: state.open && state.replyReady })),
  collapse: () => set({ open: false }),
  hide: () => set({ hidden: true, open: false }),
  setSphereVisible: (sphereVisible) => set({ sphereVisible }),
  newConversation: () => {
    rememberConversation(null);
    // i18n-ignore technical identifier (React key of a blank conversation), never displayed
    set({ selection: { id: null, key: `blank-${Date.now()}`, chosenAt: Date.now() } });
  },
  resume: (id) => {
    rememberConversation(id);
    set({ selection: { id, key: id, chosenAt: Date.now() } });
  },
  openOn: (id) => {
    rememberConversation(id);
    set({ open: true, replyReady: false, selection: { id, key: id, chosenAt: Date.now() } });
  },
  created: (id) => {
    rememberConversation(id);
    set((state) => ({
      selection: { id, key: state.selection?.key ?? 'blank', chosenAt: Date.now() },
    }));
  },
}));
