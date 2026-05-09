import { ChatMessage, ToolCallDelta, ToolCall } from "./types.js";
import { ReasoningStore } from "./reasoning-store.js";

const THINKING_BLOCK_START = "<think>\n";
const THINKING_BLOCK_END = "\n</think>\n\n";
const COLLAPSIBLE_THINKING_BLOCK_START = "<details>\n<summary>Thinking</summary>\n\n";
const COLLAPSIBLE_THINKING_BLOCK_END = "\n</details>\n\n";

export interface StreamingChoice {
  role: string;
  content: string;
  reasoningContent: string;
  hasReasoningContent: boolean;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

export function createStreamingChoice(): StreamingChoice {
  return {
    role: "assistant",
    content: "",
    reasoningContent: "",
    hasReasoningContent: false,
    toolCalls: [],
    finishReason: null,
  };
}

function mergeToolCallDeltas(choice: StreamingChoice, deltas: unknown) {
  if (!Array.isArray(deltas)) return;

  for (const rawDelta of deltas) {
    if (typeof rawDelta !== "object" || rawDelta === null) continue;
    const delta = rawDelta as ToolCallDelta;
    let idx = delta.index ?? choice.toolCalls.length;

    while (choice.toolCalls.length <= idx) {
      choice.toolCalls.push({
        type: "function",
        function: { name: "", arguments: "" },
      });
    }

    const tc = choice.toolCalls[idx];
    if (delta.id) tc.id = delta.id;
    if (delta.type) tc.type = delta.type;

    if (delta.function) {
      if (delta.function.name) {
        tc.function.name = (tc.function.name || "") + delta.function.name;
      }
      if (delta.function.arguments) {
        tc.function.arguments = (tc.function.arguments || "") + delta.function.arguments;
      }
    }
  }
}

export class StreamAccumulator {
  choices: Map<number, StreamingChoice> = new Map();
  private storedChoices: Map<string, string> = new Map();

  ingestChunk(chunk: Record<string, unknown>) {
    const rawChoices = chunk.choices as unknown[];
    if (!Array.isArray(rawChoices)) return;

    for (const rawChoice of rawChoices) {
      if (typeof rawChoice !== "object" || rawChoice === null) continue;
      const rc = rawChoice as Record<string, unknown>;
      const index = (rc.index as number) ?? 0;

      let choice = this.choices.get(index);
      if (!choice) {
        choice = createStreamingChoice();
        this.choices.set(index, choice);
      }

      if (typeof rc.finish_reason === "string") {
        choice.finishReason = rc.finish_reason;
      }

      const delta = rc.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      if (typeof delta.role === "string" && delta.role) {
        choice.role = delta.role;
      }
      if (typeof delta.content === "string") {
        choice.content += delta.content;
      }
      if (typeof delta.reasoning_content === "string") {
        choice.hasReasoningContent = true;
        choice.reasoningContent += delta.reasoning_content;
      }

      mergeToolCallDeltas(choice, delta.tool_calls);
    }
  }

  messages(): ChatMessage[] {
    const result: ChatMessage[] = [];
    const sorted = [...this.choices.entries()].sort(([a], [b]) => a - b);
    for (const [, choice] of sorted) {
      const msg: ChatMessage = { role: choice.role, content: choice.content };
      if (choice.hasReasoningContent) {
        msg.reasoning_content = choice.reasoningContent;
      }
      if (choice.toolCalls.length > 0) {
        msg.tool_calls = choice.toolCalls;
      }
      result.push(msg);
    }
    return result;
  }

  private storeChoice(
    index: number,
    choice: StreamingChoice,
    store: ReasoningStore,
    scope: string,
    stage: string,
    cacheNamespace = "",
    priorMessages?: ChatMessage[],
  ): number {
    const stageRank: Record<string, number> = { tool_call: 1, final: 2 };
    const storageKey = `${index}:${scope}`;
    const prevStage = this.storedChoices.get(storageKey);
    if (prevStage && (stageRank[prevStage] ?? 0) >= (stageRank[stage] ?? 0)) return 0;

    const msg: ChatMessage = { role: choice.role, content: choice.content };
    if (choice.hasReasoningContent) msg.reasoning_content = choice.reasoningContent;
    if (choice.toolCalls.length > 0) msg.tool_calls = choice.toolCalls;

    const stored = store.storeAssistantMessage(msg, scope, cacheNamespace, priorMessages);
    if (stored > 0) {
      this.storedChoices.set(storageKey, stage);
    }
    return stored;
  }

  storeReasoning(
    store: ReasoningStore,
    scope: string,
    cacheNamespace = "",
    priorMessages?: ChatMessage[],
  ): number {
    let stored = 0;
    for (const [index, choice] of this.choices) {
      stored += this.storeChoice(
        index,
        choice,
        store,
        scope,
        "final",
        cacheNamespace,
        priorMessages,
      );
    }
    return stored;
  }

