import Database from "better-sqlite3";
import { existsSync, mkdirSync, chmodSync } from "fs";
import { dirname, resolve } from "path";
import { createHash } from "crypto";
import { ChatMessage, ToolCall } from "./types.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizeToolCall(tc: ToolCall): ToolCall {
  const fn = tc.function || {};
  let args = fn.arguments;
  if (typeof args !== "string") {
    args = JSON.stringify(args);
  }
  return {
    id: tc.id,
    type: tc.type || "function",
    function: {
      name: fn.name || "",
      arguments: args,
    },
  };
}

function sortedStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return JSON.stringify(obj.map(sortedStringify));
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    sorted[key] = sortedStringify((obj as Record<string, unknown>)[key]);
  }
  return JSON.stringify(sorted);
}

export function toolCallSignature(tc: ToolCall): string {
  const n = normalizeToolCall(tc);
  const { id: _id, ...rest } = n;
  return sha256(sortedStringify(rest));
}

export function toolCallIds(msg: ChatMessage): string[] {
  const ids: string[] = [];
  for (const tc of msg.tool_calls || []) {
    if (tc.id) ids.push(tc.id);
  }
  return ids;
}

export function toolCallNames(msg: ChatMessage): string[] {
  const names: string[] = [];
  for (const tc of msg.tool_calls || []) {
    if (tc.function?.name) names.push(tc.function.name);
  }
  return names;
}

export function messageSignature(msg: ChatMessage): string {
  const tcs = (msg.tool_calls || []).map(normalizeToolCall);
  const payload = { content: msg.content || "", tool_calls: tcs };
  return sha256(sortedStringify(payload));
}

export function canonicalScopeMessage(msg: ChatMessage): Record<string, unknown> {
  const result: Record<string, unknown> = { role: msg.role };
  if (msg.content !== undefined) result.content = msg.content;
  if (msg.name !== undefined) result.name = msg.name;
  if (msg.tool_call_id !== undefined) result.tool_call_id = msg.tool_call_id;
  if (msg.prefix !== undefined) result.prefix = msg.prefix;
  if (msg.tool_calls) {
    result.tool_calls = msg.tool_calls.map(normalizeToolCall);
  }
  return result;
}

export function conversationScope(messages: ChatMessage[], namespace = ""): string {
  const scopeMessages = messages.map(canonicalScopeMessage);
  const payload: unknown = namespace ? { namespace, messages: scopeMessages } : scopeMessages;
  return sha256(JSON.stringify(payload));
}

