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
import { ReplyMarkdown } from "./reply-markdown";
import { EditableTitle } from "./editable-title";
import type { ReplyEvent, ReplyPhase, ReplyStatus } from "./replies-store";
import { useReplyNotification } from "./use-reply-notification";
import { tDyn } from "@/i18n/dynamic";
import { copyText } from "@/lib/utils/clipboard";
import { forModel, mergeContinuations, restoredParts, type StoredMeta } from "./lib/stored-messages";
import { toolSummary } from "./lib/tool-summary";

/**
 * The AI chat thread, shared between the Assistant page (full
 * page) and the floating assistant (bottom-right panel): a single code base for
 * the composer, reply rendering, write confirmations and
 * regeneration. Both work on the whole planning, within the user's rights; in the
 * floating assistant, the tools also follow the page being viewed.
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
  /** Steps of the reply as they were drawn (reasoning, tools, text); null: question, or reply from before. */
  parts?: UIMessage['parts'] | null;
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

// i18n-dynamic: aiChat.thread.suggestions.*

/** The column of the thread (messages, composer, welcome), centred: the same width on every screen, 832 px. */
const COLUMN = 'mx-auto max-w-[52rem]';

/** Starter prompts offered on opening (`thread.suggestions.global.<id>`): they show what the assistant can do. */
const SUGGESTIONS = ['availableNextWeek', 'summaryByTeam', 'overBudget', 'unassigned'];

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
  access,
  onCreated,
  followsNavigation = false,
  compact,
  onOpenList,
}: {
  conversation: Conversation | null;
  access: ChatAccess;
  onCreated: (id: string) => void;
  /** Floating assistant: the page being viewed is sent with each message (its tools). */
  followsNavigation?: boolean;
  /** Narrow panel: tighter home, smaller sphere. */
  compact?: boolean;
  /** Phone: opens the conversations drawer from the thread header. */
  onOpenList?: () => void;
}) {
  const t = useTranslations('aiChat');
  const { intlTag } = useDateFormat();
  const queryClient = useQueryClient();
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

  /**
   * Capabilities of the current model. They come from the OpenRouter catalog, so
   * from the provider itself; the pattern fallback is only used if the catalog
   * is unreachable.
   */
  const capabilities = access.modelCapabilities?.[model];
  const imagesSupported = capabilities ? capabilities.image : VISION_MODELS.test(model);
  const filesSupported = Boolean(capabilities?.file);
  /** What each model can read, under its name in the model menu. */
  const modelDescriptions = Object.fromEntries(
    access.models.map((candidate) => {
      const known = access.modelCapabilities?.[candidate];
      const images = known ? known.image : VISION_MODELS.test(candidate);
      return [
        candidate,
        t(images && known?.file ? 'composer.modelReads.imagesAndPdf' : images ? 'composer.modelReads.images' : 'composer.modelReads.documents'),
      ];
    }),
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ai-chat/conversations/messages',
        credentials: 'include',
        prepareSendMessagesRequest: ({ messages: outgoing, body }) => ({
          api: `/api/ai-chat/conversations/${idRef.current}/messages`,
          body: {
            ...body,
            // The re-read messages go back as their text: their steps are for display
            messages: forModel(outgoing),
            model: modelRef.current,
            reasoning: reasoningRef.current,
            /**
             * The page being viewed, read on send (floating assistant only): the screen may
             * have changed since the transport was built, and the server only declares its
             * tools to the model.
             */
            ...(followsNavigation ? { page: pageFromPath(window.location.pathname) } : {}),
          },
        }),
      }),
    [followsNavigation],
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
      mergeContinuations(
        detail.messages
          // The reply in progress is shown separately, with its indicator
          .filter((message) => message.role !== 'TOOL' && message.status !== 'RUNNING')
          .map((message) => ({
            id: message.id,
            role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
            // Its steps as they were seen (reasoning, tools, text), else its text
            parts: restoredParts(message.parts, message.content),
            metadata: { stored: true, text: message.content } satisfies StoredMeta,
          }))
          // A row with nothing to draw is an error trace: it has nothing to say here
          .filter((message) => message.parts.length > 0),
      ),
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
    if (!text || quotaReached) return;

    if (!currentId) {
      // The conversation is born now, with a title taken from the question
      const created = await api<Conversation>('/api/ai-chat/conversations', {
        method: 'POST',
        body: {
          title: text.slice(0, 80),
          // Born in the floating assistant: its tools will follow navigation
          followsNavigation,
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
        modelDescriptions={modelDescriptions}
        onModel={changeModel}
        reasoning={reasoning}
        onReasoning={(level) => {
          reasoningRef.current = level;
          setReasoning(level);
        }}
        imagesSupported={imagesSupported}
        filesSupported={filesSupported}
        busy={busy}
        onStop={stopReply}
        autoFocus={!conversation}
        dictation={Boolean(access.dictation)}
        blockedMessage={quotaMessage}
        grow={!compact}
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

  const welcome = (
    <h1 className={cn('text-center font-semibold text-ai-primary', compact ? 'mb-3 text-lg' : 'mb-5 text-2xl')}>
      {t('thread.welcome')}
    </h1>
  );

  // Home screen: the question is in the center, as in a real assistant; the block scrolls when the
  // window is too short for it.
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
          {/* Panel: the sphere takes the free height above, the question and the suggestions reach the
              bottom, with no blank under them. Full page: the question field sits in the middle of the page,
              the sphere and the title in the half above it, the suggestions in the half below. */}
          <div
            className={cn(
              'flex min-h-full w-full flex-col',
              compact ? 'py-4' : cn(COLUMN, 'py-6 max-md:py-4'),
            )}
          >
            <div
              className={cn(
                'flex flex-1 flex-col',
                compact ? 'min-h-32 items-center justify-center' : 'justify-end',
              )}
            >
              <Sphere
                className={cn('mx-auto', compact ? 'mb-4 size-28' : 'mb-6 size-40 max-md:size-28')}
              />
              {!compact ? welcome : null}
            </div>
            {compact ? welcome : null}

            {composer}

            <div className={cn(!compact && 'flex-1')}>
              {!quotaReached ? (
                <div className="mt-5">
                  <p className="mb-1 text-ai-xs text-ai-muted">{t('thread.suggestions.title')}</p>
                  {SUGGESTIONS.map((key) => {
                    const suggestion = tDyn(t, `thread.suggestions.global.${key}`);
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
            </div>
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
        <div className={cn(COLUMN, 'space-y-4')}>
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
                  'rounded-ai-xl px-5 py-3 text-ai-md',
                  message.role === 'user'
                    ? 'max-w-[80%] bg-ai-selected text-ai-primary max-md:max-w-[90%]'
                    : // A reply has no bubble: no room above it, under the question (nor above its first block)
                      'w-full bg-transparent pt-1 text-ai-primary [&>:first-child]:mt-0',
                )}
              >
                {groupParts(message.parts).map((item) => {
                  // Reasonings and lookups in a row: one line that unfolds, not one line each
                  if (item.kind === 'steps') return <Steps key={item.index} parts={item.parts} />;
                  const { part, index } = item;
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
                // Each block without the blank lines a model often writes around it (after its reasoning, between
                // two tool calls): pasted in the field, they showed as an empty line above the text
                text={message.parts
                  .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                  .map((part) => part.text.trim())
                  .filter(Boolean)
                  .join('\n\n')}
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
        <div className={COLUMN}>{composer}</div>
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
    if (!(await copyText(text))) {
      toast.error(t('copyFailed'));
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const buttonClass =
    'grid size-6 place-items-center rounded-ai-md text-ai-muted transition-colors hover:bg-ai-surface-hover hover:text-ai-primary disabled:opacity-40 max-md:size-10';

  return (
    // No hover on phone: actions stay visible, otherwise they are unreachable.
    // Lined up with the text of the bubble (`px-5`), not with its rounded edge: the icons of a reply start
    // under its first letter (their 24 px button has 5 px around the icon, and the drawing of the icon a little
    // more inside it); the date of a question ends just inside the rounded corner of its bubble.
    <div
      className={cn(
        'mt-1 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:flex-wrap max-md:opacity-100',
        role === 'user' ? 'pr-1.5' : 'pl-[18px] max-md:pl-2.5',
      )}
    >
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
 * useful to understand a surprising reply, cluttering otherwise. Plain text that
 * unfolds, with no frame: it must not look like part of the answer.
 */
function Reasoning({ text, inProgress }: { text: string; inProgress: boolean }) {
  const t = useTranslations('aiChat.reasoning');
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;

  return (
    <div className="my-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex items-center gap-1.5 text-ai-sm text-ai-muted transition-colors hover:text-ai-secondary max-md:min-h-10"
      >
        <Brain className={cn('size-3.5', inProgress && 'animate-pulse text-[#9c6bff]')} />
        <span className={cn(inProgress && 'ai-reflexion font-medium')}>
          {inProgress ? t('inProgress') : t('title')}
        </span>
        <ChevronDown className={cn('size-3.5 transition-transform', open ? 'rotate-0' : '-rotate-90')} />
      </button>
      {open ? (
        // Under the title, after the icon: the draft reads apart from the answer
        <p className="mt-1.5 whitespace-pre-wrap pl-5 text-ai-sm leading-relaxed text-ai-muted">{text}</p>
      ) : null}
    </div>
  );
}

/**
 * The parts of a reply as they are drawn: the reasonings and the lookups of tools that follow one another (a
 * model that searches alternates them, often many times) are gathered in one group; a write waiting for
 * approval stays alone, it is a decision; the step markers draw nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPart = any;
type DrawnPart = { kind: 'part'; part: AnyPart; index: number } | { kind: 'steps'; parts: AnyPart[]; index: number };

const isLookup = (part: AnyPart) => String(part.type).startsWith('tool-') && part.state !== 'approval-requested';
const isReasoning = (part: AnyPart) => part.type === 'reasoning';
const toolNameOf = (part: AnyPart) => String(part.type).replace(/^tool-/, '');

function groupParts(parts: AnyPart[]): DrawnPart[] {
  const drawn: DrawnPart[] = [];
  parts.forEach((part, index) => {
    if (part.type === 'step-start') return;
    // A reasoning left empty (some models open one without writing in it): nothing to show
    if (isReasoning(part) && !String(part.text ?? '').trim() && part.state !== 'streaming') return;
    const step = isLookup(part) || isReasoning(part);
    const last = drawn.at(-1);
    if (step && last?.kind === 'steps') last.parts.push(part);
    else if (step) drawn.push({ kind: 'steps', parts: [part], index });
    else drawn.push({ kind: 'part', part, index });
  });
  return drawn;
}

/**
 * A group of steps: a reasoning alone, lookups alone, or both mixed - then one line for all of them, so that a
 * model that searches long does not push its answer down.
 */
function Steps({ parts }: { parts: AnyPart[] }) {
  if (parts.length === 1 && isReasoning(parts[0])) {
    return <Reasoning text={parts[0].text} inProgress={parts[0].state === 'streaming'} />;
  }
  if (!parts.some(isReasoning)) return <ToolGroup parts={parts} />;
  return <StepsGroup parts={parts} />;
}

/** A write waiting for the user's approval: the decision card. */
function ToolCall({
  part,
  description,
  onDecision,
}: {
  part: AnyPart;
  description?: string;
  onDecision: (id: string, approved: boolean) => void;
}) {
  const name = String(part.type).replace(/^tool-/, '');
  return <Approval name={name} part={part} description={description} onDecision={onDecision} />;
}

/**
 * The tools the assistant used, in a row: one line of text that unfolds (like the reasoning), with no
 * frame, then each tool unfolds on its parameters and its result.
 */
function ToolGroup({ parts }: { parts: AnyPart[] }) {
  const t = useTranslations('aiChat.toolGroup');
  const [open, setOpen] = useState(false);
  const names = parts.map(toolNameOf);
  const running = parts.some((part) => part.state === 'input-streaming' || part.state === 'input-available');

  return (
    <div className="my-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex max-w-full items-center gap-1.5 text-left text-ai-sm text-ai-muted transition-colors hover:text-ai-secondary max-md:min-h-10"
      >
        <Wrench className={cn('size-3.5 shrink-0', running && 'animate-pulse text-[#9c6bff]')} />
        <span className="shrink-0">{running ? t('running') : t('used', { count: parts.length })}</span>
        <span className="min-w-0 truncate font-ai-mono text-[12px]">· {toolSummary(names)}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open ? 'rotate-0' : '-rotate-90')} />
      </button>
      {open ? (
        <div className="mt-1 space-y-1 pl-5">
          {parts.map((part, index) => (
            <ToolDetail key={part.toolCallId ?? index} name={names[index]} part={part} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reasonings and lookups mixed, in one line: « 6 réflexions et 6 outils utilisés · list-users ×4, … ». Unfolded,
 * they come back in their order, each one unfolding in turn. While the model works, the line says what it does.
 */
function StepsGroup({ parts }: { parts: AnyPart[] }) {
  const t = useTranslations('aiChat.toolGroup');
  const tReasoning = useTranslations('aiChat.reasoning');
  const [open, setOpen] = useState(false);
  const tools = parts.filter(isLookup);
  const reasonings = parts.filter(isReasoning);
  const thinking = reasonings.some((part) => part.state === 'streaming');
  const searching = tools.some((part) => part.state === 'input-streaming' || part.state === 'input-available');
  const label = thinking
    ? tReasoning('inProgress')
    : searching
      ? t('running')
      : t('withReasoning', { reasoning: reasonings.length, count: tools.length });

  return (
    <div className="my-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex max-w-full items-center gap-1.5 text-left text-ai-sm text-ai-muted transition-colors hover:text-ai-secondary max-md:min-h-10"
      >
        {thinking ? (
          <Brain className="size-3.5 shrink-0 animate-pulse text-[#9c6bff]" />
        ) : (
          <Wrench className={cn('size-3.5 shrink-0', searching && 'animate-pulse text-[#9c6bff]')} />
        )}
        <span className={cn('shrink-0', thinking && 'ai-reflexion font-medium')}>{label}</span>
        {tools.length ? (
          <span className="min-w-0 truncate font-ai-mono text-[12px]">· {toolSummary(tools.map(toolNameOf))}</span>
        ) : null}
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open ? 'rotate-0' : '-rotate-90')} />
      </button>
      {open ? (
        <div className="mt-1 space-y-1 pl-5">
          {parts.map((part, index) =>
            isReasoning(part) ? (
              <ReasoningDetail key={index} text={String(part.text ?? '')} />
            ) : (
              <ToolDetail key={part.toolCallId ?? index} name={toolNameOf(part)} part={part} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One reasoning of a group: its title, then its text. */
function ReasoningDetail({ text }: { text: string }) {
  const t = useTranslations('aiChat.reasoning');
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex items-center gap-1 text-[12px] text-ai-muted transition-colors hover:text-ai-secondary max-md:min-h-10"
      >
        <Brain className="size-3 shrink-0" />
        {t('title')}
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', open ? 'rotate-0' : '-rotate-90')} />
      </button>
      {open ? (
        <p className="mt-1 whitespace-pre-wrap border-l border-ai-border-subtle pl-3 text-ai-sm leading-relaxed text-ai-muted">
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** One tool of a group: its name, then what it was given and what it answered. */
function ToolDetail({ name, part }: { name: string; part: AnyPart }) {
  const t = useTranslations('aiChat.toolGroup');
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex items-center gap-1 font-ai-mono text-[12px] text-ai-muted transition-colors hover:text-ai-secondary max-md:min-h-10"
      >
        {name}
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', open ? 'rotate-0' : '-rotate-90')} />
      </button>
      {open ? (
        // `leading-4`: the JSON keeps its own line height, not the 24 px of the messages around it
        <div className="mt-1 space-y-1.5 border-l border-ai-border-subtle pl-3 text-[11px] leading-4 text-ai-secondary">
          {part.input ? (
            <div>
              <p className="text-ai-muted">{t('input')}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(part.input, null, 2)}</pre>
            </div>
          ) : null}
          {part.output !== undefined ? (
            <div>
              <p className="text-ai-muted">{t('output')}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                {typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)}
              </pre>
            </div>
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
