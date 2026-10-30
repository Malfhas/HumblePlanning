"use client";
"use no memo";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type ChatStatus,
  type UIMessage,
} from 'ai';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Bell,
  BellOff,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileType,
  PanelLeft,
  RefreshCw,
  ShieldQuestion,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { api } from "./lib/api";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Badge, Tooltip } from "./ui/misc";
import { listen } from "./lib/realtime";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import { shortDate, shortDateTime } from "./lib/dates";
import { Sphere } from "./sphere";
import { pageFromPath } from "@/lib/ai-chat/toolsets";
import { Composer, isAttachmentUsable, type Attachment, type ReasoningLevel } from "./composer";
import { summarizeAction } from "./actions";
import { useActionLabels } from "./use-action-labels";
import { ReplyIndicator, localPhase } from "./reply-indicator";
import { ModelIcon } from "./model-icon";
import { QuotaGauge, type ChatQuota } from "./quota-gauge";
import { modelLabel } from "./models";
import type { ScopeProject } from "./scope-select";
import { ReplyMarkdown } from "./reply-markdown";
import { EditableTitle } from "./editable-title";
import type { ReplyEvent, ReplyPhase, ReplyStatus } from "./replies-store";
import { useReplyNotification } from "./use-reply-notification";
import { tDyn } from "@/i18n/dynamic";

/**
 * The AI chat thread, shared between the Assistant page (full
 * page) and the floating assistant (bottom-right panel): a single code base for
 * the composer, reply rendering, write confirmations and
 * regeneration. What differs between the two is the scope: chosen then
 * frozen in the Assistant page, imposed by the current screen in the floating assistant.
 */

export interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
  /** Floating assistant conversation: the scope follows navigation. */
  followsNavigation: boolean;
  /** A reply is still finishing there on the server side (computed in the database). */
  replyInProgress: boolean;
  /** Pinned at the top of the list; null otherwise. */
  pinnedAt: string | null;
  /** Null: "Whole planning" scope. */
  project: { id: string; number: string; name: string } | null;
}

/** Message as stored in the database, to re-read on reopening. */
interface StoredMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL';
  content: string;
  createdAt: string;
  /** Model that wrote the reply; null for a user question. */
  model: string | null;
  /** Outcome of the reply: running, done, failed, stopped or interrupted. */
  status: ReplyStatus;
  error: string | null;
}

/**
 * Reply the server finishes without this thread: reopened after leaving, a
 * reload or a page change, it is followed through real-time events
 * until its end, then re-read from the database.
 */
interface TrackedReply {
  messageId: string;
  content: string;
  phase: ReplyPhase;
  tool?: string;
}

/**
 * Readable error message. A server refusal reaches the stream as
 * its raw JSON body; the message is extracted from it, along with the code telling whether
 * a reply is already in progress (409).
 */
function readableError(error: Error): { status?: number; message: string } {
  try {
    const body = JSON.parse(error.message) as { statusCode?: number; error?: unknown; message?: unknown };
    const message = body.error ?? body.message;
    if (typeof message === 'string') return { status: body.statusCode, message };
  } catch {
    /* not a JSON body */
  }
  return { message: error.message };
}

/**
 * State of a message as the thread renders it. It is currently derived from the local
 * stream (`useChat`); it is meant to come from the server, the day a reply
 * finishes as a background job after the user has left the page. The
 * rendering only looks at this status, never at the stream directly: that is what
 * will allow plugging in the server without touching the display.
 */
export type MessageStatus = 'running' | 'done' | 'error';

/** What the thread renders for each message: the stream message, and what else is known about it. */
interface DisplayedMessage {
  message: UIMessage;
  status: MessageStatus;
  date: string | null;
  /** Model that wrote the reply; null for a question. */
  model: string | null;
}

/**
 * Status of each message, computed in a single place. Only the last
 * reply can be in progress, and only while the stream is writing; a stream in
 * error leaves the last reply in error.
 */
function statusesOf(messages: UIMessage[], status: ChatStatus): Map<string, MessageStatus> {
  const statuses = new Map<string, MessageStatus>();
  const last = messages[messages.length - 1];
  for (const message of messages) {
    const isLastReply = message === last && message.role === 'assistant';
    statuses.set(
      message.id,
      isLastReply && status === 'streaming'
        ? 'running'
        : isLastReply && status === 'error'
          ? 'error'
          : 'done',
    );
  }
  return statuses;
}

/** Readable date of an exchange, in the interface language: day and time are enough to find one's way. */
export function useChatDate(): (value: string) => string {
  const { intlTag } = useDateFormat();
  return (value) => shortDateTime(value, intlTag);
}

export interface ChatAccess {
  enabled: boolean;
  level: 'NONE' | 'READ' | 'READ_WRITE';
  configured: boolean;
  defaultModel: string;
  models: string[];
  /** Commercial names published by OpenRouter, when the catalog answers. */
  modelLabels?: Record<string, string>;
  reasoning: ReasoningLevel;
  /** Heading of each write, to explain confirmation requests. */
  toolDescriptions?: Record<string, string>;
  /** What each model can receive, according to the OpenRouter catalog. */
  modelCapabilities?: Record<string, { file: boolean; image: boolean }>;
  /** The floating assistant: offered to this user, and hideable by them. */
  widget: { visible: boolean; closable: boolean };
  /** Monthly quota: where the user stands, as a percentage only. */
  quota: ChatQuota;
  /** Voice dictation enabled by the administration. */
  dictation?: boolean;
}

/**
 * Scope imposed by the current screen, for the floating assistant: the open
 * project, otherwise the whole schedule. It is sent with each message, and changes without
 * the thread being remounted.
 */
export interface FollowedScope {
  projectId: string | null;
  /** The open project, when known: used to display it. */
  project: ScopeProject | null;
}

// i18n-dynamic: aiChat.thread.suggestions.*

/** Starter prompts offered on opening (`thread.suggestions.<scope>.<id>`): they show what the assistant can do. */
const PROJECT_SUGGESTIONS = ['progress', 'whoThisWeek', 'lateOrUnassigned', 'conflicts'];