export function turnContextSignature(priorMessages: ChatMessage[]): string {
  let lastUserIdx = -1;
  for (let i = priorMessages.length - 1; i >= 0; i--) {
    if (priorMessages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const startIdx = lastUserIdx >= 0 ? lastUserIdx : 0;
  if (lastUserIdx >= 0) {
    let actualStart = startIdx;
    while (actualStart > 0 && priorMessages[actualStart - 1].role === "user") {
      actualStart--;
    }
    const context = priorMessages
      .slice(actualStart)
      .filter((m) => m.role !== "system")
      .map(canonicalScopeMessage);
    return sha256(JSON.stringify(context));
  }
  const context = priorMessages.filter((m) => m.role !== "system").map(canonicalScopeMessage);
  return sha256(JSON.stringify(context));
}

function scopedReasoningKeys(msg: ChatMessage, scope: string): string[] {
  const keys = [`scope:${scope}:signature:${messageSignature(msg)}`];
  for (const id of toolCallIds(msg)) {
    keys.push(`scope:${scope}:tool_call:${id}`);
  }
  for (const tc of msg.tool_calls || []) {
    keys.push(`scope:${scope}:tool_call_signature:${toolCallSignature(tc)}`);
  }
  for (const name of toolCallNames(msg)) {
    keys.push(`scope:${scope}:tool_name:${name}`);
  }
  return keys;
}

function portableReasoningKeys(
  msg: ChatMessage,
  cacheNamespace: string,
  priorMessages: ChatMessage[],
): string[] {
  if (!cacheNamespace) return [];
  const turnSig = turnContextSignature(priorMessages);
  const keys: string[] = [];
  keys.push(`namespace:${cacheNamespace}:turn:${turnSig}:signature:${messageSignature(msg)}`);
  for (const id of toolCallIds(msg)) {
    keys.push(`namespace:${cacheNamespace}:turn:${turnSig}:tool_call:${id}`);
  }
  for (const tc of msg.tool_calls || []) {
    keys.push(
      `namespace:${cacheNamespace}:turn:${turnSig}:tool_call_signature:${toolCallSignature(tc)}`,
    );
  }
  for (const name of toolCallNames(msg)) {
    keys.push(`namespace:${cacheNamespace}:turn:${turnSig}:tool_name:${name}`);
  }
  return keys;
}

export class ReasoningStore {
  private db: Database.Database;
  private maxAgeSeconds: number;
  private maxRows: number;

  constructor(dbPath: string, maxAgeSeconds = 2592000, maxRows = 100000) {
    this.maxAgeSeconds = maxAgeSeconds;
    this.maxRows = maxRows;

    if (dbPath === ":memory:") {
      this.db = new Database(":memory:");
    } else {
      const resolved = resolve(dbPath);
      const dir = dirname(resolved);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      this.db = new Database(resolved);
      chmodSync(resolved, 0o600);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reasoning_cache (
        key TEXT PRIMARY KEY,
        reasoning TEXT NOT NULL,
        message_json TEXT NOT NULL,
        created_at REAL NOT NULL
      )
    `);
    this.prune();
  }

  close() {
    this.db.close();
  }

  put(key: string, reasoning: string, message: ChatMessage) {
    const stmt = this.db.prepare(`
      INSERT INTO reasoning_cache(key, reasoning, message_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        reasoning = excluded.reasoning,
        message_json = excluded.message_json,
        created_at = excluded.created_at
    `);
    stmt.run(key, reasoning, JSON.stringify(message), Date.now() / 1000);
    this.prune();
  }

  get(key: string): string | null {
    const row = this.db.prepare("SELECT reasoning FROM reasoning_cache WHERE key = ?").get(key) as
      | { reasoning: string }
      | undefined;
    return row?.reasoning ?? null;
  }

  storeAssistantMessage(
    message: ChatMessage,
    scope: string,
    cacheNamespace = "",
    priorMessages?: ChatMessage[],
  ): number {
    if (message.role !== "assistant") return 0;
    const reasoning = message.reasoning_content;
    if (typeof reasoning !== "string" || !reasoning) return 0;

    const keys = scopedReasoningKeys(message, scope);
    if (priorMessages) {
      keys.push(...portableReasoningKeys(message, cacheNamespace, priorMessages));
    }
    const uniqueKeys = new Set(keys);
    for (const key of uniqueKeys) {
      this.put(key, reasoning, message);
    }
    return uniqueKeys.size;
  }

  lookupForMessage(
    message: ChatMessage,
    scope: string,
    cacheNamespace = "",
    priorMessages?: ChatMessage[],
  ): string | null {
    const keys = scopedReasoningKeys(message, scope);
    if (priorMessages) {
      keys.push(...portableReasoningKeys(message, cacheNamespace, priorMessages));
    }
    for (const key of keys) {
      const reasoning = this.get(key);
      if (reasoning !== null) return reasoning;
    }
    return null;
  }

  backfillPortableAliases(
    message: ChatMessage,
    reasoning: string,
    cacheNamespace: string,
    priorMessages: ChatMessage[],
  ): number {
    if (typeof reasoning !== "string") return 0;
    const keys = portableReasoningKeys(message, cacheNamespace, priorMessages);
    if (!keys.length) return 0;
    const msgWithReasoning = { ...message, reasoning_content: reasoning };
    for (const key of new Set(keys)) {
      this.put(key, reasoning, msgWithReasoning);
    }
    return keys.length;
  }

  clear(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM reasoning_cache").get() as {
      cnt: number;
    };
    this.db.exec("DELETE FROM reasoning_cache");
    return row.cnt;
  }

  private prune() {
    if (this.maxAgeSeconds > 0) {
      const cutoff = Date.now() / 1000 - this.maxAgeSeconds;
      this.db.prepare("DELETE FROM reasoning_cache WHERE created_at < ?").run(cutoff);
    }
    if (this.maxRows > 0) {
      this.db
        .prepare(`
        DELETE FROM reasoning_cache
        WHERE key NOT IN (
          SELECT key FROM reasoning_cache
          ORDER BY created_at DESC
          LIMIT ?
        )
      `)
        .run(this.maxRows);
    }
  }
}
