import http from "http";
import { execSync, spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import {
  getRandomPort,
  createMockUpstream,
  sleep,
} from "../../packages/core/src/__tests__/helpers.js";

const BUILT_CLI = "packages/cli/dist/cli.mjs";
const HOST = "127.0.0.1";

async function waitForServer(port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${HOST}:${port}/healthz`);
      if (res.status === 200) return true;
    } catch {
      // not ready
    }
    await sleep(200);
  }
  return false;
}

async function killProcess(proc: ChildProcess) {
  try {
    if (!proc.killed) {
      proc.kill("SIGTERM");
      await sleep(500);
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    }
  } catch {
    // ok
  }
}

async function cleanupPort(port: number) {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: "ignore",
    });
  } catch {
    // ok
  }
  await sleep(300);
}

function skipIfNotBuilt() {
  if (!existsSync(BUILT_CLI)) {
    throw new Error(`SKIP: Build artifact not found at ${BUILT_CLI}. Run 'vp run build' first.`);
  }
}

describe("E2E", () => {
  let upstream: { url: string; server: http.Server };
  let port: number;
  let proxyProc: ChildProcess | null = null;

  beforeAll(async () => {
    skipIfNotBuilt();

    upstream = await createMockUpstream((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const isStream = body.includes('"stream":true');

        if (isStream) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          const chunks = [
            {
              id: "e2e-sse",
              object: "chat.completion.chunk",
              model: "deepseek-v4-pro",
              choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
            },
            {
              id: "e2e-sse",
              object: "chat.completion.chunk",
              model: "deepseek-v4-pro",
              choices: [
                { index: 0, delta: { reasoning_content: "thinking..." }, finish_reason: null },
              ],
            },
            {
              id: "e2e-sse",
              object: "chat.completion.chunk",
              model: "deepseek-v4-pro",
              choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            },
          ];
          for (const c of chunks) {
            res.write(`data: ${JSON.stringify(c)}\n\n`);
          }
          res.end("data: [DONE]\n\n");
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: "e2e-chat",
              object: "chat.completion",
              model: "deepseek-v4-pro",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "E2E response",
                    reasoning_content: "E2E reasoning",
                  },
                },
              ],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
          );
        }
      });
    });

    port = await getRandomPort();
    await cleanupPort(port);

    proxyProc = spawn(
      "node",
      [
        BUILT_CLI,
        "start",
        "--no-interactive",
        `--port=${port}`,
        `--host=${HOST}`,
        "--no-ngrok",
        "--no-display-reasoning",
        `--base-url=${upstream.url}`,
      ],
      {
        detached: false,
        stdio: "pipe",
        env: { ...process.env, FORCE_COLOR: "0" },
      },
    );

    let procStdout = "";
    let procStderr = "";
    proxyProc.stdout?.on("data", (d: Buffer) => {
      procStdout += d.toString();
    });
    proxyProc.stderr?.on("data", (d: Buffer) => {
      procStderr += d.toString();
    });

    const ready = await waitForServer(port);
    if (!ready) {
      console.error(`[E2E] Server failed to start on port ${port}`);
      console.error(`[E2E] STDOUT: ${procStdout.slice(0, 500)}`);
      console.error(`[E2E] STDERR: ${procStderr.slice(0, 500)}`);
      await killProcess(proxyProc);
    }
    expect(ready).toBe(true);
  }, 30000);

  afterAll(async () => {
    if (proxyProc) {
      await killProcess(proxyProc);
    }
    await cleanupPort(port);
    upstream.server.close();
  });

  describe("full pipeline", () => {
    it("healthz endpoint is reachable", async () => {
      const res = await fetch(`http://${HOST}:${port}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
    });

    it("GET /v1/models returns expected models", async () => {
      const res = await fetch(`http://${HOST}:${port}/v1/models`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const data = body.data as Record<string, unknown>[];
      const ids = data.map((m) => m.id);
      expect(ids).toContain("deepseek-v4-pro");
      expect(ids).toContain("deepseek-v4-flash");
    });

    it("non-streaming chat: proxies request and rewrites response", async () => {
      const res = await fetch(`http://${HOST}:${port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer e2e-token",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "ping" }],
        }),
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.object).toBe("chat.completion");
      expect(body.model).toBe("deepseek-v4-pro");
      const choices = body.choices as Record<string, unknown>[];
      const message = choices?.[0]?.message as Record<string, unknown> | undefined;
      expect(message?.content).toBe("E2E response");
      expect(message?.reasoning_content).toBeDefined();
    });

    it("streaming chat: proxies SSE and completes with [DONE]", async () => {
      const res = await fetch(`http://${HOST}:${port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer e2e-token",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "stream test" }],
          stream: true,
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("[DONE]");
      expect(text).toContain("Hello");
      expect(text).toContain("world");
    });

    it("auth: rejects request without Authorization", async () => {
      const res = await fetch(`http://${HOST}:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("reasoning cache across requests", () => {
    it("stores reasoning from non-streaming response for later cache hit", async () => {
      const msg = [{ role: "user", content: "cache-test" }];

      const res1 = await fetch(`http://${HOST}:${port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer e2e-token",
        },
        body: JSON.stringify({ model: "deepseek-v4-pro", messages: msg }),
      });

      expect(res1.status).toBe(200);
      const data1 = (await res1.json()) as Record<string, unknown>;
      const choices = data1.choices as Record<string, unknown>[];
      const message = choices?.[0]?.message as Record<string, unknown> | undefined;
      expect(message?.reasoning_content).toBe("E2E reasoning");
    });
  });
});
