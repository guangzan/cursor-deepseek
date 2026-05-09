import { describe, it, expect } from "vite-plus/test";
import {
  ReasoningStore,
  messageSignature,
  conversationScope,
  toolCallSignature,
  toolCallIds,
  toolCallNames,
  normalizeToolCall,
} from "../reasoning-store.js";
import { ChatMessage, ToolCall } from "../types.js";

describe("normalizeToolCall", () => {
  it("normalizes a complete tool call", () => {
    const tc: ToolCall = {
      id: "call_1",
      type: "function",
      function: { name: "get_weather", arguments: "{}" },
    };
    const result = normalizeToolCall(tc);
    expect(result.id).toBe("call_1");
    expect(result.function.name).toBe("get_weather");
  });

  it("converts non-string arguments to JSON", () => {
    const tc: ToolCall = {
      function: { name: "test", arguments: { city: "NYC" } as any },
    };
    const result = normalizeToolCall(tc);
    expect(result.function.arguments).toBe(JSON.stringify({ city: "NYC" }));
  });

  it("fills missing fields with defaults", () => {
    const tc: ToolCall = { function: { name: "", arguments: "" } };
    const result = normalizeToolCall(tc);
    expect(result.type).toBe("function");
    expect(result.function.name).toBe("");
  });
});

describe("toolCallSignature", () => {
  it("produces same signature for same name and args", () => {
    const a: ToolCall = { function: { name: "foo", arguments: "{}" } };
    const b: ToolCall = { function: { name: "foo", arguments: "{}" } };
    expect(toolCallSignature(a)).toBe(toolCallSignature(b));
  });

  it("produces same signature regardless of id", () => {
    const a: ToolCall = { id: "x", function: { name: "foo", arguments: "{}" } };
    const b: ToolCall = { id: "y", function: { name: "foo", arguments: "{}" } };
    expect(toolCallSignature(a)).toBe(toolCallSignature(b));
  });

  it("produces different signatures for different names", () => {
    const a: ToolCall = { function: { name: "foo", arguments: "{}" } };
    const b: ToolCall = { function: { name: "bar", arguments: "{}" } };
    expect(toolCallSignature(a)).not.toBe(toolCallSignature(b));
  });
});

describe("toolCallIds", () => {
  it("extracts ids from tool calls", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", function: { name: "a", arguments: "" } },
        { id: "call_2", function: { name: "b", arguments: "" } },
      ],
    };
    expect(toolCallIds(msg)).toEqual(["call_1", "call_2"]);
  });

  it("returns empty array when no tool calls", () => {
    expect(toolCallIds({ role: "assistant", content: "" })).toEqual([]);
  });
});

describe("toolCallNames", () => {
  it("extracts names from tool calls", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { function: { name: "get_weather", arguments: "" } },
        { function: { name: "search", arguments: "" } },
      ],
    };
    expect(toolCallNames(msg)).toEqual(["get_weather", "search"]);
  });
});

describe("messageSignature", () => {
  it("produces same signature for identical messages", () => {
    const a: ChatMessage = { role: "assistant", content: "Hello" };
    const b: ChatMessage = { role: "assistant", content: "Hello" };
    expect(messageSignature(a)).toBe(messageSignature(b));
  });

  it("produces different signatures for different content", () => {
    const a: ChatMessage = { role: "assistant", content: "Hello" };
    const b: ChatMessage = { role: "assistant", content: "World" };
    expect(messageSignature(a)).not.toBe(messageSignature(b));
  });

  it("includes tool calls in signature", () => {
    const a: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "foo", arguments: "{}" } }],
    };
    const b: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "bar", arguments: "{}" } }],
    };
    expect(messageSignature(a)).not.toBe(messageSignature(b));
  });
});

describe("conversationScope", () => {
  it("produces same scope for same messages", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(conversationScope(msgs)).toBe(conversationScope(msgs));
  });

  it("produces different scopes for different messages", () => {
    const a: ChatMessage[] = [{ role: "user", content: "hi" }];
    const b: ChatMessage[] = [{ role: "user", content: "bye" }];
    expect(conversationScope(a)).not.toBe(conversationScope(b));
  });

  it("scopes differ with different namespaces", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "hi" }];
    expect(conversationScope(msgs, "ns1")).not.toBe(conversationScope(msgs, "ns2"));
  });

  it("scopes differ with and without namespace", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "hi" }];
    expect(conversationScope(msgs, "ns")).not.toBe(conversationScope(msgs, ""));
  });
});

