"use client";

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  ArrowUp,
  Brain,
  FileSpreadsheet,
  FileText,
  FileType,
  Gauge,
  ImageOff,
  Loader2,
  Mic,
  Paperclip,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Select } from "./ui/select";
import { Tooltip } from "./ui/misc";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import { tDyn } from "@/i18n/dynamic";
import { ModelIcon } from "./model-icon";
import { modelLabel } from "./models";
import { ScopeSelect, type ScopeProject } from "./scope-select";
import { DICTATION_AVAILABLE, useDictation } from "./use-dictation";

export interface Attachment {
  name: string;
  /** `pdf` carries both forms: the document and its extracted text. */
  kind: 'text' | 'image' | 'pdf';
  text?: string;
  mediaType?: string;
  dataUrl?: string;
  /** Amount actually read from the document, to show to the user. */
  characters?: number;
}

/** Icon and color per document family: a spreadsheet is recognised at a glance. */
const APPEARANCE: Record<string, { icon: LucideIcon; tint: string }> = {
  pdf: { icon: FileType, tint: 'bg-ai-danger-soft text-ai-danger' },
  xlsx: { icon: FileSpreadsheet, tint: 'bg-ai-success-soft text-ai-success' },
  xls: { icon: FileSpreadsheet, tint: 'bg-ai-success-soft text-ai-success' },
  csv: { icon: FileSpreadsheet, tint: 'bg-ai-success-soft text-ai-success' },
  docx: { icon: FileText, tint: 'bg-ai-info-soft text-ai-info' },
  txt: { icon: FileText, tint: 'bg-ai-sunken text-ai-secondary' },
};

/**
 * Loaded attachment: thumbnail for an image, typed badge for a
 * document, and above all what was extracted from it - it is the only way to know,
 * before sending, that the file was actually read.
 */
