"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { listen } from "./lib/realtime";
import { useAssistantStore } from "./assistant-store";
import { useReplyNotification } from "./use-reply-notification";

/**
 * An assistant reply finishes on the server side, whether the page is open
 * or not. This file holds what the screen knows of it between two loads:
 * the real-time `chat:reply` event addressed to the user, and the
 * "a reply is in progress" state of each conversation, kept up to date without
 * reloading the lists.
 */

export type ReplyPhase = 'thinking' | 'tools' | 'writing';
export type ReplyStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';

/** `chat:reply` event: a full snapshot of the text, never a delta. */
export interface ReplyEvent {
  conversationId: string;
  messageId: string;
  status: ReplyStatus;
  phase: ReplyPhase;
  tool?: string;
  content: string;
  finished: boolean;
  followsNavigation: boolean;
  /** Filled in at the end only. */
  title?: string;
  error?: string;
}

interface RepliesState {
  /**
   * Per conversation: whether a reply is in progress, since when it is known,
   * and whether it is a floating assistant conversation (its sphere shows it).
   */
  states: Record<string, { inProgress: boolean; at: number; floating: boolean }>;
  report: (event: ReplyEvent) => void;
}

export const useRepliesStore = create<RepliesState>()((set) => ({
  states: {},
  report: (event) =>
    set((store) => ({
      states: {
        ...store.states,
        [event.conversationId]: {
          inProgress: !event.finished,
          at: Date.now(),
          floating: event.followsNavigation,
        },
      },
    })),
}));

/**
 * Is a reply in progress in this conversation? The loaded list
 * is authoritative, unless a more recent event says otherwise: that is
 * what turns the animation on and off without reloading the list.
 */
export function isReplyInProgress(
  conversation: { id: string; replyInProgress: boolean },
  loadedAt: number,
  states: RepliesState['states'],
): boolean {
  const state = states[conversation.id];
  return state && state.at > loadedAt ? state.inProgress : conversation.replyInProgress;
}

/** Is the floating assistant writing a reply? The sphere says so when the panel is collapsed. */
export function isFloatingReplyInProgress(states: RepliesState['states']): boolean {
  return Object.values(states).some((state) => state.floating && state.inProgress);
}

/**
 * Listener mounted once, at the application level: it keeps the conversation
 * state up to date and, at the end of a reply, warns through a
 * browser notification if the tab is not being watched. The click brings back
 * the tab and opens the conversation: in the floating assistant when it
 * follows navigation and the sphere is there, in the Assistant page otherwise.
 */
export function useReplyListener(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  // The server found a title for a conversation: the lists pick it up with no user action
  useEffect(
    () =>
      listen<{ id: string; title: string }>('chat:conversation', () => {
        void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] });
      }),
    [queryClient],
  );
  const { notify } = useReplyNotification();
  useEffect(
    () =>
      listen<ReplyEvent>('chat:reply', (event) => {
        useRepliesStore.getState().report(event);
        // Floating assistant reply finished while its panel was
        // collapsed: the sphere flags it until the panel is reopened.
        const assistant = useAssistantStore.getState();
        if (
          event.finished &&
          event.status === 'DONE' &&
          event.followsNavigation &&
          !assistant.open
        ) {
          assistant.markReplyReady();
        }
        // A stop requested by the user has nothing to announce
        if (!event.finished || event.status === 'CANCELLED') return;
        notify(event.title ?? 'Conversation', () => {
          const assistant = useAssistantStore.getState();
          if (event.followsNavigation && assistant.sphereVisible) {
            assistant.openOn(event.conversationId);
            return;
          }
          router.push(`/assistant?conversation=${event.conversationId}`);
        });
      }),
    [router, notify],
  );
}