describe("ReasoningStore", () => {
  it("stores and retrieves reasoning content", () => {
    const store = new ReasoningStore(":memory:");
    const msg: ChatMessage = {
      role: "assistant",
      content: "Hello",
      reasoning_content: "thinking...",
    };
    store.put("key1", "thinking...", msg);
    expect(store.get("key1")).toBe("thinking...");
    store.close();
  });

  it("returns null for missing key", () => {
    const store = new ReasoningStore(":memory:");
    expect(store.get("nonexistent")).toBeNull();
    store.close();
  });

  it("updates existing key", () => {
    const store = new ReasoningStore(":memory:");
    store.put("k", "old", { role: "assistant", content: "", reasoning_content: "old" });
    store.put("k", "new", { role: "assistant", content: "", reasoning_content: "new" });
    expect(store.get("k")).toBe("new");
    store.close();
  });

  it("storeAssistantMessage stores scoped keys", () => {
    const store = new ReasoningStore(":memory:");
    const msg: ChatMessage = {
      role: "assistant",
      content: "Hello",
      reasoning_content: "thinking...",
    };
    const scope = conversationScope([{ role: "user", content: "hi" }], "");
    const stored = store.storeAssistantMessage(msg, scope);
    expect(stored).toBeGreaterThan(0);
    store.close();
  });

  it("storeAssistantMessage returns 0 for non-assistant", () => {
    const store = new ReasoningStore(":memory:");
    const msg: ChatMessage = { role: "user", content: "hi", reasoning_content: "thinking..." };
    expect(store.storeAssistantMessage(msg, "scope")).toBe(0);
    store.close();
  });

  it("storeAssistantMessage returns 0 when no reasoning_content", () => {
    const store = new ReasoningStore(":memory:");
    const msg: ChatMessage = { role: "assistant", content: "Hello" };
    expect(store.storeAssistantMessage(msg, "scope")).toBe(0);
    store.close();
  });

  it("clear removes all entries", () => {
    const store = new ReasoningStore(":memory:");
    store.put("k", "v", { role: "assistant", content: "", reasoning_content: "v" });
    expect(store.clear()).toBe(1);
    expect(store.get("k")).toBeNull();
    store.close();
  });

  it("clear returns 0 on empty store", () => {
    const store = new ReasoningStore(":memory:");
    expect(store.clear()).toBe(0);
    store.close();
  });

  it("stores with tool call keys", () => {
    const store = new ReasoningStore(":memory:");
    const msg: ChatMessage = {
      role: "assistant",
      content: "",
      reasoning_content: "thinking",
      tool_calls: [{ id: "call_1", function: { name: "test", arguments: "{}" } }],
    };
    const prior: ChatMessage[] = [{ role: "user", content: "hi" }];
    const scope = conversationScope(prior, "");
    const stored = store.storeAssistantMessage(msg, scope, "ns", prior);
    expect(stored).toBeGreaterThan(0);

    const retrieved = store.lookupForMessage(msg, scope, "ns", prior);
    expect(retrieved).toBe("thinking");
    store.close();
  });

  it("backfillPortableAliases stores additional keys", () => {
    const store = new ReasoningStore(":memory:");
    const msg: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", function: { name: "test", arguments: "{}" } }],
    };
    const prior: ChatMessage[] = [{ role: "user", content: "hi" }];
    const count = store.backfillPortableAliases(msg, "thinking...", "ns", prior);
    expect(count).toBeGreaterThan(0);
    const retrieved = store.lookupForMessage(
      { ...msg, reasoning_content: "thinking..." },
      "unused",
      "ns",
      prior,
    );
    expect(retrieved).toBe("thinking...");
    store.close();
  });

  it("prunes excess rows beyond max", async () => {
    const store = new ReasoningStore(":memory:", 0, 1);
    store.put("k1", "v1", { role: "assistant", content: "", reasoning_content: "v1" });
    await new Promise((r) => setTimeout(r, 10));
    store.put("k2", "v2", { role: "assistant", content: "", reasoning_content: "v2" });
    expect(store.get("k1")).toBeNull();
    expect(store.get("k2")).toBe("v2");
    store.close();
  });
});
