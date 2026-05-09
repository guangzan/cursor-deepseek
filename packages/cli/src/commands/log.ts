import { Command } from "commander";
import * as p from "@clack/prompts";
import { readFileSync, existsSync } from "fs";
import { LOG_PATH } from "../daemon.js";

async function logAction() {
  if (existsSync(LOG_PATH)) {
    try {
      const lines = readFileSync(LOG_PATH, "utf-8").split("\n").filter(Boolean);
      const tail = lines.slice(-50);
      console.log(tail.join("\n"));
    } catch (err) {
      p.log.error(`Failed to read log: ${String(err)}`);
    }
  } else {
    p.log.info("No log file found");
  }
}

export const logCmd = new Command("log")
  .description("Show recent proxy log output")
  .action(logAction);
