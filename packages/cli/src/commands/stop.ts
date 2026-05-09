import { Command } from "commander";
import * as p from "@clack/prompts";
import { execSync } from "child_process";
import { readPid, isRunning, removePidFile, sleep } from "../daemon.js";

async function stopAction() {
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
      p.log.success("Stopped proxy process");
    } catch {
      p.log.info("Proxy is not running");
    }
  }
  removePidFile();
}

export const stopCmd = new Command("stop").description("Stop the running proxy").action(stopAction);
