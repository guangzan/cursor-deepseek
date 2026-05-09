import { describe, it, expect } from "vite-plus/test";
import {
  StreamAccumulator,
  CursorReasoningDisplayAdapter,
  foldReasoningIntoContent,
  normalizeReasoningEffort,
} from "../streaming.js";

describe("normalizeReasoningEffort", () => {
  it("maps low to high", () => expect(normalizeReasoningEffort("low")).toBe("high"));
  it("maps medium to high", () => expect(normalizeReasoningEffort("medium")).toBe("high"));
  it("maps high to high", () => expect(normalizeReasoningEffort("high")).toBe("high"));
  it("maps max to max", () => expect(normalizeReasoningEffort("max")).toBe("max"));
  it("maps xhigh to max", () => expect(normalizeReasoningEffort("xhigh")).toBe("max"));
  it("handles undefined input", () => expect(normalizeReasoningEffort(undefined)).toBe("high"));
  it("handles unknown string", () => expect(normalizeReasoningEffort("invalid")).toBe("high"));
  it("is case insensitive", () => expect(normalizeReasoningEffort("MAX")).toBe("max"));
});

describe("StreamAccumulator", () => {
  it("starts with empty messages", () => {
    const acc = new StreamAccumulator();
    expect(acc.messages()).toEqual([]);
  });

  it("accumulates content from a single chunk", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    });
    const msgs = acc.messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Hello");
    expect(msgs[0].role).toBe("assistant");
  });

  it("concatenates multiple content chunks", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({ choices: [{ index: 0, delta: { content: "Hello" } }] });
    acc.ingestChunk({ choices: [{ index: 0, delta: { content: " World" } }] });
    expect(acc.messages()[0].content).toBe("Hello World");
  });

  it("captures reasoning_content", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({
      choices: [{ index: 0, delta: { reasoning_content: "thinking step 1" } }],
    });
    const msg = acc.messages()[0];
    expect(msg.reasoning_content).toBe("thinking step 1");
  });

  it("sets hasReasoningContent when reasoning present", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({
      choices: [{ index: 0, delta: { reasoning_content: "thinking..." } }],
    });
    expect(acc.choices.get(0)?.hasReasoningContent).toBe(true);
  });

  it("handles tool call deltas", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "get_weather", arguments: "" } },
            ],
          },
        },
      ],
    });
    acc.ingestChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"city":"NYC"}' } }],
          },
        },
      ],
    });
    const msg = acc.messages()[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].id).toBe("call_1");
    expect(msg.tool_calls![0].function.name).toBe("get_weather");
    expect(msg.tool_calls![0].function.arguments).toBe('{"city":"NYC"}');
  });

  it("records finish_reason", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({
      choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }],
    });
    expect(acc.choices.get(0)?.finishReason).toBe("stop");
  });

  it("handles multiple choices", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({
      choices: [
        { index: 0, delta: { content: "A" } },
        { index: 1, delta: { content: "B" } },
      ],
    });
    const msgs = acc.messages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("A");
    expect(msgs[1].content).toBe("B");
  });

  it("ignores chunks without choices", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({ id: "x" } as any);
    expect(acc.messages()).toEqual([]);
  });

  it("ignores non-array choices", () => {
    const acc = new StreamAccumulator();
    acc.ingestChunk({ choices: "invalid" } as any);
    expect(acc.messages()).toEqual([]);
  });
});

