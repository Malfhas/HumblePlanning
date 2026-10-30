"use client";
"use no memo";

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bell, BellOff, History, Maximize2, MessageSquare, MessageSquarePlus, Minus, X } from 'lucide-react';
import { api } from "./lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { PageLoader } from "./ui/misc";
import { Sphere } from "./sphere";
import { RadialMenu, useRadialMenu } from "./radial-menu";
import { useIsPhone } from "./lib/use-is-phone";
import { isInSection } from "./lib/path";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "./assistant-store";
import {
  EmptyState,
  ChatThread,
  unavailability,
  useChatDate,
  type ChatAccess,
  type Conversation,
  type FollowedScope,
} from "./thread";
import { ReplyDots } from "./reply-indicator";
import { QuotaGauge } from "./quota-gauge";
import { isReplyInProgress, isFloatingReplyInProgress, useRepliesStore } from "./replies-store";
import { useReplyNotification } from "./use-reply-notification";

/**
 * The floating assistant: the sphere at the bottom right of every screen, which opens
 * the AI chat in a panel without leaving the page.
 *
 * It is the same chat as the Assistant page (same thread, same composer, same
 * confirmations), with one difference: the scope follows navigation. You talk
 * from the home page, move to the schedule, and the conversation goes on: the
 * tools offered to the model follow the page being viewed. A single conversation at a
 * time, carried from one page to the next; only the user starts a new one.
 */
export function FloatingAssistant() {
  const t = useTranslations('aiChat.floating');
  const pathname = usePathname() ?? '';
  const { data: access } = useQuery({
    queryKey: ['ai-chat-access'],
    queryFn: () => api<ChatAccess>('/api/ai-chat/access'),
    staleTime: 60_000,
    retry: false,
  });
  const open = useAssistantStore((state) => state.open);
  const hidden = useAssistantStore((state) => state.hidden);
  const toggle = useAssistantStore((state) => state.toggle);
  const hide = useAssistantStore((state) => state.hide);
  const setSphereVisible = useAssistantStore((state) => state.setSphereVisible);
  const replyReady = useAssistantStore((state) => state.replyReady);
  // Panel collapsed: the sphere says the assistant is writing, then that the reply is waiting
  const replying = useRepliesStore((store) => isFloatingReplyInProgress(store.states));
  /**
   * The panel stays mounted once opened: collapsed, it keeps receiving
   * the reply in progress, found again when reopening it. Unmounting it would stop
   * the stream, like leaving the Assistant page.
   */
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);

  /**
   * A long press on the sphere opens the radial menu (desktop only):
   * dragging the sphere onto "Open the AI chat" opens it, dropping it in the
   * corner hides it.
   */
  const isPhone = useIsPhone();
  const items = useMemo(
    () => [
      {
        id: 'chat',
        label: t('openChat'),
        icon: <MessageSquare className="size-5" />,
        angle: 198,
        onChoose: () => {
          if (!useAssistantStore.getState().open) toggle();
        },
      },
    ],
    [toggle, t],
  );
  // On desktop, hiding the sphere goes through the long-press menu (round
  // cross in the corner): so the menu opens as soon as that gesture makes sense
  const hideable = Boolean(access?.widget.closable);
  // One second of hover without a click: the sphere empties into a glass ball,
  // to read what it covers. A click, a press or leaving fills it again.
  const [glass, setGlass] = useState(false);
  const glassTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelGlass = () => {
    if (glassTimer.current) clearTimeout(glassTimer.current);
    glassTimer.current = null;
    setGlass(false);
  };
  const armGlass = () => {
    if (glassTimer.current) clearTimeout(glassTimer.current);
    // Chat open: the sphere no longer covers any text, it stays full
    if (useAssistantStore.getState().open) return;
    glassTimer.current = setTimeout(() => setGlass(true), 1000);
  };
  useEffect(() => () => cancelGlass(), []);
  useEffect(() => {
    if (open) cancelGlass();
  }, [open]);
  const menu = useRadialMenu(items, !isPhone && hideable, hideable ? hide : undefined);

  // On the Assistant page, the sphere would duplicate the whole screen
  const present = Boolean(access?.widget.visible) && !hidden && !isInSection(pathname, '/assistant');
  useEffect(() => {
    setSphereVisible(present);
    return () => setSphereVisible(false);
  }, [present, setSphereVisible]);

  if (!present || !access) return null;

  return (
    <>
      {mounted ? <Panel access={access} visible={open} /> : null}
      <div
        className={cn(
          'group fixed bottom-6 right-6 z-40',
          // Phone: above the safe area, and hidden under the full-screen panel
          'max-md:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-md:right-4',
          open && 'max-md:hidden',
        )}
      >
        {!open && (replying || replyReady) ? (
          <button
            type="button"
            onClick={toggle}
            className="absolute right-full top-1/2 mr-3 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-ai-border-subtle bg-ai-raised py-1.5 pl-3 pr-3.5 text-ai-xs text-ai-primary shadow-ai-raised transition-colors hover:bg-ai-surface-hover"
          >
            {replying ? (
              <>
                <ReplyDots small />
                <span>{t('replying')}</span>
              </>
            ) : (
              <>
                <span className="size-2 rounded-full bg-ai-accent" aria-hidden />
                <span>{t('replyReady')}</span>
              </>
            )}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t('title')}
          aria-expanded={open}
          onClick={() => {
            if (!menu.open) toggle();
          }}
          onPointerEnter={armGlass}
          onPointerLeave={cancelGlass}
          onPointerDown={(event) => {
            cancelGlass();
            menu.onPointerDown(event);
          }}
          onPointerUp={menu.onPointerUp}
          className={cn(
            'relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ai-border-focus',
            menu.open && 'opacity-0',
          )}
        >
          <Sphere className="size-12" glass={glass} />
          {!open && replyReady ? (
            <span
              className="absolute -left-0.5 -top-0.5 size-3.5 rounded-full border-2 border-ai-surface bg-ai-accent motion-safe:animate-pulse"
              aria-hidden
            />
          ) : null}
        </button>
        {/* On phone only: no long press, the cross stays */}
        {hideable && isPhone ? (
          <button
            type="button"
            aria-label={t('hide.ariaLabel')}
            data-tooltip={t('hide.tooltip')}
            onClick={hide}
            className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border border-ai-border-strong bg-ai-raised text-ai-muted opacity-0 shadow-ai-raised transition-opacity hover:text-ai-primary focus-visible:opacity-100 group-hover:opacity-100 max-md:size-6 max-md:opacity-100"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      {menu.open && menu.origin ? (
        <RadialMenu
          items={items}
          origin={menu.origin}
          hovered={menu.hovered}
          ghost={menu.ghost}
          corner={menu.corner}
          sphere={<Sphere className="size-12" />}
        />
      ) : null}
    </>
  );
}

