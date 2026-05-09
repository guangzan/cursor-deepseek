import { Command } from "commander";
import * as p from "@clack/prompts";
import { readFileSync, existsSync } from "fs";
import { readPid, isRunning, CONFIG_PATH, detectNgrokUrl } from "../daemon.js";

async function statusAction() {
  const pid = readPid();
  if (pid !== null && isRunning(pid)) {
    p.log.success(`Proxy is running (PID ${pid})`);
    if (existsSync(CONFIG_PATH)) {
      try {
        const cfg = readFileSync(CONFIG_PATH, "utf-8");
        for (const line of cfg.split("\n")) {
          const s = line.trim();
          if (s.startsWith("base_url:")) p.log.info(`API:  ${s.slice(10).trim()}`);
          if (s.startsWith("port:")) p.log.info(`Port: ${s.slice(5).trim()}`);
        }
      } catch {}
    }
    const ngrokUrl = detectNgrokUrl();
    if (ngrokUrl) p.log.info(`Public URL: ${ngrokUrl}`);
  } else {
    p.log.info("Proxy is not running");
  }
}

export const statusCmd = new Command("status")
  .description("Check if the proxy is running")
  .action(statusAction);