describe("CursorReasoningDisplayAdapter", () => {
  it("wraps reasoning in collapsible block by default", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    const chunk: Record<string, unknown> = {
      choices: [{ index: 0, delta: { reasoning_content: "step 1" } }],
    };
    adapter.rewriteChunk(chunk);
    const content = (chunk.choices as any[])[0].delta.content;
    expect(content).toContain("<details>");
    expect(content).toContain("<summary>Thinking</summary>");
    expect(content).toContain("step 1");
  });

  it("wraps reasoning in plain think block when non-collapsible", () => {
    const adapter = new CursorReasoningDisplayAdapter(false);
    const chunk: Record<string, unknown> = {
      choices: [{ index: 0, delta: { reasoning_content: "step 1" } }],
    };
    adapter.rewriteChunk(chunk);
    const content = (chunk.choices as any[])[0].delta.content;
    expect(content).toContain("<think>");
    expect(content).not.toContain("<details>");
  });

  it("closes block when content appears after reasoning", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    adapter.rewriteChunk({
      choices: [{ index: 0, delta: { reasoning_content: "thinking..." } }],
    });
    const chunk: Record<string, unknown> = {
      choices: [{ index: 0, delta: { content: "answer" } }],
    };
    adapter.rewriteChunk(chunk);
    const content = (chunk.choices as any[])[0].delta.content;
    expect(content).toContain("</details>");
    expect(content).toContain("answer");
  });

  it("closes block on finish_reason", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    adapter.rewriteChunk({
      choices: [{ index: 0, delta: { reasoning_content: "thinking..." } }],
    });
    const chunk: Record<string, unknown> = {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
    adapter.rewriteChunk(chunk);
    const content = (chunk.choices as any[])[0].delta.content;
    expect(content).toContain("</details>");
  });

  it("flushChunk returns closing chunk for open choices", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    adapter.rewriteChunk({
      id: "test",
      object: "chat.completion.chunk",
      created: 1000,
      choices: [{ index: 0, delta: { reasoning_content: "thinking..." } }],
    });
    const result = adapter.flushChunk("test-model");
    expect(result).not.toBeNull();
    expect(result!.choices).toHaveLength(1);
    expect((result!.choices as any[])[0].delta.content).toContain("</details>");
  });

  it("flushChunk returns null when no open choices", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    expect(adapter.flushChunk("test")).toBeNull();
  });

  it("handles multiple choices", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    adapter.rewriteChunk({
      choices: [
        { index: 0, delta: { reasoning_content: "r1" } },
        { index: 1, delta: { reasoning_content: "r2" } },
      ],
    });
    const chunk: Record<string, unknown> = {
      choices: [
        { index: 0, delta: { content: "a1" } },
        { index: 1, delta: { content: "a2" } },
      ],
    };
    adapter.rewriteChunk(chunk);
    const c0 = (chunk.choices as any[])[0].delta.content;
    const c1 = (chunk.choices as any[])[1].delta.content;
    expect(c0).toContain("</details>");
    expect(c1).toContain("</details>");
  });

  it("does not close block on finish_reason null", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    adapter.rewriteChunk({
      choices: [{ index: 0, delta: { reasoning_content: "thinking..." }, finish_reason: null }],
    });
    expect(adapter.flushChunk("test")).not.toBeNull();
  });

  it("does nothing when no reasoning_content", () => {
    const adapter = new CursorReasoningDisplayAdapter(true);
    const chunk: Record<string, unknown> = {
      choices: [{ index: 0, delta: { content: "hello" } }],
    };
    adapter.rewriteChunk(chunk);
    expect((chunk.choices as any[])[0].delta.content).toBe("hello");
  });
});

describe("foldReasoningIntoContent", () => {
  it("folds reasoning into content for non-streaming response", () => {
    const payload: Record<string, unknown> = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello",
            reasoning_content: "thinking step",
          },
        },
      ],
    };
    foldReasoningIntoContent(payload, true);
    const content = (payload.choices as any[])[0].message.content;
    expect(content).toContain("<details>");
    expect(content).toContain("thinking step");
    expect(content).toContain("Hello");
  });

  it("does nothing when no reasoning_content", () => {
    const payload: Record<string, unknown> = {
      choices: [
        {
          message: { role: "assistant", content: "Hello" },
        },
      ],
    };
    foldReasoningIntoContent(payload, true);
    expect((payload.choices as any[])[0].message.content).toBe("Hello");
  });

  it("handles missing choices", () => {
    foldReasoningIntoContent({}, true);
  });
});
