"use client";
"use no memo";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  MoreHorizontal,
  Navigation,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from "./lib/api";
import { Drawer } from "./ui/drawer";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { PageLoader, Tooltip } from "./ui/misc";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useIsPhone } from "./lib/use-is-phone";
import { takePageReload } from "./lib/page-reload";
import { EmptyState, ChatThread, unavailability, useChatDate, type ChatAccess, type Conversation } from "./thread";
import { ReplyDots } from "./reply-indicator";
import { EditableTitle } from "./editable-title";
import { isReplyInProgress, useRepliesStore } from "./replies-store";

export function ChatView({ initialConversation }: { initialConversation?: string }) {
  const t = useTranslations('aiChat');
  const tActions = useTranslations('common.actions');
  const formatDate = useChatDate();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(initialConversation ?? null);

  /**
   * The open conversation is carried by the URL. That is what lets it survive
   * a refresh, and what keeps the browser back button
   * consistent - storing it only in React state lost it on every F5.
   */
  /** Time of the last selection: only a list re-read afterwards is authoritative (see below). */
  const selectedAt = useRef(0);
  const openConversation = (id: string | null) => {
    selectedAt.current = Date.now();
    setConversationId(id);
    // The address follows, with no server round trip: `replaceState` rather than the router
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('conversation', id);
    else url.searchParams.delete('conversation');
    window.history.replaceState(window.history.state, '', url);
  };
  /**
   * Mount identity of the thread. It ONLY changes on a user action
   * (open a conversation, start a new one): if it followed the identifier
   * created when the first message is sent, React would remount the thread and lose that
   * message at the very moment it is sent.
   */
  const [threadKey, setThreadKey] = useState(initialConversation ?? 'home');

  /**
   * Back to home: nothing selected anymore, AND a fresh thread.
   *
   * The two go together. Releasing only the selection left the thread mounted
   * on its previous key: a conversation was deleted and still
   * readable, messages included, although it no longer existed. A single
   * entry point, so they can no longer get out of sync.
   */
  const goHome = () => {
    openConversation(null);
    // i18n-ignore technical mount key of the thread (never displayed)
    setThreadKey(`home-${Date.now()}`);
  };
  // A reload by the user (F5) starts on the assistant's home; a link to a
  // conversation, or the history, still opens it. After the first render,
  // which matches the server's.
  useEffect(() => {
    if (initialConversation && takePageReload('assistant-page', window.location.pathname)) queueMicrotask(goHome);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at the first mount
  }, []);
  const [toDelete, setToDelete] = useState<Conversation | null>(null);
  /** Conversation whose title is being typed, in the list. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** A rename was just requested from the menu: focus must stay on the field. */
  const renameRequested = useRef<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Phone: the conversations column becomes a drawer, opened from the thread header
  const isPhone = useIsPhone();
  const [listOpen, setListOpen] = useState(false);

  const { data: access, error: accessError } = useQuery({
    queryKey: ['ai-chat-access'],
    queryFn: () => api<ChatAccess>('/api/ai-chat/access'),
    retry: false,
  });
  const {
    data: conversations,
    isLoading,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['ai-chat-conversations', 'page'],
    queryFn: () => api<Conversation[]>('/api/ai-chat/conversations'),
  });

  const active = conversations?.find((conversation) => conversation.id === conversationId) ?? null;
  // Replies finishing in the background: the list shows it, without reloading
  const replyStates = useRepliesStore((store) => store.states);

  /**
   * Stale link - conversation deleted since, or identifier copied
   * wrongly: go back home rather than leave an address that lies.
   *
   * Only a list re-read AFTER the selection is authoritative. On the first message of a
   * new conversation, it is selected before the list knows
   * about it: judging it on the previous list sent it back home, unmounted
   * the thread and lost the message at the very moment it was sent.
   */
  useEffect(() => {
    if (
      conversationId &&
      conversations &&
      dataUpdatedAt > selectedAt.current &&
      !conversations.some((item) => item.id === conversationId)
    ) {
      goHome();
    }
  }, [conversations, conversationId, dataUpdatedAt]);

  const deleteConversation = useMutation({
    mutationFn: (id: string) => api(`/api/ai-chat/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      if (conversationId === id) goHome();
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const clearHistory = useMutation({
    mutationFn: () => api<{ count: number }>('/api/ai-chat/conversations', { method: 'DELETE' }),
    onSuccess: (result) => {
      goHome();
      setDeleteAllOpen(false);
      toast.success(t('list.toast.deleted', { count: result.count }));
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api(`/api/ai-chat/conversations/${id}`, { method: 'PATCH', body: { title } }),
    onSuccess: () => {
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const togglePin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api(`/api/ai-chat/conversations/${id}`, { method: 'PATCH', body: { pinned } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] }),
    onError: (error) => toast.error(error.message),
  });

  const visibleConversations = useMemo(() => {
    const words = normalizeText(search).split(/\s+/).filter(Boolean);
    if (!words.length) return conversations ?? [];
    return (conversations ?? []).filter((conversation) => {
      const text = normalizeText(conversation.title);
      return words.every((word) => text.includes(word));
    });
  }, [conversations, search]);

  // Pinned ones first, the most recently pinned first; the rest keeps the exchange order
  const listed = visibleConversations;
  const pinned = listed
    .filter((conversation) => conversation.pinnedAt)
    .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''));
  const recent = listed.filter((conversation) => !conversation.pinnedAt);

  const renderRow = (conversation: Conversation) => (
    <div
      key={conversation.id}
      className={cn(
        // Smaller than the messages (14 px): a list reads at a glance
        'group flex items-center gap-1 rounded-ai-md px-2 py-2 text-[13px] transition-colors hover:bg-ai-surface-hover max-md:min-h-10',
        conversation.id === conversationId && 'bg-ai-selected',
      )}
    >
      <Tooltip
        content={t(conversation.followsNavigation ? 'list.lastExchangeFloating' : 'list.lastExchange', {
          date: formatDate(conversation.updatedAt),
        })}
      >
        <button
          type="button"
          onClick={() => {
            openConversation(conversation.id);
            setThreadKey(conversation.id);
            setListOpen(false);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {editingId === conversation.id ? (
            <EditableTitle
              value={conversation.title}
              onConfirm={(title) => rename.mutate({ id: conversation.id, title })}
              onCancel={() => setEditingId(null)}
              className="text-[13px]"
            />
          ) : (
            <span className="truncate text-ai-primary">{conversation.title}</span>
          )}
          {/* Same marker as the composer chip: the conversation comes from the floating assistant */}
          {conversation.followsNavigation ? (
            <Navigation
              aria-label={t('list.openedFromFloating')}
              className="size-3 shrink-0 text-ai-accent"
            />
          ) : null}
          {isReplyInProgress(conversation, dataUpdatedAt, replyStates) ? (
            <ReplyDots small className="shrink-0" />
          ) : null}
        </button>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('list.actionsOn', { title: conversation.title })}
            className="rounded-ai-sm p-0.5 text-ai-muted opacity-0 transition-opacity hover:bg-ai-surface-hover hover:text-ai-primary group-hover:opacity-100 data-[state=open]:opacity-100 max-md:grid max-md:size-10 max-md:place-items-center max-md:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // When closing, the menu returns focus to its button: it would steal it from the rename field
          onCloseAutoFocus={(event) => {
            // The field only appears once the menu is closed: once open, it keeps the focus
            if (renameRequested.current) {
              event.preventDefault();
              setEditingId(renameRequested.current);
              renameRequested.current = null;
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              renameRequested.current = conversation.id;
            }}
          >
            <Pencil className="size-3.5" /> {t('list.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              togglePin.mutate({ id: conversation.id, pinned: !conversation.pinnedAt })
            }
          >
            {conversation.pinnedAt ? (
              <>
                <PinOff className="size-3.5" /> {t('list.unpin')}
              </>
            ) : (
              <>
                <Pin className="size-3.5" /> {t('list.pin')}
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => setToDelete(conversation)}>
            <Trash2 className="size-3.5" /> {tActions('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // The chat became unavailable in the meantime (settings, rights): say so plainly
  if (accessError) {
    return (
      <EmptyState title={t('unavailable.title')} detail={t('unavailable.detail')} />
    );
  }
  if (isLoading || !access) return <PageLoader />;
  const unavailable = unavailability(access, t);
  if (unavailable) return <EmptyState title={unavailable.title} detail={unavailable.detail} />;

  return (
    <div className="flex h-full">
      <ConversationsColumn
        isPhone={isPhone}
        open={listOpen}
        onOpenChange={setListOpen}
      >
        {/* Notebook-style header: the title, the search and the "+", nothing else */}
        <div className="flex items-center gap-1 px-4 pb-2 pt-4">
          {/* In the drawer, the header already carries the title: not "Conversations" twice */}
          <h2 className="text-ai-sm font-semibold text-ai-primary max-md:hidden">{t('list.title')}</h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label={t('list.search.ariaLabel')}
              aria-pressed={searchOpen}
              data-tooltip={t('list.search.tooltip')}
              onClick={() => {
                setSearchOpen((wasOpen) => !wasOpen);
                setSearch('');
              }}
              className={cn(
                'grid size-7 place-items-center rounded-ai-md text-ai-secondary transition-colors hover:bg-ai-surface-hover hover:text-ai-primary max-md:size-10',
                searchOpen && 'bg-ai-selected text-ai-primary',
              )}
            >
              <Search className="size-4" />
            </button>
            <button
              type="button"
              aria-label={t('conversations.new')}
              data-tooltip={t('conversations.new')}
              onClick={() => {
                goHome();
                setListOpen(false);
              }}
              // The AI tools purple, like the sphere and the thread sparkle
              // i18n-ignore CSS classes (false positive on "de" in a hex color)
              className="grid size-7 place-items-center rounded-full bg-[#7c4dff] text-[#ffffff] shadow-ai-raised transition-colors hover:bg-[#6a3de8] max-md:size-10"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        {searchOpen ? (
          <div className="px-4 pb-2">
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('list.search.placeholder')}
              aria-label={t('list.search.ariaLabel')}
              className="h-8 text-ai-sm max-md:h-10 max-md:text-base"
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
          {/* A single section: the Pinned / Recent subtitles, with no collapsible header */}
          {[
            { key: 'pinned', title: t('list.sections.pinned'), rows: pinned },
            { key: 'recent', title: t('list.sections.recent'), rows: recent },
          ].map(({ key, title, rows }) =>
            rows.length ? (
              <div key={key} className="mb-2 space-y-0.5">
                {/* Without pinned ones, a single list: no title for a lone section */}
                {pinned.length ? (
                  <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ai-placeholder">
                    {title}
                  </p>
                ) : null}
                {rows.map(renderRow)}
              </div>
            ) : null,
          )}
          {conversations?.length && !visibleConversations.length ? (
            <p className="px-2 py-3 text-ai-xs text-ai-placeholder">{t('list.noMatch')}</p>
          ) : null}
        </div>
        {conversations?.length ? (
          <div className="border-t border-ai-border-subtle px-4 py-2">
            <button
              type="button"
              onClick={() => setDeleteAllOpen(true)}
              data-tooltip={t('list.deleteAllTooltip')}
              className="text-[11px] text-ai-muted transition-colors hover:text-ai-danger max-md:py-2"
            >
              {t('list.deleteAll')}
            </button>
          </div>
        ) : null}
      </ConversationsColumn>

      <ChatThread
        key={threadKey}
        conversation={active}
        access={access}
        onOpenList={isPhone ? () => setListOpen(true) : undefined}
        onCreated={(id) => {
          // Highlight without touching the mount key
          openConversation(id);
          void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('list.confirmDelete.title')}
        description={t('list.confirmDelete.description', { title: toDelete?.title ?? '' })}
        confirmLabel={tActions('delete')}
        loading={deleteConversation.isPending}
        onConfirm={() => toDelete && deleteConversation.mutate(toDelete.id)}
      />

      <ConfirmDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
        title={t('list.confirmDeleteAll.title')}
        description={t('list.confirmDeleteAll.description', { count: conversations?.length ?? 0 })}
        confirmLabel={t('list.deleteAll')}
        loading={clearHistory.isPending}
        onConfirm={() => clearHistory.mutate()}
      />
    </div>
  );
}

/** Without accents or capitals, for a forgiving search. */
const normalizeText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Width of the conversations column on desktop: the default, and how far it can be dragged. */
export const LIST_WIDTH = { default: 300, min: 240, max: 440 } as const;
const LIST_WIDTH_KEY = 'hp-ai-chat-list-width';
const LIST_WIDTH_EVENT = 'hp-ai-chat-list-width';
const clampListWidth = (width: number) => Math.round(Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, width)));

/**
 * The width chosen in this browser, kept across visits. Read through an
 * external store: the server render (and the first client one) use the
 * default, with no hydration mismatch; storage can be unavailable (private mode).
 */
function useListWidth(): [number, (width: number | null) => void] {
  const width = useSyncExternalStore(
    (notify) => {
      window.addEventListener(LIST_WIDTH_EVENT, notify);
      window.addEventListener('storage', notify);
      return () => {
        window.removeEventListener(LIST_WIDTH_EVENT, notify);
        window.removeEventListener('storage', notify);
      };
    },
    () => {
      try {
        const saved = Number(window.localStorage.getItem(LIST_WIDTH_KEY));
        return saved ? clampListWidth(saved) : LIST_WIDTH.default;
      } catch {
        return LIST_WIDTH.default;
      }
    },
    () => LIST_WIDTH.default,
  );
  const save = (next: number | null) => {
    try {
      if (next === null) window.localStorage.removeItem(LIST_WIDTH_KEY);
      else window.localStorage.setItem(LIST_WIDTH_KEY, String(clampListWidth(next)));
    } catch {
      // Storage unavailable: the width lasts for this page only
    }
    window.dispatchEvent(new Event(LIST_WIDTH_EVENT));
  };
  return [width, save];
}

/**
 * The conversations column: a pane left of the thread on desktop, which can be
 * widened or narrowed by dragging its edge (within limits, double click: back to
 * the default width), a drawer on phone, where the thread needs the full width.
 */
function ConversationsColumn({
  isPhone,
  open,
  onOpenChange,
  children,
}: {
  isPhone: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const t = useTranslations('aiChat.list');
  const [savedWidth, saveWidth] = useListWidth();
  /** Width while dragging: shown live, saved once released. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? savedWidth;
  if (!isPhone) {
    return (
      <aside style={{ width }} className="relative flex shrink-0 flex-col border-r border-ai-border-subtle">
        {children}
        {/* The edge of the column: drag it, or use the arrow keys once focused */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('resize')}
          aria-valuemin={LIST_WIDTH.min}
          aria-valuemax={LIST_WIDTH.max}
          aria-valuenow={width}
          tabIndex={0}
          data-tooltip={t('resizeTooltip')}
          onPointerDown={(event) => {
            event.preventDefault();
            const start = event.clientX;
            const from = width;
            const handle = event.currentTarget;
            handle.setPointerCapture(event.pointerId);
            let last = from;
            const move = (moveEvent: PointerEvent) => {
              last = clampListWidth(from + moveEvent.clientX - start);
              setDragWidth(last);
            };
            const release = () => {
              handle.removeEventListener('pointermove', move);
              handle.removeEventListener('pointerup', release);
              handle.removeEventListener('pointercancel', release);
              saveWidth(last);
              setDragWidth(null);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', release);
            handle.addEventListener('pointercancel', release);
          }}
          onDoubleClick={() => saveWidth(null)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 40 : 10;
            if (event.key === 'ArrowLeft') saveWidth(width - step);
            else if (event.key === 'ArrowRight') saveWidth(width + step);
            else if (event.key === 'Home') saveWidth(LIST_WIDTH.min);
            else if (event.key === 'End') saveWidth(LIST_WIDTH.max);
            else return;
            event.preventDefault();
          }}
          className={cn(
            'absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none',
            // A purple line on hover, while dragging and with the keyboard focus
            'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-[#7c4dff] after:opacity-0 after:transition-opacity hover:after:opacity-60 focus-visible:after:opacity-100',
            dragWidth !== null && 'after:opacity-100',
          )}
        />
      </aside>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="left" title={t('title')}>
      <div className="flex h-full flex-col">{children}</div>
    </Drawer>
  );
}
