#!/usr/bin/env tsx

import { spawn, execSync } from "node:child_process";
import { createServer } from "node:net";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const NC = "\x1b[0m";

let pass = 0;
let fail = 0;

function logPass(label: string) {
  console.log(`  ${GREEN}✔ PASS${NC} ${label}`);
  pass++;
}

function logFail(label: string) {
  console.log(`  ${RED}✘ FAIL${NC} ${label}`);
  fail++;
}

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolvePort(port));
      } else {
        reject(new Error("Could not determine free port"));
      }
    });
    server.on("error", reject);
  });
}

function assertJson(body: unknown, key: string, expected: string, label: string) {
  const actual = String((body as Record<string, unknown>)[key]);
  if (actual === expected) {
    logPass(label);
  } else {
    logFail(`${label} (expected '${expected}' got '${actual}')`);
  }
}

function safeExec(cmd: string) {
  try {
    execSync(cmd, { stdio: "ignore" });
  } catch {
    /* not found or already dead */
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Cleanup handler -- kill the child process on early exit
  let childProcess: ReturnType<typeof spawn> | null = null;

  function cleanup() {
    if (childProcess) {
      childProcess.kill();
      childProcess = null;
    }
  }

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  console.log("");
  console.log("=== deepseek-lane Smoke Tests ===");
  console.log("");

  // ---- Pre-flight checks -----------------------------------------------

  const cli = resolve("packages/cli/dist/cli.mjs");

  try {
    await access(cli);
  } catch {
    console.error(`ERROR: Build artifact not found at ${cli}. Run 'vp run build' first.`);
    process.exit(1);
  }

  // ---- Port ------------------------------------------------------------

  const port = await findFreePort();
  console.log(`Using port: ${port}`);

  // Kill anything on the port (defensive)
  safeExec(`lsof -ti:${port} 2>/dev/null | xargs kill -9 2>/dev/null`);
  await sleep(500);

  // Kill any previous deepseek-lane processes
  safeExec('pgrep -f "deepseek-lane.*start" 2>/dev/null | xargs kill 2>/dev/null');
  await sleep(500);

  // ---- Start proxy -----------------------------------------------------

  console.log("");
  console.log("--- Starting proxy ---");

  childProcess = spawn(
    "node",
    [cli, "start", "--no-interactive", `--port=${port}`, "--host=127.0.0.1", "--no-ngrok"],
    {
      stdio: "inherit",
    },
  );

  childProcess.on("exit", (code) => {
    if (code !== null && code !== 0 && childProcess) {
      // unexpected exit -- the wait loop below will catch it
    }
  });

  // ---- Wait for readiness ----------------------------------------------

  const deadline = Date.now() + 10_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not ready yet */
    }
    await sleep(200);
  }

  if (!ready) {
    logFail("Server did not start within 10 seconds");
    cleanup();
    process.exit(1);
  }

  // ---- Tests -----------------------------------------------------------

  console.log("");
  console.log("--- Health Checks ---");

  // 1. /healthz
  console.log("GET /healthz");
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    if (res.ok) {
      const body = await res.json();
      assertJson(body, "ok", "true", "healthz returns ok:true");
    } else {
      logFail(`healthz returned ${res.status}`);
    }
  } catch (e: unknown) {
    logFail(`healthz unreachable (${(e as Error).message})`);
  }

  // 2. /v1/healthz
  console.log("GET /v1/healthz");
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/healthz`);
    if (res.ok) {
      const body = await res.json();
      assertJson(body, "ok", "true", "v1/healthz returns ok:true");
    } else {
      logFail(`v1/healthz returned ${res.status}`);
    }
  } catch (e: unknown) {
    logFail(`v1/healthz unreachable (${(e as Error).message})`);
  }

  // 3. /v1/models
  console.log("GET /v1/models");
  let modelsResponse: Response | null = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    modelsResponse = res;

    if (res.ok) {
      const body = (await res.json()) as { data: Array<{ id: string }> };

      if (body.data.length >= 1) {
        logPass(`v1/models returns model list (${body.data.length} models)`);
      } else {
        logFail("v1/models returns empty list");
      }

      const ids = body.data.map((m) => m.id);
      if (ids.includes("deepseek-v4-pro")) {
        logPass("v1/models includes deepseek-v4-pro");
      } else {
        logFail("v1/models missing deepseek-v4-pro");
      }
      if (ids.includes("deepseek-v4-flash")) {
        logPass("v1/models includes deepseek-v4-flash");
      } else {
        logFail("v1/models missing deepseek-v4-flash");
      }
    } else {
      logFail(`v1/models returned ${res.status}`);
    }
  } catch (e: unknown) {
    logFail(`v1/models unreachable (${(e as Error).message})`);
  }

  // 4. CORS headers present
  console.log("GET /v1/models (CORS check)");
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Origin: "http://localhost" },
    });
    const corsHeader = res.headers.get("access-control-allow-origin");
    if (corsHeader === "*" || corsHeader === "http://localhost") {
      logPass(`CORS header access-control-allow-origin: ${corsHeader}`);
    } else {
      logFail(`CORS header (got '${corsHeader}')`);
    }
  } catch (e: unknown) {
    logFail(`CORS check failed (${(e as Error).message})`);
  }

  // 5. Auth rejection
  console.log("POST /v1/chat/completions (no auth)");
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.status === 401) {
      logPass("rejects unauthenticated request (401)");
    } else {
      logFail(`auth check (got ${res.status}, expected 401)`);
    }
  } catch (e: unknown) {
    logFail(`auth check failed (${(e as Error).message})`);
  }

  // ---- Cleanup ---------------------------------------------------------

  console.log("");
  console.log("--- Cleanup ---");

  const procToWait = childProcess;
  cleanup();
  if (procToWait) {
    await new Promise<void>((resolveWait) => {
      const timeout = setTimeout(() => resolveWait(), 2_000);
      procToWait.on("exit", () => {
        clearTimeout(timeout);
        resolveWait();
      });
    });
  }
  await sleep(500);

  // Kill any remaining processes on port
  safeExec(`lsof -ti:${port} 2>/dev/null | xargs kill -9 2>/dev/null`);

  console.log("");
  console.log(`=== Results: ${pass} passed, ${fail} failed ===`);
  console.log("");

  if (fail > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Smoke test error:", e);
  process.exit(1);
});