function AttachmentCard({
  attachment,
  imagesSupported,
  filesSupported,
  onRemove,
}: {
  attachment: Attachment;
  imagesSupported: boolean;
  filesSupported: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations('aiChat.composer.piece');
  const { formatNumber } = useDateFormat();
  const extension = attachment.name.split('.').pop()?.toLowerCase() ?? '';
  const appearance = APPEARANCE[extension] ?? { icon: FileText, tint: 'bg-ai-sunken text-ai-secondary' };
  const Icon = appearance.icon;

  // Below a thousand, rounding would show "0 k": count exactly then
  const volume =
    attachment.characters && attachment.characters >= 1000
      ? t('thousandCharsRead', { count: formatNumber(attachment.characters / 1000, { maximumFractionDigits: 1 }) })
      : t('charsRead', { count: attachment.characters ?? 0 });

  /**
   * What the attachment will become when sent. Saying it avoids a bad surprise:
   * a PDF given to a model that reads files keeps its tables, converted
   * to text it loses them, and a scan without text is only readable by the former.
   */
  const detail =
    attachment.kind === 'image'
      ? imagesSupported
        ? t('image')
        : t('imageUnread')
      : attachment.kind === 'pdf'
        ? filesSupported
          ? t('pdfNative')
          : attachment.characters
            ? `PDF · ${volume}`
            : t('pdfNoText')
        : attachment.characters
          ? `${extension.toUpperCase()} · ${volume}`
          : extension.toUpperCase();

  const warning =
    (attachment.kind === 'image' && !imagesSupported) ||
    (attachment.kind === 'pdf' && !filesSupported && !attachment.characters);

  return (
    <div
      data-tooltip-row="auto"
      className="group/piece flex items-center gap-2 rounded-ai-lg border border-ai-border-subtle bg-ai-surface p-1.5"
    >
      {attachment.kind === 'image' && attachment.dataUrl ? (
        <img src={attachment.dataUrl} alt="" className="size-9 shrink-0 rounded-ai-sm object-cover" />
      ) : (
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-ai-sm', appearance.tint)}>
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ai-xs font-medium text-ai-primary">{attachment.name}</span>
        <span className={cn('block truncate text-[11px]', warning ? 'text-ai-warning' : 'text-ai-muted')}>
          {detail}
        </span>
      </span>
      <button
        type="button"
        aria-label={t('remove', { name: attachment.name })}
        onClick={onRemove}
        className="grid size-6 shrink-0 place-items-center rounded-ai-md text-ai-muted hover:bg-ai-surface-hover hover:text-ai-danger max-md:size-9"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high';

/** Office documents: their text is extracted here, any model can read it. */
const DOCUMENT_FORMATS = '.pdf,.docx,.xlsx,.xls,.csv,.txt,application/pdf';
const IMAGE_FORMATS = '.png,.jpg,.jpeg,.webp,.gif,image/*';

/**
 * What the file dialog offers, depending on the model: no point letting
 * the user pick an image for a model that cannot see - better not to show it.
 */
export const acceptedFormats = (imagesSupported: boolean) =>
  imagesSupported ? `${DOCUMENT_FORMATS},${IMAGE_FORMATS}` : DOCUMENT_FORMATS;

/**
 * Is an attachment usable by the current model? An image requires
 * vision; a PDF goes either natively or through its text; office
 * formats always go through, their text being extracted on our side.
 */
export const isAttachmentUsable = (
  attachment: Attachment,
  imagesSupported: boolean,
  filesSupported: boolean,
) =>
  attachment.kind === 'image'
    ? imagesSupported
    : attachment.kind === 'pdf'
      ? filesSupported || Boolean(attachment.text?.trim())
      : true;

/** Does a drag carry files? Selected text does not. */
const carriesFiles = (event: { dataTransfer: DataTransfer | null }) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** Bar weights: the middle moves more, which gives a wave rather than a comb. */
const BARS = [0.35, 0.65, 1, 0.85, 1, 0.65, 0.35];

/**
 * Voice wave during dictation. It follows the actual microphone sound level:
 * if it does not move, the microphone is picking up nothing - not the
 * recognition failing. The cue is therefore useful, not decorative.
 */
function VoiceWave({ level }: { level: number }) {
  return (
    <span className="flex h-4 items-center gap-[3px]" aria-hidden>
      {BARS.map((weight, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-[#7c4dff] transition-all duration-100 ease-out"
          style={{
            height: `${Math.max(3, 3 + level * weight * 15)}px`,
            opacity: 0.5 + level * 0.5,
          }}
        />
      ))}
    </span>
  );
}

// i18n-dynamic: aiChat.reasoningLevels.*

/** Reasoning levels offered; labels: `aiChat.reasoningLevels.<value>.short|label|description`. */
const REASONING_LEVELS: ReasoningLevel[] = ['none', 'low', 'medium', 'high'];

/**
 * Input area: the question, attachments, dictation and the model
 * gathered in a single card - this is where everything is decided, so better
 * have it in sight.
 */
export function Composer({
  value,
  onChange,
  onSend,
  attachments,
  onAttachments,
  model,
  models,
  labels,
  onModel,
  reasoning,
  onReasoning,
  scope,
  imagesSupported,
  filesSupported,
  busy,
  onStop,
  autoFocus,
  dictation = false,
  blockedMessage,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  attachments: Attachment[];
  onAttachments: (attachments: Attachment[]) => void;
  model: string;
  models: string[];
  labels?: Record<string, string>;
  onModel: (model: string) => void;
  reasoning: ReasoningLevel;
  onReasoning: (level: ReasoningLevel) => void;
  scope: {
    /** Global scope ("Whole planning"); null if it is not offered. */
    workspace: { name: string } | null;
    projects: ScopeProject[];
    projectId: string | null;
    onProject: (projectId: string | null) => void;
    /** A started conversation keeps its scope: past replies depend on it. */
    locked: boolean;
    /** Floating assistant: the scope follows navigation, it is not chosen here. */
    followsNavigation?: boolean;
  };
  imagesSupported: boolean;
  /** Does the current model accept a PDF without conversion? */
  filesSupported: boolean;
  busy: boolean;
  /** Interrupts the reply in progress (otherwise the model goes on to the end). */
  onStop?: () => void;
  autoFocus?: boolean;
  /** Dictation enabled by the administration: otherwise, no microphone button and no model download. */
  dictation?: boolean;
  /**
   * Monthly quota reached: this message replaces the input area, and nothing
   * is sent (no text, no attachment, no dictation) until the reset.
   */
  blockedMessage?: string;
}) {
  const t = useTranslations('aiChat');
  const tc = useTranslations("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /** Drag depth: every element crossed emits its own events. */
  const dragDepthRef = useRef(0);
  // The actual field value is passed on: dictation must know whether you
  // edited it with the keyboard, so as not to write over it.
  const voice = useDictation(onChange, value);
  // A conversation always has a scope: the workspace by default
  const hasScope = Boolean(scope.projectId) || Boolean(scope.workspace);
  // Quota reached: the card stays there, readable, but nothing goes in anymore
  const closed = Boolean(blockedMessage);
  const readyToSend = Boolean(value.trim()) && !busy && !uploading && hasScope && !closed;

  /**
   * Reading of the chosen files. Each one is handled on its own: an unreadable
   * document must not take the others down, and attachments are added in a
   * single step - adding them in the loop restarted from the original list
   * on each pass, so only one file survived a multiple selection.
   */
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const added: Attachment[] = [];
    const failures: string[] = [];

    for (const file of Array.from(files)) {
      // Rejected even before upload: nothing to send if the model cannot see
      if (file.type.startsWith('image/') && !imagesSupported) {
        failures.push(t('composer.errors.imagesUnsupported', { name: file.name, model: modelLabel(model, labels) }));
        continue;
      }
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/ai-chat/attachments', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
          throw new Error(body?.error ?? body?.message ?? t('composer.errors.readFailed'));
        }
        const attachment = (await response.json()) as Attachment;
        /**
         * Last filter, once the document is read: a scanned PDF has no
         * text, and only a model able to read files will get
         * anything out of it. Attaching it would suggest it will be used.
         */
        if (!isAttachmentUsable(attachment, imagesSupported, filesSupported)) {
          failures.push(t('composer.errors.pdfNoText', { name: file.name, model: modelLabel(model, labels) }));
          continue;
        }
        added.push(attachment);
      } catch (error) {
        failures.push(
          // i18n-ignore file name and already translated message
          `${file.name} - ${error instanceof Error ? error.message : t('composer.errors.readFailed')}`,
        );
      }
    }

    if (added.length) onAttachments([...attachments, ...added]);
    for (const failure of failures) toast.error(failure, { duration: 8000 });

    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const shownReasoning = REASONING_LEVELS.includes(reasoning) ? reasoning : 'medium';

  return (
    <div
      className={cn(
        'relative rounded-ai-xl border bg-ai-surface shadow-ai-raised focus-within:border-ai-border-focus',
        dragOver ? 'border-[#7c4dff]' : 'border-ai-border-default',
      )}
      /**
       * Drag and drop on the whole card, not only on the field: aiming at
       * a two-line input area with the mouse is needlessly fiddly.
       * The enter/leave counter avoids flickering, every element
       * crossed emitting its own event.
       */
      onDragEnter={(event) => {
        if (!carriesFiles(event) || !hasScope || closed) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (carriesFiles(event) && hasScope && !closed) event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={(event) => {
        if (!carriesFiles(event) || !hasScope || closed) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragOver(false);
        void upload(event.dataTransfer.files);
      }}
    >
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-ai-xl border-2 border-dashed border-[#7c4dff] bg-[#7c4dff]/8 backdrop-blur-[1px]">
          <p className="flex items-center gap-2 text-ai-sm font-medium text-[#7c4dff]">
            <Paperclip className="size-4" />
            {t('composer.dropFiles')}
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <ScopeSelect
          workspace={scope.workspace}
          projects={scope.projects}
          projectId={scope.projectId}
          onChange={scope.onProject}
          locked={scope.locked}
          followsNavigation={scope.followsNavigation}
        />
      </div>

      {attachments.length || uploading ? (
        <div className="px-3 pt-2.5">
          <div className="grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {attachments.map((attachment, index) => (
              <AttachmentCard
                key={`${attachment.name}-${index}`}
                attachment={attachment}
                imagesSupported={imagesSupported}
                filesSupported={filesSupported}
                onRemove={() => onAttachments(attachments.filter((_, position) => position !== index))}
              />
            ))}
            {uploading ? (
              <p className="flex items-center gap-2 rounded-ai-lg border border-dashed border-ai-border-default px-2 py-2 text-ai-xs text-ai-muted">
                <Loader2 className="size-3.5 animate-spin" /> {t('composer.readingDocument')}
              </p>
            ) : null}
          </div>
          {attachments.length ? (
            <p className="pt-1 text-[11px] text-ai-muted">
              {t('composer.attachmentsPending', { count: attachments.length })}
            </p>
          ) : null}
        </div>
      ) : null}

      {blockedMessage ? (
        // The message takes the place of the input area: it shows why it is missing
        <p
          role="status"
          data-quota-reached
          className="flex items-center gap-2 px-3 py-2.5 text-ai-sm text-ai-primary"
        >
          <Gauge className="size-4 shrink-0 text-ai-danger" />
          {blockedMessage}
        </p>
      ) : (
        <textarea
          ref={textareaRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (readyToSend) onSend();
            }
          }}
          rows={2}
          placeholder={
            voice.listening
              ? t('composer.placeholder.dictating')
              : hasScope
                ? t('composer.placeholder.default')
                : t('composer.placeholder.noScope')
          }
          disabled={!hasScope}
          // `focus-cadre`: the card lights up, not the field
          className="focus-cadre w-full resize-none bg-transparent px-3 py-2.5 text-ai-sm text-ai-primary placeholder:text-ai-muted disabled:cursor-not-allowed max-md:text-base"
        />
      )}

      <div className="flex items-center gap-1.5 px-2 pb-2 max-md:gap-1">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedFormats(imagesSupported)}
          className="hidden"
          onChange={(event) => void upload(event.target.files)}
        />
        <Tooltip
          content={
            imagesSupported
              ? t('composer.attach.tooltip')
              : t('composer.attach.tooltipNoImages', { model: modelLabel(model, labels) })
          }
        >
          <button
            type="button"
            aria-label={t('composer.attach.ariaLabel')}
            disabled={!hasScope || uploading || closed}
            onClick={() => inputRef.current?.click()}
            className="grid size-7 place-items-center rounded-ai-md text-ai-secondary hover:bg-ai-surface-hover hover:text-ai-primary disabled:opacity-40 max-md:size-10"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </button>
        </Tooltip>

        <Select
          value={reasoning}
          onValueChange={(picked) =>
            onReasoning((picked || reasoning) as ReasoningLevel)
          }
          options={REASONING_LEVELS.map((option) => ({
            value: option,
            label: tDyn(t, `reasoningLevels.${option}.label`),
            // i18n-ignore dynamic message key
            description: tDyn(t, `reasoningLevels.${option}.description`),
          }))}
          variant="ghost"
          buttonClassName="max-md:h-10"
          searchable={false}
          renderValue={() => (
            <>
              <Brain className="size-3.5 shrink-0" />
              <span className="truncate">{tDyn(t, `reasoningLevels.${shownReasoning}.short`)}</span>
            </>
          )}
          panelClassName="w-60"
        />

        {!imagesSupported ? (
          <Tooltip content={t('composer.noImagesTooltip')}>
            <span className="grid size-7 place-items-center rounded-ai-md text-ai-muted">
              <ImageOff className="size-4" />
            </span>
          </Tooltip>
        ) : null}

        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {/* `min-w-0`: in the floating assistant panel, the model name truncates instead of overflowing */}
          <div className="min-w-0 max-w-[200px]">
            <Select
              value={model}
              onValueChange={(picked) => onModel(picked || model)}
              // The name only: the model technical identifier helps nobody choose
              options={models.map((modelId) => ({
                value: modelId,
                label: modelLabel(modelId, labels),
                icon: <ModelIcon model={modelId} />,
              }))}
              variant="ghost"
              // `max-w-full`: the trigger shrinks and truncates the name instead of going under the microphone (phone)
              buttonClassName="max-w-full max-md:h-10"
              searchable={models.length > 8}
              panelClassName="w-60"
              align="end"
            />
          </div>

          {DICTATION_AVAILABLE && dictation ? (
            <Tooltip
              content={
                voice.step === 'listening'
                  ? t('composer.dictation.stopTooltip')
                  : // Once the model is loaded, we know which engine runs: saying it
                    // spares wondering whether the GPU is actually used.
                    voice.ready
                    ? voice.accurate
                      ? t('composer.dictation.tooltipGpu')
                      : t('composer.dictation.tooltipCpu')
                    : t('composer.dictation.tooltip')
              }
            >
              <button
                type="button"
                aria-label={
                  voice.step === 'listening' ? t('composer.dictation.stopAriaLabel') : t('composer.dictation.startAriaLabel')
                }
                disabled={
                  !hasScope || closed || (voice.step !== 'idle' && voice.step !== 'listening')
                }
                onClick={() => {
                  if (voice.step === 'listening') {
                    void voice.stop();
                    return;
                  }
                  // The cursor goes back into the field: the user can type
                  // during dictation, and the dictated text lands where they are looking.
                  textareaRef.current?.focus();
                  void voice.start(value);
                }}
                className={cn(
                  'grid size-7 place-items-center rounded-ai-md transition-colors disabled:opacity-40 max-md:size-10',
                  voice.step === 'listening'
                    ? 'animate-pulse bg-[#7c4dff]/12 text-[#7c4dff]'
                    : 'text-ai-secondary hover:bg-ai-surface-hover hover:text-ai-primary',
                )}
              >
                {voice.step === 'listening' ? (
                  <Square className="size-3.5 fill-current" />
                ) : voice.step !== 'idle' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mic className="size-4" />
                )}
              </button>
            </Tooltip>
          ) : null}

          {/* During the reply, the send button becomes a stop button:
              a badly worded question does not force waiting for the end. */}
          {busy && onStop ? (
            <Tooltip content={t('composer.stopReply')}>
              <button
                type="button"
                aria-label={t('composer.stopReply')}
                onClick={onStop}
                className="grid size-7 place-items-center rounded-ai-md bg-ai-accent text-ai-on-accent transition-colors hover:brightness-110 max-md:size-10"
              >
                <Square className="size-3 fill-current" />
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              aria-label={tc("actions.send")}
              disabled={!readyToSend}
              onClick={onSend}
              className={cn(
                'grid size-7 place-items-center rounded-ai-md transition-colors max-md:size-10',
                readyToSend
                  ? 'bg-ai-accent text-ai-on-accent hover:brightness-110'
                  : 'bg-ai-sunken text-ai-muted',
              )}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {voice.step === 'listening' ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-ai-border-subtle px-3 py-1.5">
          <VoiceWave level={voice.level} />
          <span className="text-[11px] text-[#7c4dff]">
            {voice.level > 0.06 ? t('composer.dictation.listening') : t('composer.dictation.speak')}
          </span>
          {/* Without the model, nothing can be transcribed: say so while the user speaks */}
          {!voice.ready ? (
            <span className="flex items-center gap-1 text-[11px] text-ai-muted">
              <Loader2 className="size-3 animate-spin" />
              {t('composer.dictation.downloadingWhileSpeaking', {
                precision: voice.accurate ? 'high' : 'standard',
                percent: voice.percent,
              })}
            </span>
          ) : null}
        </div>
      ) : voice.step !== 'idle' ? (
        <p className="flex items-center gap-1.5 border-t border-ai-border-subtle px-3 py-1.5 text-[11px] text-ai-muted">
          <Loader2 className="size-3 animate-spin" />
          {voice.step === 'microphone'
            ? t('composer.dictation.micRequested')
            : !voice.ready
              ? t('composer.dictation.downloading', {
                  precision: voice.accurate ? 'high' : 'standard',
                  percent: voice.percent,
                })
              : t('composer.dictation.transcribing')}
        </p>
      ) : null}
    </div>
  );
}