  storeFinishedReasoning(
    store: ReasoningStore,
    scope: string,
    cacheNamespace = "",
    priorMessages?: ChatMessage[],
  ): number {
    let stored = 0;
    for (const [index, choice] of this.choices) {
      if (choice.finishReason !== null) {
        stored += this.storeChoice(
          index,
          choice,
          store,
          scope,
          "final",
          cacheNamespace,
          priorMessages,
        );
      }
    }
    return stored;
  }

  storeReadyReasoning(
    store: ReasoningStore,
    scope: string,
    cacheNamespace = "",
    priorMessages?: ChatMessage[],
  ): number {
    let stored = 0;
    for (const [index, choice] of this.choices) {
      if (choice.finishReason !== null) {
        stored += this.storeChoice(
          index,
          choice,
          store,
          scope,
          "final",
          cacheNamespace,
          priorMessages,
        );
      } else if (this.hasIdentifiedToolCalls(choice)) {
        stored += this.storeChoice(
          index,
          choice,
          store,
          scope,
          "tool_call",
          cacheNamespace,
          priorMessages,
        );
      }
    }
    return stored;
  }

  private hasIdentifiedToolCalls(choice: StreamingChoice): boolean {
    if (!choice.hasReasoningContent || choice.toolCalls.length === 0) return false;
    return choice.toolCalls.every((tc) => Boolean(tc.id));
  }
}

const EFFORT_ALIASES: Record<string, string> = {
  low: "high",
  medium: "high",
  high: "high",
  max: "max",
  xhigh: "max",
};

export function normalizeReasoningEffort(value: unknown): string {
  if (typeof value !== "string") return "high";
  return EFFORT_ALIASES[value.trim().toLowerCase()] ?? "high";
}

export class CursorReasoningDisplayAdapter {
  private openChoices: Set<number> = new Set();
  private lastChunkMetadata: Record<string, unknown> = {};
  private blockStart: string;
  private blockEnd: string;

  constructor(collapsible = true) {
    this.blockStart = collapsible ? COLLAPSIBLE_THINKING_BLOCK_START : THINKING_BLOCK_START;
    this.blockEnd = collapsible ? COLLAPSIBLE_THINKING_BLOCK_END : THINKING_BLOCK_END;
  }

  rewriteChunk(chunk: Record<string, unknown>) {
    this.rememberChunkMetadata(chunk);
    const rawChoices = chunk.choices as unknown[];
    if (!Array.isArray(rawChoices)) return;

    for (const rawChoice of rawChoices) {
      if (typeof rawChoice !== "object" || rawChoice === null) continue;
      const rc = rawChoice as Record<string, unknown>;
      const index = (rc.index as number) ?? 0;
      let delta = rc.delta as Record<string, unknown> | undefined;
      if (!delta) {
        delta = {};
        rc.delta = delta;
      }

      const mirroredParts: string[] = [];
      const reasoningContent = delta.reasoning_content;
      if (typeof reasoningContent === "string" && reasoningContent) {
        if (!this.openChoices.has(index)) {
          mirroredParts.push(this.blockStart);
          this.openChoices.add(index);
        }
        mirroredParts.push(reasoningContent);
      }

      const existingContent = delta.content;
      const shouldClose =
        this.openChoices.has(index) &&
        (Boolean(existingContent) || Boolean(delta.tool_calls) || rc.finish_reason != null);
      if (shouldClose) {
        mirroredParts.push(this.blockEnd);
        this.openChoices.delete(index);
      }

      if (mirroredParts.length === 0) continue;
      if (typeof existingContent === "string") mirroredParts.push(existingContent);
      delta.content = mirroredParts.join("");
    }
  }

  flushChunk(model: string): Record<string, unknown> | null {
    if (this.openChoices.size === 0) return null;

    const choices = [...this.openChoices]
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        delta: { content: this.blockEnd },
        finish_reason: null,
      }));
    this.openChoices.clear();

    return {
      id: this.lastChunkMetadata.id ?? "chatcmpl-reasoning-close",
      object: this.lastChunkMetadata.object ?? "chat.completion.chunk",
      created: this.lastChunkMetadata.created ?? Math.floor(Date.now() / 1000),
      model,
      choices,
    };
  }

  private rememberChunkMetadata(chunk: Record<string, unknown>) {
    for (const key of ["id", "object", "created"]) {
      if (key in chunk) {
        this.lastChunkMetadata[key] = chunk[key];
      }
    }
  }
}

export function foldReasoningIntoContent(
  responsePayload: Record<string, unknown>,
  collapsible: boolean,
) {
  const blockStart = collapsible ? COLLAPSIBLE_THINKING_BLOCK_START : THINKING_BLOCK_START;
  const blockEnd = collapsible ? COLLAPSIBLE_THINKING_BLOCK_END : THINKING_BLOCK_END;

  const rawChoices = responsePayload.choices as unknown[];
  if (!Array.isArray(rawChoices)) return;

  for (const rawChoice of rawChoices) {
    if (typeof rawChoice !== "object" || rawChoice === null) continue;
    const choice = rawChoice as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const reasoning = message.reasoning_content;
    if (typeof reasoning !== "string" || !reasoning) continue;

    const content = message.content;
    message.content =
      blockStart + reasoning + blockEnd + (typeof content === "string" ? content : "");
  }
}