/** On the whole schedule, questions naturally relate to teams and projects. */
const GLOBAL_SUGGESTIONS = ['availableNextWeek', 'summaryByTeam', 'overBudget', 'unassigned'];

/**
 * Models known to read images. The list is used to warn the user;
 * documents, on the other hand, are always readable since their text is extracted before
 * sending - this works even with a model that sees nothing.
 */
const VISION_MODELS = /gpt-|claude|gemini|llama-4|pixtral|qwen.*vl|grok/i;

/** Header button, the same as in the floating assistant panel. */
const HEADER_BUTTON =
  'grid size-7 shrink-0 place-items-center rounded-ai-md text-ai-muted transition-colors hover:bg-ai-surface-hover hover:text-ai-primary max-md:size-10';

/**
 * Discussion thread. As long as no message has been sent, nothing is saved:
 * the conversation is born from the first question, which avoids leaving
 * empty conversations behind each visit to the page.
 */
export function ChatThread({
  conversation,
  initialProjectId,
  access,
  onCreated,
  followedScope,
  compact,
  onOpenList,
}: {
  conversation: Conversation | null;
  initialProjectId: string | null;
  access: ChatAccess;
  onCreated: (id: string) => void;
  /** Floating assistant: the scope is the current screen's, sent with each message. */
  followedScope?: FollowedScope | null;
  /** Narrow panel: tighter home, smaller sphere. */
  compact?: boolean;
  /** Phone: opens the conversations drawer from the thread header. */
  onOpenList?: () => void;
}) {
  const t = useTranslations('aiChat');
  const { intlTag } = useDateFormat();
  const queryClient = useQueryClient();
  // Projects offered for the scope: those the user can see (not needed for the floating assistant)
  const { data: visibleProjects } = useQuery({
    queryKey: ['ai-chat-scope-projects'],
    queryFn: () => api<ScopeProject[]>('/api/ai-chat/scope-projects'),
    enabled: !followedScope,
    staleTime: 60_000,
  });
  /**
   * Monthly quota reached: no more questions until the period is
   * reset. The composer closes and says so; reading is still possible. The
   * gauge follows each finished reply (see the `chat:reply` listener).
   */
  const quotaReached = access.quota.enabled && access.quota.reached && !access.quota.unlimited;
  const quotaMessage = quotaReached
    ? t('thread.quotaReached', { date: shortDate(access.quota.resetsAt, intlTag) })
    : undefined;
  const refreshQuota = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['ai-chat-access'] }),
    [queryClient],
  );
  /**
   * Scope: a project, or the whole schedule when it is null.
   * In the Assistant page, it is chosen in the composer (when coming from
   * a project, that project is picked; otherwise the whole schedule) and it freezes at the
   * first question. In the floating assistant, the current screen
   * imposes it, message after message, without the thread being remounted.
   */
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(
    conversation?.project?.id ?? initialProjectId ?? null,
  );
  const projectId = followedScope ? followedScope.projectId : chosenProjectId;
  /**
   * Scope of the next message, read on send: the screen may have changed since the
   * transport was built, and that is precisely what we want to pass on.
   */
  const followedScopeRef = useRef(followedScope ?? null);
  useEffect(() => {
    followedScopeRef.current = followedScope ?? null;
  }, [followedScope]);
  /** Scope sent with the message, in the floating assistant only. */
  const currentScope = () =>
    followedScopeRef.current
      ? {
          projectId: followedScopeRef.current.projectId,
          // The page being viewed: the server only declares its tools to the model
          page: pageFromPath(window.location.pathname),
        }
      : {};
  /**
   * Projects offered in the scope selector. The conversation project is
   * always there: it is the one displayed when the scope is frozen or
   * follows navigation.
   */
  const projects: ScopeProject[] = followedScope
    ? followedScope.project
      ? [followedScope.project]
      : []
    : [
        ...(conversation?.project ? [conversation.project] : []),
        ...(visibleProjects ?? [])
          .filter((candidate) => candidate.id !== conversation?.project?.id)
          .map((candidate) => ({ id: candidate.id, number: candidate.number, name: candidate.name })),
      ];
  const [model, setModel] = useState(conversation?.model || access.defaultModel);
  // Same reason as for the identifier: the model is read on send
  const modelRef = useRef(conversation?.model || access.defaultModel);
  const [reasoning, setReasoning] = useState<ReasoningLevel>(access.reasoning ?? 'medium');
  const reasoningRef = useRef<ReasoningLevel>(access.reasoning ?? 'medium');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(conversation?.id ?? null);
  /**
   * True when this thread created the conversation: it already holds all its
   * content, and has nothing to re-read from the database - re-reading while the reply arrives
   * would replace the stream with what is saved, that is the question alone.
   */
  const [createdHere, setCreatedHere] = useState(false);
  /**
   * The identifier is read at send time, not when the transport is
   * built: the conversation is born just before the first message, and the React
   * state is not up to date yet at that moment.
   */
  const idRef = useRef<string | null>(conversation?.id ?? null);

  /** The global scope, always offered: all the projects the user can see. */
  const workspace = { name: t('scope.global.name') };
  /**
   * Capabilities of the current model. They come from the OpenRouter catalog, so
   * from the provider itself; the pattern fallback is only used if the catalog
   * is unreachable.
   */
  const capabilities = access.modelCapabilities?.[model];
  const imagesSupported = capabilities ? capabilities.image : VISION_MODELS.test(model);
  const filesSupported = Boolean(capabilities?.file);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ai-chat/conversations/messages',
        credentials: 'include',
        prepareSendMessagesRequest: ({ messages: outgoing, body }) => ({
          api: `/api/ai-chat/conversations/${idRef.current}/messages`,
          body: {
            ...body,
            messages: outgoing,
            model: modelRef.current,
            reasoning: reasoningRef.current,
            ...currentScope(),
          },
        }),
      }),
    [],
  );
  /**
   * The conversation stays stuck to the bottom while the model writes - otherwise the
   * reply scrolls off screen and has to be chased with the mouse. Unless
   * the user scrolled up to read a passage: then nothing moves, they read
   * in peace, and following resumes as soon as they scroll back down.
   */
  const messagesArea = useRef<HTMLDivElement>(null);
  const followsBottom = useRef(true);
  const onScroll = () => {
    const zone = messagesArea.current;
    if (!zone) return;
    followsBottom.current = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 80;
  };
  /**
   * The floating panel stays mounted when collapsed (display: none): the area then loses
   * its position and, reopened, would start from the top. When it gets a
   * height again, we go back to the bottom: collapsing then reopening always shows the
   * last message. A mere resize (window, keyboard) only brings back
   * to the bottom if we were already there.
   */
  const observer = useRef<ResizeObserver | null>(null);
  const attachArea = useCallback((zone: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    messagesArea.current = zone;
    if (!zone) return;
    let height = zone.clientHeight;
    observer.current = new ResizeObserver(() => {
      const reappears = height === 0 && zone.clientHeight > 0;
      height = zone.clientHeight;
      if (reappears || followsBottom.current) zone.scrollTop = zone.scrollHeight;
    });
    observer.current.observe(zone);
  }, []);

  const {
    messages,
    sendMessage,
    status,
    error,
    setMessages,
    regenerate,
    stop,
    addToolApprovalResponse,
  } = useChat({
    transport,
    /**
     * Once all confirmations are given, the conversation resumes on its own:
     * without this, approving would run nothing and the assistant would stay stuck.
     */
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    // Server refusal (a reply is already in progress): shown as a toast, not raw JSON
    onError: (err) => {
      const readable = readableError(err);
      if (readable.status === 409) toast.error(readable.message);
      // Quota reached in the meantime (403): say so, and re-read access to close the composer
      if (readable.status === 403) {
        toast.error(readable.message);
        refreshQuota();
      }
    },
    // The quota gauge follows the reply that just finished
    onFinish: refreshQuota,
  });
  /**
   * Reply in progress on the server side that this thread does not receive as a stream. While
   * it is followed, the composer is in "stop" mode, the partial content
   * is shown and the indicator states the phase.
   */
  const [trackedReply, setTrackedReply] = useState<TrackedReply | null>(null);
  const trackedReplyRef = useRef<TrackedReply | null>(null);
  const updateTrackedReply = (value: TrackedReply | null) => {
    trackedReplyRef.current = value;
    setTrackedReply(value);
  };
  /**
   * A reply is expected or being written: the composer switches to "stop" mode.
   * Read from the stream and not from the statuses: between sending and the first chunk, the
   * reply does not exist yet as a message. Or followed from the server.
   */
  const busyLocally = status === 'submitted' || status === 'streaming';
  const busy = busyLocally || trackedReply !== null;
  const busyLocallyRef = useRef(false);
  useEffect(() => {
    busyLocallyRef.current = busyLocally;
  }, [busyLocally]);

  /**
   * Reopening a conversation must reopen its content: the thread starts empty, the
   * exchanges live in the database. They are re-read once per mount, then only
   * to follow a reply the server finishes without us. A thread that created
   * its conversation already holds all its content: re-reading while the reply
   * arrives would replace the stream with what is saved, the question alone.
   */
  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ['ai-chat-conversation', currentId],
    queryFn: () => api<{ messages: StoredMessage[] }>(`/api/ai-chat/conversations/${currentId ?? ''}`),
    enabled: Boolean(currentId) && (!createdHere || trackedReply !== null),
    /**
     * Nothing is cached: when leaving the page and coming back, a
     * stale version would have made the latest exchanges disappear - hence the
     * manual reload that used to be needed.
     */
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    // Safety net while following: a socket can drop silently
    refetchInterval: trackedReply ? 5000 : false,
  });
  /** What interrupted a reply kept with its partial content. */
  const errorsRef = useRef(new Map<string, string>());
  /**
   * Message timestamps. The stream carries none: the database date is taken
   * on re-read, and messages born in the session are stamped at the
   * moment they appear.
   */
  const datesRef = useRef(new Map<string, string>());
  /**
   * Model that wrote each reply.
   *
   * A conversation can switch models along the way - regeneration
   * explicitly allows it. Showing the current model on an old reply
   * would therefore be wrong: each message keeps its own, re-read from the database or
   * stamped at the moment it appears.
   */
  const modelsRef = useRef(new Map<string, string>());
  useEffect(() => {
    const now = new Date().toISOString();
    for (const message of messages) {
      if (!datesRef.current.has(message.id)) datesRef.current.set(message.id, now);
      if (message.role === 'assistant' && !modelsRef.current.has(message.id)) {
        modelsRef.current.set(message.id, modelRef.current);
      }
    }
  }, [messages]);

  /**
   * Leaving the screen closes the stream: that is what tells the server that
   * the user has left. The reply, however, goes on and finishes on the server
   * side; it is found again when reopening the conversation, and an in-app
   * notification announces its end.
   */
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  /**
   * Stopping means stopping the server: since the reply finishes in the
   * background, closing the stream would no longer be enough, the model would keep writing.
   */
  const stopReply = () => {
    void stop();
    if (idRef.current) {
      void api(`/api/ai-chat/conversations/${idRef.current}/stop`, { method: 'POST' }).catch(
        (err: Error) => toast.error(err.message),
      );
    }
  };

  // Follow the thread while the model types: each piece of reply brings
  // the view back to the bottom, as long as the user has not scrolled up to read something.
  useEffect(() => {
    const zone = messagesArea.current;
    if (!zone || !followsBottom.current) return;
    zone.scrollTop = zone.scrollHeight;
  }, [messages, status]);

  // The end notification comes from the global listener (see replies-store.ts): here, only the switch
  const { offerable, active, requesting, toggle } = useReplyNotification();

  const hasRead = useRef(false);
  useEffect(() => {
    if (!detail) return;
    // First read, or resync of a reply followed from the server
    if (hasRead.current && !trackedReplyRef.current) return;
    hasRead.current = true;
    for (const message of detail.messages) {
      datesRef.current.set(message.id, message.createdAt);
      if (message.model) modelsRef.current.set(message.id, message.model);
      if (message.error && message.status !== 'DONE') {
        errorsRef.current.set(message.id, message.error);
      }
    }
    setMessages(
      detail.messages
        // A row without content is an error trace: it has nothing to say here.
        // The reply in progress, however, is shown separately, with its indicator.
        .filter(
          (message) =>
            message.content.trim() && message.role !== 'TOOL' && message.status !== 'RUNNING',
        )
        .map((message) => ({
          id: message.id,
          role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
          parts: [{ type: 'text' as const, text: message.content }],
        })),
    );
    const running = detail.messages.find((message) => message.status === 'RUNNING');
    const previous = trackedReplyRef.current;
    const same = previous !== null && previous.messageId === running?.id;
    updateTrackedReply(
      running
        ? {
            messageId: running.id,
            // Events are fresher than the database: never go backwards
            content:
              same && previous.content.length > running.content.length
                ? previous.content
                : running.content,
            phase: same ? previous.phase : 'thinking',
            tool: same ? previous.tool : undefined,
          }
        : null,
    );
  }, [detail, setMessages]);

  /**
   * Following a reply the server finishes without this thread: each event
   * brings the text snapshot and the phase; the last one says the final
   * message is in the database, which is then re-read.
   */
  useEffect(
    () =>
      listen<ReplyEvent>('chat:reply', (event) => {
        // The cost of a reply is written before this event: the gauge can follow,
        // whatever the conversation and wherever it was asked
        if (event.finished) refreshQuota();
        if (event.conversationId !== idRef.current) return;
        // This thread receives the reply as a stream: the stream is authoritative, the event adds nothing
        if (busyLocallyRef.current) return;
        if (!event.finished) {
          updateTrackedReply({
            messageId: event.messageId,
            content: event.content,
            phase: event.phase,
            tool: event.tool,
          });
          return;
        }
        if (trackedReplyRef.current?.messageId !== event.messageId) return;
        if (event.error) {
          toast.error(t('thread.toast.unfinished', { error: event.error }));
        }
        void refetchDetail();
      }),
    [refetchDetail, refreshQuota, t],
  );

  const send = async (forcedText?: string) => {
    const text = (forcedText ?? draft).trim();
    if (!text || (!projectId && !workspace) || quotaReached) return;

    if (!currentId) {
      // The conversation is born now, with a title taken from the question
      const created = await api<Conversation>('/api/ai-chat/conversations', {
        method: 'POST',
        body: {
          projectId,
          title: text.slice(0, 80),
          // Born in the floating assistant: its scope will follow navigation
          followsNavigation: Boolean(followedScopeRef.current),
        },
      }).catch((err: Error) => {
        toast.error(err.message);
        return null;
      });
      if (!created) return;
      idRef.current = created.id;
      setCurrentId(created.id);
      setCreatedHere(true);
      onCreated(created.id);
    }

    /**
     * Fate of each attachment, decided now that the model is known:
     * - a PDF goes intact to a model that reads files, its layout
     *   and tables being then preserved;
     * - otherwise the text extracted on our side goes with the question, which
     *   any model can read;
     * - office formats always go through text, since no model
     *   reads an Excel workbook in its original format.
     */
    const native = attachments.filter(
      (attachment) =>
        attachment.dataUrl &&
        ((attachment.kind === 'image' && imagesSupported) ||
          (attachment.kind === 'pdf' && filesSupported)),
    );
    const asText = attachments.filter((attachment) => !native.includes(attachment));

    /**
     * Neither natively readable nor convertible to text: an image given to a
     * model without vision, a scanned PDF without a text layer. It must
     * not be sent - the provider would reject the whole call, and the question
     * would go down with it. It is removed, and we say why.
     */
    const unreadable = asText.filter((attachment) => !attachment.text?.trim());
    if (unreadable.length) {
      toast.warning(
        t('thread.toast.attachmentsNotSent', {
          names: unreadable.map((attachment) => attachment.name).join(', '),
          model: modelLabel(model, access.modelLabels),
        }),
        { duration: 8000 },
      );
    }

    const context = asText
      .filter((attachment) => attachment.text?.trim())
      // The end is marked explicitly: the server replaces these two markers
      // with a random delimiter before calling the model.
      .map(
        (attachment) =>
          // i18n-ignore client/server protocol markers (replaced server side, hidden on display)
          `--- DOCUMENT JOINT : ${attachment.name} ---\n${attachment.text ?? ''}\n--- FIN DU DOCUMENT ---`,
      )
      .join('\n\n');

    setDraft('');
    setAttachments([]);
    void sendMessage({
      text: context ? `${text}\n\n${context}` : text,
      files: native.map((attachment) => ({
        type: 'file' as const,
        filename: attachment.name,
        mediaType: attachment.mediaType ?? (attachment.kind === 'pdf' ? 'application/pdf' : 'image/png'),
        url: attachment.dataUrl!,
      })),
    });
  };

  /** Is the last message unrolling its reasoning? */
  const reasoningInProgress =
    messages[messages.length - 1]?.parts.some(
      (part) => part.type === 'reasoning' && part.state === 'streaming',
    ) ?? false;

  /**
   * Model change, wherever it comes from: the composer selector or the
   * "regenerate with" menu. A single path, otherwise the two diverge - and
   * regenerating with another model without reflecting it at the bottom of the screen would
   * suggest that the rest of the conversation goes on with the old one.
   */
  const changeModel = (value: string) => {
    modelRef.current = value;
    setModel(value);

    /**
     * Changing model changes what is readable. An attachment the new
     * model could not use is removed on the spot, saying
     * so: keeping it would give the illusion it will be analysed.
     */
    const targetCapabilities = access.modelCapabilities?.[value];
    const images = targetCapabilities ? targetCapabilities.image : VISION_MODELS.test(value);
    const files = Boolean(targetCapabilities?.file);
    const kept = attachments.filter((attachment) => isAttachmentUsable(attachment, images, files));
    if (kept.length !== attachments.length) {
      const removed = attachments
        .filter((attachment) => !kept.includes(attachment))
        .map((attachment) => attachment.name);
      toast.warning(
        t('thread.toast.attachmentsRemoved', {
          names: removed.join(', '),
          model: modelLabel(value, access.modelLabels),
        }),
        { duration: 8000 },
      );
      setAttachments(kept);
    }
  };

  /**
   * The messages as the thread renders them. Computed on every render, without
   * memoization: dates and models are stamped by an effect, and
   * must appear on the following render without waiting for a new chunk.
   */
  const statuses = statusesOf(messages, status);
  const displayed: DisplayedMessage[] = messages.map((message) => ({
    message,
    status: statuses.get(message.id) ?? 'done',
    date: datesRef.current.get(message.id) ?? null,
    model: modelsRef.current.get(message.id) ?? null,
  }));

  const composer = (
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        attachments={attachments}
        onAttachments={setAttachments}
        model={model}
        models={access.models}
        labels={access.modelLabels}
        onModel={changeModel}
        reasoning={reasoning}
        onReasoning={(level) => {
          reasoningRef.current = level;
          setReasoning(level);
        }}
        scope={{
          workspace: { name: workspace.name },
          // The projects the user can see (scope of their permissions): nothing to filter here.
          projects,
          projectId,
          onProject: setChosenProjectId,
          // From the first question, the scope is frozen: replies already
          // given rely on it, changing it would make the thread inconsistent.
          locked: Boolean(currentId),
          // Floating assistant conversation: the scope follows navigation,
          // in the panel as in the Assistant page where it is reopened.
          followsNavigation: Boolean(followedScope) || Boolean(conversation?.followsNavigation),
        }}
        imagesSupported={imagesSupported}
        filesSupported={filesSupported}
        busy={busy}
        onStop={stopReply}
        autoFocus={!conversation}
        dictation={Boolean(access.dictation)}
        blockedMessage={quotaMessage}
      />
    );

  /** What the assistant is doing: read from the local stream, or from the reply followed from the server. */
  const phase = trackedReply
    ? { phase: trackedReply.phase, tool: trackedReply.tool }
    : localPhase(messages, status);

  /**
   * The thread header, the same on the home screen and in a conversation:
   * on the left what it is given, on the right the bell then the quota gauge, which
   * do not move a pixel from one screen to another. The floating assistant carries
   * both in its own header: nothing on the right in compact mode.
   */
  const [editingTitle, setEditingTitle] = useState(false);
  const rename = useMutation({
    mutationFn: (title: string) =>
      api(`/api/ai-chat/conversations/${conversation!.id}`, {
        method: 'PATCH',
        body: { title },
      }),
    onSuccess: () => {
      setEditingTitle(false);
      // Both lists (tab and floating assistant) share this key prefix
      void queryClient.invalidateQueries({ queryKey: ['ai-chat-conversations'] });
    },
    onError: (err) => {
      setEditingTitle(false);
      toast.error(err.message);
    },
  });

  const renderHeader = (left: ReactNode) => (
    // Phone: a single line, the title truncates rather than pushing the bell below
    <header className="flex flex-wrap items-center gap-2 border-b border-ai-border-subtle px-4 py-2 max-md:flex-nowrap max-md:px-3">
      {onOpenList ? (
        <button
          type="button"
          aria-label={t('list.title')}
          data-tooltip={t('thread.openList')}
          onClick={onOpenList}
          className={HEADER_BUTTON}
        >
          <PanelLeft className="size-4" />
        </button>
      ) : null}
      {left}
      {!compact ? (
        <span className="ml-auto flex items-center gap-1 max-md:shrink-0">
          {offerable ? (
            <button
              type="button"
              aria-label={t('notify.ariaLabel')}
              aria-pressed={active}
              disabled={requesting}
              data-tooltip={
                requesting ? t('notify.pending') : active ? t('notify.active') : t('notify.inactive')
              }
              onClick={() => void toggle(!active)}
              className={cn(HEADER_BUTTON, active && 'text-ai-accent hover:text-ai-accent')}
            >
              {/* Crossed-out bell while notifications are off: the state reads without a tooltip */}
              {active ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            </button>
          ) : null}
          <QuotaGauge quota={access.quota} className="mx-1" />
        </span>
      ) : null}
    </header>
  );

  // Home screen: the question is in the center, as in a real assistant.
  // `m-auto` on the block: centered when it fits, scrolling otherwise (short panel).
  if (!currentId && !messages.length) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The same header as in an open conversation, discreet title on the left */}
        {!compact
          ? renderHeader(
              <span className="flex items-center gap-1.5 text-ai-sm text-ai-secondary">
                <Sparkles className="size-4 text-[#7c4dff]" />
                {t('conversations.new')}
              </span>,
            )
          : null}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-y-auto',
            compact ? 'px-3' : 'px-6 max-md:px-3',
          )}
        >
          <div className={cn('m-auto w-full', compact ? 'py-4' : 'max-w-2xl max-md:py-4')}>
            <Sphere
              className={cn('mx-auto', compact ? 'mb-4 size-24' : 'mb-6 size-40 max-md:size-28')}
            />
            <h1
              className={cn(
                'text-center font-semibold text-ai-primary',
                compact ? 'mb-3 text-lg' : 'mb-5 text-2xl',
              )}
            >
              {t('thread.welcome')}
            </h1>

            {composer}

            {(projectId || workspace) && !quotaReached ? (
              <div className="mt-5">
                <p className="mb-1 text-ai-xs text-ai-muted">{t('thread.suggestions.title')}</p>
                {(projectId ? PROJECT_SUGGESTIONS : GLOBAL_SUGGESTIONS).map((key) => {
                  const suggestion = tDyn(t, `thread.suggestions.${projectId ? 'project' : 'global'}.${key}`);
                  return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="flex w-full items-center gap-2 border-t border-ai-border-subtle px-1 py-2 text-left text-ai-sm text-ai-secondary hover:text-ai-primary max-md:min-h-10"
                  >
                    <span className="text-ai-muted">↳</span>
                    {suggestion}
                  </button>
                  );
                })}
              </div>
            ) : null}

            <p className="mt-6 text-center text-[11px] text-ai-muted">
              {access.level === 'READ' ? t('thread.disclaimerReadOnly') : t('thread.disclaimer')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    // `min-h-0`: without it, a flex child does not shrink below the height of
    // its content, and in the floating panel (640 px) the thread overflowed the
    // frame instead of scrolling: no scrollbar, and nothing followed the reply.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {renderHeader(
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-ai-sm text-ai-primary">
            {/* The AI tools purple (see `ai-etincelle` in app.css), not the link blue */}
            <Sparkles className="size-4 shrink-0 text-[#7c4dff]" />
            {conversation && editingTitle ? (
              <EditableTitle
                value={conversation.title}
                onConfirm={(title) => rename.mutate(title)}
                onCancel={() => setEditingTitle(false)}
                className="text-ai-sm"
              />
            ) : conversation ? (
              // The title is renamed where it is shown: one click, type, Enter
              <button
                type="button"
                data-tooltip={t('thread.renameTooltip')}
                onClick={() => setEditingTitle(true)}
                className="truncate rounded-ai-sm px-1 py-0.5 text-left hover:bg-ai-surface-hover"
              >
                {conversation.title}
              </button>
            ) : (
              t('thread.untitled')
            )}
          </span>
          {access.level === 'READ' ? (
            <Badge tone="neutral" className="max-md:shrink-0">
              {t('thread.readOnly')}
            </Badge>
          ) : null}
        </>,
      )}

      <div
        ref={attachArea}
        onScroll={onScroll}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto',
          compact ? 'px-3 py-3' : 'px-4 py-4 max-md:px-3',
        )}
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {displayed.map(({ message, status: messageStatus, date, model: author }) => (
            <article
              key={message.id}
              data-status={messageStatus}
              className={cn(
                'group flex flex-col',
                message.role === 'user' ? 'items-end' : 'items-start',
              )}
            >
              <div
                className={cn(
                  'rounded-ai-xl px-3.5 py-2.5 text-ai-sm',
                  message.role === 'user'
                    ? 'max-w-[80%] bg-ai-selected text-ai-primary max-md:max-w-[90%]'
                    : 'w-full bg-transparent text-ai-primary',
                )}
              >
                {message.parts.map((part, index) => {
                  if (part.type === 'text') {
                    if (message.role !== 'user') return <ReplyMarkdown key={index} text={part.text} />;
                    /**
                     * User question. The text of attached documents was
                     * added to it for the model: it is put back in its place -
                     * the question stays readable, the content expands on
                     * demand.
                     */
                    const { question, documents } = splitDocuments(part.text);
                    return (
                      <div key={index}>
                        {question ? (
                          <p className="whitespace-pre-wrap leading-relaxed">{question}</p>
                        ) : null}
                        {documents.map((document) => (
                          <AttachedDocument
                            key={document.name}
                            name={document.name}
                            content={document.content}
                          />
                        ))}
                      </div>
                    );
                  }
                  if (part.type === 'reasoning') {
                    return (
                      <Reasoning
                        key={index}
                        text={part.text}
                        inProgress={part.state === 'streaming'}
                      />
                    );
                  }
                  if (part.type === 'file') {
                    // Attachment sent as is: image or PDF read by the model
                    const name = ('filename' in part && part.filename) || t('thread.attachment');
                    const type = 'mediaType' in part ? String(part.mediaType) : '';
                    const url = 'url' in part ? String(part.url) : '';
                    return type.startsWith('image/') && url ? (
                      <img
                        key={index}
                        src={url}
                        alt={String(name)}
                        className="my-1 max-h-56 rounded-ai-lg border border-ai-border-subtle object-contain"
                      />
                    ) : (
                      <SentAttachmentCard key={index} name={String(name)} detail={t('thread.sentToModel')} />
                    );
                  }
                  if (part.type.startsWith('tool-')) {
                    return (
                      <ToolCall
                        key={index}
                        part={part}
                        description={
                          access.toolDescriptions?.[String(part.type).replace(/^tool-/, '')]
                        }
                        onDecision={(id, approved) =>
                          addToolApprovalResponse({ id, approved })
                        }
                      />
                    );
                  }
                  return null;
                })}
                {errorsRef.current.has(message.id) ? (
                  <p className="mt-1.5 text-[11px] text-ai-danger">
                    {t('thread.interrupted', { error: errorsRef.current.get(message.id) ?? '' })}
                  </p>
                ) : null}
              </div>

              <MessageActions
                text={message.parts
                  .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                  .map((part) => part.text)
                  .join('\n')}
                role={message.role}
                date={date}
                busy={busy}
                model={author}
                models={access.models}
                labels={access.modelLabels}
                onRetry={() => void regenerate({ messageId: message.id })}
                onRetryWith={(chosen) => {
                  if (chosen !== modelRef.current) changeModel(chosen);
                  // The replaced reply loses its old stamp: it
                  // will be rewritten by the model just chosen.
                  modelsRef.current.delete(message.id);
                  void regenerate({ messageId: message.id });
                }}
              />
            </article>
          ))}

          {/* Reply the server finishes without us: its text, as saved */}
          {trackedReply?.content ? (
            <article data-status="running" className="flex flex-col items-start">
              <div className="w-full rounded-ai-xl px-3.5 py-2.5 text-ai-sm text-ai-primary">
                <ReplyMarkdown text={trackedReply.content} />
              </div>
            </article>
          ) : null}
          {/* Silent while the reasoning line already speaks: one voice is enough */}
          {phase && !reasoningInProgress ? (
            <ReplyIndicator phase={phase.phase} tool={phase.tool} />
          ) : null}
          {error ? (
            <p className="rounded-ai-md bg-ai-danger-soft px-3 py-2 text-ai-xs text-ai-danger">
              {t('thread.failed', { error: readableError(error).message })}
            </p>
          ) : null}
        </div>
      </div>

      {/* Phone: the composer stays above the bottom safe area of the screen */}
      <footer
        className={
          compact
            ? 'px-3 pb-3'
            : 'px-4 pb-4 max-md:px-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))]'
        }
      >
        <div className="mx-auto max-w-3xl">{composer}</div>
      </footer>
    </div>
  );
}