const BUTTON_CLASS =
  'grid size-7 shrink-0 place-items-center rounded-ai-md text-ai-muted transition-colors hover:bg-ai-surface-hover hover:text-ai-primary max-md:size-10';

function Panel({ access, visible }: { access: ChatAccess; visible: boolean }) {
  const t = useTranslations('aiChat');
  const formatDate = useChatDate();
  const router = useRouter();
  const queryClient = useQueryClient();
  // The application has no page dedicated to a project: the floating assistant
  // scope is the whole schedule, and the tools follow the page being viewed.
  const projectId: string | null = null;
  const collapse = useAssistantStore((state) => state.collapse);
  const selection = useAssistantStore((state) => state.selection);
  const newConversation = useAssistantStore((state) => state.newConversation);
  const resume = useAssistantStore((state) => state.resume);
  const created = useAssistantStore((state) => state.created);
  // Replies finishing in the background: the history shows it, without reloading
  const replyStates = useRepliesStore((store) => store.states);
  // Same preference as in the Assistant page: it belongs to the browser
  const notification = useReplyNotification();

  /**
   * The floating assistant conversations, most recent first, with no
   * workspace filter: their scope follows navigation, including from one workspace to
   * another, and it is indeed the latest one we want to resume wherever it stands.
   */
  const { data: conversations, dataUpdatedAt } = useQuery({
    queryKey: ['ai-chat-conversations', 'assistant'],
    queryFn: () => api<Conversation[]>('/api/ai-chat/conversations?followsNavigation=true'),
  });

  /**
   * Displayed conversation: the one this browser kept (chosen or created
   * here), otherwise a blank thread. Never "the most recent of the account": on another
   * device we start from scratch. A stale choice (conversation
   * deleted since) is ignored, but only a list re-read AFTER the choice
   * is authoritative: on the first message of a new conversation, it is kept
   * before the list knows about it, and judging it on the previous list
   * would remount the thread at the very moment the message is sent. A conversation
   * kept at load time waits for the list before being displayed.
   */
  const listKnown = conversations !== undefined;
  const validChoice =
    selection !== null &&
    (selection.id === null ||
      (dataUpdatedAt <= selection.chosenAt && dataUpdatedAt > 0) ||
      Boolean(conversations?.some((candidate) => candidate.id === selection.id)));
  const id = listKnown && validChoice ? selection.id : null;
  const threadKey = !listKnown ? 'loading' : validChoice ? selection.key : 'blank';
  const conversation = (id && conversations?.find((candidate) => candidate.id === id)) || null;

  /** Scope of the next message: the whole schedule. */
  const followedScope = useMemo<FollowedScope>(() => ({ projectId, project: null }), [projectId]);
  // Always stated in the header: what the next message relates to
  const scopeName = t('scope.global.name');

  const openFullPage = () => {
    collapse();
    router.push(conversation ? `/assistant?conversation=${conversation.id}` : '/assistant');
  };

  const unavailable = unavailability(access, t);

  return (
    <section
      aria-label={t('floating.title')}
      className={cn(
        'fixed bottom-[5.5rem] right-6 z-40 h-[640px] max-h-[calc(100vh-7rem)] w-[460px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-ai-lg border border-ai-border-subtle bg-ai-surface shadow-ai-modal',
        // Phone: the whole screen, above the shell, respecting the safe areas
        'max-md:inset-0 max-md:z-50 max-md:h-auto max-md:max-h-none max-md:w-auto max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:pb-[env(safe-area-inset-bottom)] max-md:pt-[env(safe-area-inset-top)]',
        visible ? 'flex' : 'hidden',
      )}
    >
      <header className="flex items-center gap-1 border-b border-ai-border-subtle px-3 py-2 max-md:gap-0">
        {/* The sphere in miniature: the same identity as the button that opened the panel */}
        <Sphere className="size-6 shrink-0" />
        <div className="min-w-0 flex-1 pl-1">
          <p className="text-ai-sm font-medium text-ai-primary">{t('floating.title')}</p>
          <p className="truncate text-[11px] text-ai-muted" data-assistant-scope>
            {t('floating.scope', { scope: scopeName })}
          </p>
        </div>
        {/* The monthly quota, small next to the bell: the thread, collapsed in this panel, does not carry it */}
        <QuotaGauge quota={access.quota} size={16} className="mx-1" />
        {notification.offerable ? (
          <button
            type="button"
            aria-label={t('notify.ariaLabel')}
            aria-pressed={notification.active}
            disabled={notification.requesting}
            data-tooltip={
              notification.requesting
                ? t('notify.pending')
                : notification.active
                  ? t('notify.active')
                  : t('notify.inactive')
            }
            onClick={() => void notification.toggle(!notification.active)}
            className={cn(BUTTON_CLASS, notification.active && 'text-ai-accent hover:text-ai-accent')}
          >
            {/* Crossed-out bell while notifications are off: the state reads without a tooltip */}
            {notification.active ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('floating.history.ariaLabel')}
              data-tooltip={t('floating.history.tooltip')}
              className={BUTTON_CLASS}
            >
              <History className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>{t('floating.history.title')}</DropdownMenuLabel>
            {conversations?.length ? (
              conversations.map((candidate) => (
                <DropdownMenuItem
                  key={candidate.id}
                  onSelect={() => resume(candidate.id)}
                  className="flex flex-col items-start gap-0"
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    <span className="truncate">{candidate.title}</span>
                    {isReplyInProgress(candidate, dataUpdatedAt, replyStates) ? (
                      <ReplyDots small className="shrink-0" />
                    ) : null}
                  </span>
                  <span className="text-[11px] text-ai-muted">
                    {formatDate(candidate.updatedAt)} ·{' '}
                    {candidate.project?.number ?? t('scope.global.name')}
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <p className="px-2 py-1.5 text-ai-xs text-ai-placeholder">{t('floating.history.empty')}</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={t('conversations.new')}
          data-tooltip={t('conversations.new')}
          onClick={newConversation}
          className={BUTTON_CLASS}
        >
          <MessageSquarePlus className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t('floating.fullPage.ariaLabel')}
          data-tooltip={t('floating.fullPage.tooltip')}
          onClick={openFullPage}
          className={BUTTON_CLASS}
        >
          <Maximize2 className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t('floating.collapse.ariaLabel')}
          data-tooltip={t('floating.collapse.tooltip')}
          onClick={collapse}
          className={BUTTON_CLASS}
        >
          <Minus className="size-4" />
        </button>
      </header>

      {unavailable ? (
        <EmptyState title={unavailable.title} detail={unavailable.detail} />
      ) : !conversations ? (
        <PageLoader />
      ) : (
        <ChatThread
          key={threadKey}
          conversation={conversation}
          initialProjectId={null}
          access={access}
          followedScope={followedScope}
          compact
          onCreated={(newId) => {
            created(newId);
            void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] });
          }}
        />
      )}
    </section>
  );
}
