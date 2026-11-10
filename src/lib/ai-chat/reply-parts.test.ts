import { describe, expect, it } from "bun:test";
import type { UIMessage, UIMessageChunk } from "ai";
import { readReply, resumedToolsSettled, settledTools, storableParts, turnParts, type ReplyPart } from "./reply-parts";

const chunks = (list: UIMessageChunk[]) =>
  new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of list) controller.enqueue(chunk);
      controller.close();
    },
  });

describe("readReply: the reply as the screen builds it", () => {
  it("reasoning, a tool with its result, then the text", async () => {
    const reply = await readReply(
      chunks([
        { type: "start", messageId: "m1" },
        { type: "start-step" },
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: "Je cherche le projet." },
        { type: "reasoning-end", id: "r1" },
        { type: "tool-input-available", toolCallId: "c1", toolName: "list-projects", input: { search: "RTT" } },
        { type: "tool-output-available", toolCallId: "c1", output: [{ id: "p1", name: "RTT" }] },
        { type: "finish-step" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "C'est fait." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    );
    const kinds = reply!.parts.filter((part) => part.type !== "step-start").map((part) => part.type);
    expect(kinds).toEqual(["reasoning", "tool-list-projects", "text"]);
    const tool = reply!.parts.find((part) => part.type === "tool-list-projects") as ReplyPart & { state: string; output: unknown };
    expect(tool.state).toBe("output-available");
    expect(tool.output).toEqual([{ id: "p1", name: "RTT" }]);
  });

  it("a stream cut keeps what was built", async () => {
    // One chunk per read, then the error: an errored stream drops what it still holds
    const queue: UIMessageChunk[] = [
      { type: "start", messageId: "m1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Début" },
    ];
    const stream = new ReadableStream<UIMessageChunk>({
      pull(controller) {
        const chunk = queue.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.error(new Error("cut"));
      },
    });
    const reply = await readReply(stream);
    expect(reply?.parts.some((part) => part.type === "text" && part.text === "Début")).toBe(true);
  });
});

describe("continuation after an approval", () => {
  const proposed = {
    type: "tool-create-task",
    toolCallId: "c1",
    state: "approval-responded",
    input: { title: "RTT" },
    approval: { id: "a1", approved: true },
  } as unknown as ReplyPart;
  const resumed: UIMessage = { id: "m1", role: "assistant", parts: [{ type: "text", text: "Je crée la tâche." }, proposed] };

  it("keeps the approved write with its result, then what the turn added", async () => {
    const reply = await readReply(
      chunks([
        { type: "start" },
        { type: "tool-output-available", toolCallId: "c1", output: { id: "task-1" } },
        { type: "start-step" },
        { type: "text-start", id: "t2" },
        { type: "text-delta", id: "t2", delta: "C'est enregistré." },
        { type: "text-end", id: "t2" },
        { type: "finish-step" },
        { type: "finish" },
      ]),
      resumed,
    );
    const parts = turnParts(reply!.parts, resumed.parts);
    expect(parts.map((part) => part.type).filter((type) => type !== "step-start")).toEqual(["tool-create-task", "text"]);
    expect(settledTools(resumedToolsSettled(reply!.parts, resumed.parts))).toEqual([
      { tool: "create-task", state: "output-available", output: { id: "task-1" }, error: undefined },
    ]);
    // The text of the previous reply is not kept twice, and the reply continued is left as it was
    expect((resumed.parts[1] as unknown as { state: string }).state).toBe("approval-responded");
    expect(parts.some((part) => part.type === "text" && part.text === "Je crée la tâche.")).toBe(false);
  });

  it("a new reply keeps all its parts", () => {
    const parts: ReplyPart[] = [{ type: "text", text: "Bonjour" }];
    expect(turnParts(parts)).toBe(parts);
    expect(resumedToolsSettled(parts)).toEqual([]);
  });
});

describe("storableParts", () => {
  it("drops the provider metadata and cuts the large results", () => {
    const big = "x".repeat(30_000);
    const parts = storableParts([
      { type: "reasoning", text: "…", state: "done", providerMetadata: { openrouter: { signature: "s" } } },
      { type: "tool-list-tasks", toolCallId: "c1", state: "output-available", input: {}, output: big } as unknown as ReplyPart,
    ]);
    expect("providerMetadata" in parts[0]).toBe(false);
    const output = (parts[1] as unknown as { output: string }).output;
    expect(output.length).toBe(20_001);
    expect(output.endsWith("…")).toBe(true);
  });
});