/**
 * Message actions, revealed on hover: copy the text, and retry.
 * On a reply, retrying regenerates it; on a question, it resends it -
 * that is the expected action when a call failed along the way.
 */
function MessageActions({
  text,
  role,
  date,
  busy,
  model,
  models,
  labels,
  onRetry,
  onRetryWith,
}: {
  text: string;
  role: string;
  date: string | null;
  busy: boolean;
  /** Model that wrote THIS message, not the chat one. */
  model: string | null;
  models: string[];
  labels?: Record<string, string>;
  onRetry: () => void;
  onRetryWith: (model: string) => void;
}) {
  const t = useTranslations('aiChat.message');
  const formatDate = useChatDate();
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const buttonClass =
    'grid size-6 place-items-center rounded-ai-md text-ai-muted transition-colors hover:bg-ai-surface-hover hover:text-ai-primary disabled:opacity-40 max-md:size-10';

  return (
    // No hover on phone: actions stay visible, otherwise they are unreachable
    <div className="mt-0.5 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:flex-wrap max-md:opacity-100">
      <Tooltip content={copied ? t('copied') : t('copy')}>
        <button
          type="button"
          aria-label={t('copy')}
          onClick={() => void copy()}
          className={buttonClass}
        >
          {copied ? <Check className="size-3.5 text-ai-success" /> : <Copy className="size-3.5" />}
        </button>
      </Tooltip>
      {role === 'user' ? (
        <Tooltip content={t('resend')}>
          <button
            type="button"
            aria-label={t('resend')}
            disabled={busy}
            onClick={onRetry}
            className={buttonClass}
          >
            <RefreshCw className="size-3.5" />
          </button>
        </Tooltip>
      ) : (
        /* Regenerating often means wanting a second opinion: the model choice
           is offered where the user clicks, rather than changing it at the bottom
           of the screen before coming back to click here. */
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={busy}>
            <button
              type="button"
              aria-label={t('regenerate.ariaLabel')}
              data-tooltip={t('regenerate.tooltip')}
              disabled={busy}
              className={buttonClass}
            >
              <RefreshCw className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
            <DropdownMenuLabel>{t('regenerate.with')}</DropdownMenuLabel>
            {models.map((candidate) => (
              <DropdownMenuItem
                key={candidate}
                onSelect={() => onRetryWith(candidate)}
                className="flex items-center gap-2"
              >
                <ModelIcon model={candidate} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{modelLabel(candidate, labels)}</span>
                {candidate === model ? <Check className="size-3.5 shrink-0 text-ai-accent" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {model ? (
        <Tooltip content={model}>
          <span className="flex items-center gap-1 self-center pl-1 text-[11px] text-ai-muted">
            <ModelIcon model={model} className="size-3" />
            {modelLabel(model, labels)}
          </span>
        </Tooltip>
      ) : null}
      {date ? (
        <span className="self-center pl-1 text-[11px] text-ai-muted">{formatDate(date)}</span>
      ) : null}
    </div>
  );
}

/** Header inserted before the text of an attached document, at send time (protocol marker, never translated). */
const DOCUMENT_MARKER = /^--- DOCUMENT JOINT : (.+?) ---\n?/m;

/**
 * Separates the user question from the content of the documents added to it
 * for the model. Without this, a four-page document is shown in full
 * in the bubble and drowns the question.
 */
function splitDocuments(text: string): {
  question: string;
  documents: { name: string; content: string }[];
} {
  const start = text.search(DOCUMENT_MARKER);
  if (start === -1) return { question: text, documents: [] };

  const documents: { name: string; content: string }[] = [];
  // The split captures the name: ['', name1, content1, name2, content2…]
  const segments = text.slice(start).split(new RegExp(DOCUMENT_MARKER.source, 'm'));
  for (let index = 1; index < segments.length; index += 2) {
    documents.push({
      name: segments[index]!,
      // The end marker is for the server, not the reader
      content: (segments[index + 1] ?? '').replace(/\n?--- FIN DU DOCUMENT ---\s*$/, '').trim(),
    });
  }
  return { question: text.slice(0, start).trimEnd(), documents };
}

/** Compact card of a sent attachment, in the discussion thread. */
function SentAttachmentCard({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="my-1 flex items-center gap-2 rounded-ai-lg border border-ai-border-subtle bg-ai-sunken px-2.5 py-1.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-ai-sm bg-ai-danger-soft text-ai-danger">
        <FileType className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-ai-xs font-medium text-ai-primary">{name}</span>
        <span className="block truncate text-[11px] text-ai-muted">{detail}</span>
      </span>
    </span>
  );
}

/**
 * Attached document whose text was extracted: the attachment is visible, its content
 * stays collapsed - same principle as the model reasoning, for the same reason.
 */
function AttachedDocument({ name, content }: { name: string; content: string }) {
  const t = useTranslations('aiChat.document');
  const [open, setOpen] = useState(false);
  const size =
    content.length >= 1000
      ? t('thousandChars', { count: Math.round(content.length / 1000) })
      : t('chars', { count: content.length });

  return (
    <div className="my-1.5 overflow-hidden rounded-ai-lg border border-ai-border-subtle bg-ai-sunken">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-ai-surface-hover max-md:min-h-10"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-ai-sm bg-ai-danger-soft text-ai-danger">
          <FileType className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ai-xs font-medium text-ai-primary">{name}</span>
          <span className="block truncate text-[11px] text-ai-muted">{t('extracted', { size })}</span>
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-ai-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-ai-border-subtle px-2.5 py-2 text-[11px] leading-relaxed text-ai-secondary">
          {content}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * Model reasoning. It is collapsed by default: it is a reasoning draft,
 * useful to understand a surprising reply, cluttering otherwise.
 */
function Reasoning({ text, inProgress }: { text: string; inProgress: boolean }) {
  const t = useTranslations('aiChat.reasoning');
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;

  return (
    <div
      className={cn(
        'my-2 rounded-ai-lg border bg-ai-sunken transition-colors',
        inProgress ? 'border-[#9c6bff]/50' : 'border-ai-border-subtle',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-ai-muted hover:text-ai-secondary max-md:min-h-10"
      >
        <Brain className={cn('size-3.5', inProgress && 'animate-pulse text-[#9c6bff]')} />
        <span className={cn(inProgress && 'ai-reflexion font-medium')}>
          {inProgress ? t('inProgress') : t('title')}
        </span>
        <ChevronDown
          className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <p className="whitespace-pre-wrap px-3 pb-2 text-[11px] leading-relaxed text-ai-secondary">
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** Tool call: what the assistant looked up, or what it proposes to write. */
function ToolCall({
  part,
  description,
  onDecision,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: any;
  description?: string;
  onDecision: (id: string, approved: boolean) => void;
}) {
  const name = String(part.type).replace(/^tool-/, '');
  const [open, setOpen] = useState(false);

  // A pending write is not a trace: it is a decision to make
  if (part.state === 'approval-requested') {
    return <Approval name={name} part={part} description={description} onDecision={onDecision} />;
  }

  return (
    <div className="my-2 rounded-ai-lg border border-ai-border-subtle bg-ai-sunken">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-ai-muted hover:text-ai-secondary max-md:min-h-10"
      >
        <Wrench className="size-3.5 shrink-0" />
        <span className="font-ai-mono">{name}</span>
        <ChevronDown
          className={cn('ml-auto size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="px-3 pb-2">
          {part.input ? (
            <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-ai-secondary">
              {JSON.stringify(part.input, null, 2)}
            </pre>
          ) : null}
          {part.output ? (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-ai-secondary">
              {typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Confirmation request for a write. This is what matters most: the user
 * commits a change to their schedule, they must understand which one without
 * reading JSON. The technical detail stays available, but collapsed.
 */
function Approval({
  name,
  part,
  description,
  onDecision,
}: {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: any;
  description?: string;
  onDecision: (id: string, approved: boolean) => void;
}) {
  const t = useTranslations('aiChat.approval');
  const tActions = useTranslations('aiChat.actions');
  const { intlTag } = useDateFormat();
  const [detail, setDetail] = useState(false);
  const [decided, setDecided] = useState(false);
  // Identifiers (task, project, people, status…) read in plain words
  const resolve = useActionLabels(part.input);
  const { title, lines } = summarizeAction({ t: tActions, intlTag }, name, part.input, description, resolve);

  const answer = (approved: boolean) => {
    setDecided(true);
    onDecision(part.approval.id, approved);
  };

  return (
    <div
      data-ai-approval
      className="my-3 overflow-hidden rounded-ai-lg border border-ai-warning/50 bg-ai-surface shadow-ai-raised"
    >
      <div className="flex items-center gap-2 border-b border-ai-warning/30 bg-ai-warning-soft/60 px-3 py-2">
        <ShieldQuestion className="size-4 shrink-0 text-ai-warning" />
        <p className="text-ai-sm font-medium text-ai-primary">{t('title')}</p>
      </div>

      <div className="space-y-2.5 px-3 py-3">
        <p className="text-ai-sm text-ai-primary">
          {t.rich('request', {
            action: title.toLocaleLowerCase(intlTag),
            b: (chunk) => <span className="font-medium">{chunk}</span>,
          })}
        </p>

        {lines.length ? (
          <dl className="divide-y divide-ai-border-subtle rounded-ai-md border border-ai-border-subtle bg-ai-surface">
            {lines.map((line) => (
              <div
                key={line.label}
                className="flex items-baseline gap-3 px-2.5 py-1.5 max-md:flex-col max-md:gap-0.5"
              >
                <dt className="w-40 shrink-0 text-ai-xs text-ai-muted max-md:w-auto">{line.label}</dt>
                <dd className="min-w-0 flex-1 break-words text-ai-sm text-ai-primary">{line.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <p className="text-[11px] text-ai-secondary">{t('note')}</p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button disabled={decided} onClick={() => answer(true)} className="px-3">
            <Check className="size-3.5" /> {t('approve')}
          </Button>
          <Button variant="secondary" disabled={decided} onClick={() => answer(false)} className="px-3">
            <X className="size-3.5" /> {t('reject')}
          </Button>
          <button
            type="button"
            onClick={() => setDetail((shown) => !shown)}
            className="ml-auto flex items-center gap-1.5 text-[11px] text-ai-muted hover:text-ai-secondary max-md:min-h-10"
          >
            <Wrench className="size-3" />
            {t('technicalDetails')}
            <ChevronDown className={cn('size-3 transition-transform', detail && 'rotate-180')} />
          </button>
        </div>
        {detail ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-ai-md bg-ai-sunken p-2 text-[11px] text-ai-secondary">
            {name}
            {'\n'}
            {JSON.stringify(part.input, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-1 text-center">
      <p className="text-ai-sm font-medium text-ai-primary">{title}</p>
      <p className="text-ai-xs text-ai-secondary">{detail}</p>
    </div>
  );
}

/**
 * Why the chat is not usable, if it is not: the tab and
 * the floating assistant say the same thing, in the same order.
 */
export function unavailability(
  access: ChatAccess,
  t: ReturnType<typeof useTranslations<'aiChat'>>,
): { title: string; detail: string } | null {
  if (!access.enabled) {
    return { title: t('unavailability.disabled.title'), detail: t('unavailability.disabled.detail') };
  }
  if (access.level === 'NONE') {
    return { title: t('unavailability.forbidden.title'), detail: t('unavailability.forbidden.detail') };
  }
  if (!access.configured) {
    return { title: t('unavailability.notConfigured.title'), detail: t('unavailability.notConfigured.detail') };
  }
  return null;
}
