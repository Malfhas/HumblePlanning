import type { UIMessage } from 'ai';

type Part = UIMessage['parts'][number];

/** Mark of a message re-read from the database, with the text that goes back to the model. */
export interface StoredMeta {
  stored: true;
  text: string;
}

/** States of a tool that has its outcome. */
const SETTLED = new Set(['output-available', 'output-error', 'output-denied']);

const isTool = (part: Part): part is Part & { state: string } =>
  part.type === 'dynamic-tool' || part.type.startsWith('tool-');

/**
 * Parts of a message re-read from the database, to draw: the steps of the reply as kept (reasoning, tools, text),
 * else its text (question, or reply from before the steps were kept).
 *
 * A reply re-read is over. A tool left without outcome (write proposed then answered in the next reply, reply cut)
 * is drawn among the tools used, with its parameters: never again as a decision to take nor as still running. It
 * is display only: these parts never go back to the model (`forModel`).
 */
export function restoredParts(parts: UIMessage['parts'] | null | undefined, content: string): UIMessage['parts'] {
  if (!parts?.length) return content.trim() ? [{ type: 'text', text: content }] : [];
  return parts.map((part) => {
    if (isTool(part) && !SETTLED.has(part.state)) return { ...part, state: 'output-available', output: undefined } as Part;
    if (part.type === 'reasoning' && part.state === 'streaming') return { ...part, state: 'done' };
    return part;
  });
}

/**
 * The history sent to the model. A message re-read from the database goes back as its text alone, as before its
 * steps were kept: they are for display (reasoning without its signatures, results cut, tools marked as over). A
 * message without text is left out, as it was then.
 */
export function forModel(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    const meta = message.metadata as Partial<StoredMeta> | undefined;
    if (!meta?.stored) return [message];
    return meta.text?.trim() ? [{ ...message, parts: [{ type: 'text' as const, text: meta.text }] }] : [];
  });
}

const callId = (part: Part): string | undefined =>
  isTool(part) && 'toolCallId' in part ? String(part.toolCallId) : undefined;

/**
 * The continuation of a reply after an approval is its own row in the database, but on screen it completes the
 * reply that asked for the approval: the two are drawn as one message again, the write proposed taking its outcome
 * in place. Two replies in a row without a shared tool (a failed reply then its regeneration) stay apart.
 */
export function mergeContinuations(messages: UIMessage[]): UIMessage[] {
  const merged: UIMessage[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    const previousIds = new Set(previous?.role === 'assistant' ? previous.parts.map(callId).filter(Boolean) : []);
    const continues = message.role === 'assistant' && message.parts.some((part) => previousIds.has(callId(part)));
    if (!previous || !continues) {
      merged.push(message);
      continue;
    }
    const parts = [...previous.parts];
    for (const part of message.parts) {
      const at = callId(part) ? parts.findIndex((existing) => callId(existing) === callId(part)) : -1;
      if (at >= 0) parts[at] = part;
      else parts.push(part);
    }
    const texts = [previous.metadata, message.metadata]
      .map((meta) => (meta as Partial<StoredMeta> | undefined)?.text ?? '')
      .filter((text) => text.trim());
    merged[merged.length - 1] = { ...previous, parts, metadata: { stored: true, text: texts.join('\n\n') } satisfies StoredMeta };
  }
  return merged;
}
