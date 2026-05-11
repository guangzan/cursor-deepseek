import { execSync, spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import { sleep } from "../../../../core/src/__tests__/helpers.js";

const BUILT_CLI = "packages/cli/dist/cli.mjs";
const HOST = "127.0.0.1";

function getRandomPort(): number {
  return 1024 + Math.floor(Math.random() * 50000);
}

async function waitForServer(port: number, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${HOST}:${port}/healthz`);
      if (res.status === 200) return true;
    } catch {
      // server not ready yet
    }
    await sleep(200);
  }
  return false;
}

function execCli(args: string[]): string {
  return execSync(["node", BUILT_CLI, ...args].join(" "), {
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
    timeout: 15000,
  });
}

function spawnCli(args: string[]): ChildProcess {
  return spawn("node", [BUILT_CLI, ...args], {
    detached: false,
    stdio: "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
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

describe("CLI Integration", () => {
  beforeAll(() => {
    skipIfNotBuilt();
  });

  describe("start + status + stop lifecycle", () => {
    let port: number;
    let proc: ChildProcess | null = null;

    beforeAll(async () => {
      port = getRandomPort();
      await cleanupPort(port);

      proc = spawnCli([
        "start",
        "--no-interactive",
        `--port=${port}`,
        `--host=${HOST}`,
        "--no-ngrok",
      ]);

      const ready = await waitForServer(port);
      if (!ready) {
        await killProcess(proc!);
      }
      expect(ready).toBe(true);
    }, 20000);

    afterAll(async () => {
      if (proc) {
        await killProcess(proc);
      }
      await cleanupPort(port);
    });

    it("server responds to /healthz", async () => {
      const res = await fetch(`http://${HOST}:${port}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
    });

    it("server responds to /v1/models", async () => {
      const res = await fetch(`http://${HOST}:${port}/v1/models`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const data = body.data as Record<string, unknown>[];
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    it("server rejects unauthorized chat request", async () => {
      const res = await fetch(`http://${HOST}:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(401);
    });

    it("dsl status reports running state", () => {
      const stdout = execCli(["status"]);
      expect(stdout).toMatch(/running/i);
    });

    it("dsl stop terminates server", async () => {
      execCli(["stop"]);

      await sleep(2000);

      let reachable = false;
      try {
        const res = await fetch(`http://${HOST}:${port}/healthz`);
        reachable = res.status === 200;
      } catch {
        // expected - server is down
      }
      expect(reachable).toBe(false);
    }, 15000);

    it("dsl status reports not running after stop", () => {
      const stdout = execCli(["status"]);
      expect(stdout).toMatch(/not running/i);
    });
  });

  describe("error handling", () => {
    it("status reports not running when no server", () => {
      const stdout = execCli(["status"]);
      expect(stdout).toMatch(/not running/i);
    });
  });
});
