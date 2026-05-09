import { Command } from "commander";
import * as p from "@clack/prompts";
import { execSync, spawn } from "child_process";
import { readPid, isRunning, removePidFile, sleep } from "../daemon.js";

function spawnBackground(): void {
  const self = process.argv[1];
  const isBuilt = !self.endsWith(".ts");

  let child;
  if (isBuilt) {
    child = spawn(process.execPath, [self, "start", "--no-interactive", "--detach"], {
      detached: true,
      stdio: "ignore",
    });
  } else {
    child = spawn("npx", ["tsx", self, "start", "--no-interactive", "--detach"], {
      detached: true,
      stdio: "ignore",
    });
  }
  child.unref();
}

async function restartAction() {
  const pid = readPid();
  if (pid !== null && isRunning(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        if (!isRunning(pid)) break;
      }
      if (isRunning(pid)) {
        process.kill(pid, "SIGKILL");
      }
    } catch {}
    p.log.success(`Stopped proxy (PID ${pid})`);
  } else {
    try {
      execSync("pkill -f ngrok", { stdio: "ignore" });
    } catch {}
  }
  removePidFile();

  await sleep(1000);

  spawnBackground();
  p.log.success("Proxy restarting in background...");
}

export const restartCmd = new Command("restart")
  .description("Stop and restart the proxy in background")
  .action(restartAction);
