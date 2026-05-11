import { describe, it, expect, afterEach } from "vite-plus/test";
import { ReasoningStore, conversationScope } from "../../reasoning-store.js";
import type { ChatMessage } from "../../types.js";
import { tmpDbPath, removeFile, sleep } from "../helpers.js";

const mkMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "assistant",
  content: "Hello",
  reasoning_content: "thinking...",
  ...overrides,
});

describe("ReasoningStore Integration", () => {
  const files: string[] = [];

  afterEach(() => {
    for (const f of files) removeFile(f);
    files.length = 0;
  });

  function createStore(opts?: { maxAgeSeconds?: number; maxRows?: number }): ReasoningStore {
    const dbPath = tmpDbPath();
    files.push(dbPath);
    return new ReasoningStore(dbPath, opts?.maxAgeSeconds ?? 0, opts?.maxRows ?? 0);
  }

  describe("persistence", () => {
    it("survives close and re-open on the same file", () => {
      const msg = mkMessage();
      const scope = conversationScope([{ role: "user", content: "hi" }], "");

      const store1 = createStore();
      store1.storeAssistantMessage(msg, scope);
      store1.close();

      const path = files[files.length - 1];
      const store2 = new ReasoningStore(path);
      const got = store2.lookupForMessage(msg, scope);
      expect(got).toBe("thinking...");
      store2.close();
    });

    it("stores multiple entries and retrieves them after re-open", () => {
      const msg1 = mkMessage({ content: "msg1", reasoning_content: "think1" });
      const msg2 = mkMessage({ content: "msg2", reasoning_content: "think2" });
      const scope1 = conversationScope([{ role: "user", content: "hi" }], "");
      const scope2 = conversationScope([{ role: "user", content: "bye" }], "");

      const store1 = createStore();
      store1.storeAssistantMessage(msg1, scope1);
      store1.storeAssistantMessage(msg2, scope2);
      store1.close();

      const path = files[files.length - 1];
      const store2 = new ReasoningStore(path);
      expect(store2.lookupForMessage(msg1, scope1)).toBe("think1");
      expect(store2.lookupForMessage(msg2, scope2)).toBe("think2");
      store2.close();
    });
  });

  describe("concurrent writes", () => {
    it("handles multiple store instances writing to same file", async () => {
      const path = tmpDbPath();
      files.push(path);

      const N = 20;
      const stores: ReasoningStore[] = [];
      const messages: Array<{ msg: ChatMessage; scope: string; reasoning: string }> = [];

      for (let i = 0; i < N; i++) {
        const store = new ReasoningStore(path);
        stores.push(store);
        const reasoning = `think-${i}`;
        const msg = mkMessage({ content: `msg-${i}`, reasoning_content: reasoning });
        const scope = conversationScope([{ role: "user", content: `q-${i}` }], "");
        messages.push({ msg, scope, reasoning });
      }

      for (let i = 0; i < N; i++) {
        stores[i].storeAssistantMessage(messages[i].msg, messages[i].scope);
      }

      for (let i = 0; i < N; i++) {
        stores[i].close();
      }

      const verify = new ReasoningStore(path);
      for (let i = 0; i < N; i++) {
        const got = verify.lookupForMessage(messages[i].msg, messages[i].scope);
        expect(got).toBe(messages[i].reasoning);
      }
      verify.close();
    });
  });

  describe("cache expiry", () => {
    it("prunes expired entries based on maxAgeSeconds", async () => {
      const store = createStore({ maxAgeSeconds: 1 });
      const msg = mkMessage();
      const scope = conversationScope([{ role: "user", content: "hi" }], "");

      store.storeAssistantMessage(msg, scope);
      expect(store.lookupForMessage(msg, scope)).toBe("thinking...");

      await sleep(1500);

      const msg2 = mkMessage({ content: "new", reasoning_content: "later" });
      store.storeAssistantMessage(msg2, scope);

      expect(store.lookupForMessage(msg, scope)).toBeNull();
      expect(store.lookupForMessage(msg2, scope)).toBe("later");

      store.close();
    });
  });

  describe("row limit", () => {
    it("enforces maxRows and evicts oldest entries", async () => {
      const store = createStore({ maxRows: 5 });

      const entries: Array<{ msg: ChatMessage; scope: string; reasoning: string }> = [];
      for (let i = 0; i < 10; i++) {
        const reasoning = `think-${i}`;
        const msg = mkMessage({ content: `msg-${i}`, reasoning_content: reasoning });
        const scope = conversationScope([{ role: "user", content: `q-${i}` }], "");
        entries.push({ msg, scope, reasoning });
      }

      for (const entry of entries) {
        store.storeAssistantMessage(entry.msg, entry.scope);
        await sleep(5);
      }

      // First 5 should be evicted
      for (let i = 0; i < 5; i++) {
        expect(store.lookupForMessage(entries[i].msg, entries[i].scope)).toBeNull();
      }

      // Last 5 should remain
      for (let i = 5; i < 10; i++) {
        expect(store.lookupForMessage(entries[i].msg, entries[i].scope)).toBe(entries[i].reasoning);
      }

      store.close();
    });

    it("keeps most recently updated entry when maxRows=1", async () => {
      const store = createStore({ maxRows: 1 });

      const msg1 = mkMessage({ content: "first", reasoning_content: "think1" });
      const msg2 = mkMessage({ content: "second", reasoning_content: "think2" });
      const scope = conversationScope([{ role: "user", content: "hi" }], "");

      store.storeAssistantMessage(msg1, scope);
      await sleep(5);
      store.storeAssistantMessage(msg2, scope);

      expect(store.lookupForMessage(msg1, scope)).toBeNull();
      expect(store.lookupForMessage(msg2, scope)).toBe("think2");

      store.close();
    });
  });

  describe("cross-scope lookups", () => {
    it("lookup finds data stored in same scope", () => {
      const store = createStore();
      const msg = mkMessage();
      const scope = conversationScope([{ role: "user", content: "hi" }], "");

      store.storeAssistantMessage(msg, scope);
      expect(store.lookupForMessage(msg, scope)).toBe("thinking...");
      store.close();
    });

    it("lookup returns null for different scope", () => {
      const store = createStore();
      const msg = mkMessage();
      const scopeA = conversationScope([{ role: "user", content: "hi" }], "");
      const scopeB = conversationScope([{ role: "user", content: "bye" }], "");

      store.storeAssistantMessage(msg, scopeA);
      expect(store.lookupForMessage(msg, scopeB)).toBeNull();
      store.close();
    });

    it("lookup matches by tool call id", () => {
      const store = createStore();
      const msg: ChatMessage = {
        role: "assistant",
        content: "",
        reasoning_content: "tool-thinking",
        tool_calls: [{ id: "call_abc", function: { name: "get_weather", arguments: "{}" } }],
      };
      const scope = conversationScope([{ role: "user", content: "weather" }], "");

      store.storeAssistantMessage(msg, scope);
      const found = store.lookupForMessage(msg, scope);
      expect(found).toBe("tool-thinking");
      store.close();
    });
  });

  describe("portable aliases", () => {
    it("backfillPortableAliases creates keys findable by lookupForMessage", () => {
      const store = createStore();
      const prior: ChatMessage[] = [{ role: "user", content: "hi" }];
      const msg: ChatMessage = {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_x", function: { name: "test", arguments: "{}" } }],
      };

      const count = store.backfillPortableAliases(msg, "backfilled", "ns1", prior);
      expect(count).toBeGreaterThan(0);

      const msgWithReasoning = { ...msg, reasoning_content: "backfilled" };
      const found = store.lookupForMessage(msgWithReasoning, "unused-scope", "ns1", prior);
      expect(found).toBe("backfilled");
      store.close();
    });
  });

  describe("clear", () => {
    it("removes all entries and returns count", () => {
      const store = createStore();
      const msg = mkMessage();
      const scope = conversationScope([{ role: "user", content: "hi" }], "");

      store.storeAssistantMessage(msg, scope);
      const cleared = store.clear();
      expect(cleared).toBeGreaterThan(0);
      expect(store.lookupForMessage(msg, scope)).toBeNull();
      store.close();
    });

    it("clear returns 0 on empty store", () => {
      const store = createStore();
      expect(store.clear()).toBe(0);
      store.close();
    });

    it("stores new data after clear", () => {
      const store = createStore();
      const msg = mkMessage();
      const scope = conversationScope([{ role: "user", content: "hi" }], "");

      store.storeAssistantMessage(msg, scope);
      store.clear();
      store.storeAssistantMessage(msg, scope);
      expect(store.lookupForMessage(msg, scope)).toBe("thinking...");
      store.close();
    });
  });
});
