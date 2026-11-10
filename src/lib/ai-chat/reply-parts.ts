/**
 * The steps of a reply as the screen draws them - reasoning, tools with their parameters and results, text - kept
 * with the message so that a conversation reopened later shows them again, not only its final text.
 *
 * They are built by the SDK itself (`readUIMessageStream`) from a copy of the stream, the same construction as the
 * client's: what is kept is what was seen. Pure functions apart from the reading, tested in reply-parts.test.ts.
 */
import { isToolUIPart, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";

export type ReplyPart = UIMessage["parts"][number];

/** Beyond this size, a tool result is kept cut (the full result stays in ai_chat_tool_calls). */
const MAX_OUTPUT_CHARS = 20_000;

/** States of a tool that has its outcome. */
const SETTLED = new Set(["output-available", "output-error", "output-denied"]);

/**
 * The reply built from a copy of the stream; `resumed`: the reply being continued (after an approval), which the
 * stream completes. Undefined when nothing could be read.
 */
export async function readReply(stream: ReadableStream<UIMessageChunk>, resumed?: UIMessage): Promise<UIMessage | undefined> {
  let last: UIMessage | undefined;
  try {
    // A copy: the reading completes the message it is given, the reply continued must stay as it was
    const message = resumed ? structuredClone(resumed) : undefined;
    for await (const built of readUIMessageStream({ message, stream, onError: () => undefined })) last = built;
  } catch {
    // Stream cut (stop, error, time limit): what was built so far
  }
  return last;
}

/**
 * What this turn added to the reply. A new reply: all its parts. A continuation after an approval: the parts after
 * those of the reply continued, preceded by the tools that this turn settled (the approved write and its result).
 */
export function turnParts(built: ReplyPart[], resumed?: ReplyPart[]): ReplyPart[] {
  if (!resumed?.length) return built;
  return [...resumedToolsSettled(built, resumed), ...built.slice(resumed.length)];
}

/** The tools of the reply continued whose state this turn changed: the approved (or refused) writes. */
export function resumedToolsSettled(built: ReplyPart[], resumed?: ReplyPart[]): ReplyPart[] {
  if (!resumed?.length) return [];
  return built
    .slice(0, resumed.length)
    .filter((part, i) => isToolUIPart(part) && isToolUIPart(resumed[i]) && part.state !== resumed[i].state);
}

/** The tools of a turn that got their outcome, for the trace of the calls. */
export function settledTools(parts: ReplyPart[]): { tool: string; state: string; output?: unknown; error?: string }[] {
  return parts.filter(isToolUIPart).filter((part) => SETTLED.has(part.state)).map((part) => ({
    tool: toolName(part),
    state: part.state,
    output: "output" in part ? part.output : undefined,
    error: "errorText" in part && typeof part.errorText === "string" ? part.errorText : undefined,
  }));
}

/**
 * The parts as kept: without the provider metadata (signatures of the reasoning, often large, useless for display),
 * the large tool results cut.
 */
export function storableParts(parts: ReplyPart[]): ReplyPart[] {
  return parts.map((part) => {
    const rest = { ...part } as Record<string, unknown>;
    delete rest.providerMetadata;
    delete rest.callProviderMetadata;
    if (isToolUIPart(part) && "output" in rest && rest.output !== undefined) {
      const json = typeof rest.output === "string" ? rest.output : JSON.stringify(rest.output);
      if (json && json.length > MAX_OUTPUT_CHARS) return { ...rest, output: json.slice(0, MAX_OUTPUT_CHARS) + "…" } as ReplyPart;
    }
    return rest as ReplyPart;
  });
}

/** Name of the tool of a tool part ("tool-create-task" → "create-task"). */
export function toolName(part: ReplyPart): string {
  return part.type === "dynamic-tool" && "toolName" in part ? String(part.toolName) : part.type.replace(/^tool-/, "");
}
