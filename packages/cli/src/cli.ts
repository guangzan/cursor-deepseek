#!/usr/bin/env node
import { createRequire } from "module";
import { Command } from "commander";
import { startCmd } from "./commands/start.js";
import { stopCmd } from "./commands/stop.js";
import { restartCmd } from "./commands/restart.js";
import { statusCmd } from "./commands/status.js";
import { logCmd } from "./commands/log.js";
import { upgradeCmd } from "./commands/upgrade.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("dsl")
  .description("Local proxy that connects Cursor to DeepSeek thinking models")
  .version(pkg.version, "-v, --version");

program.addCommand(startCmd);
program.addCommand(stopCmd);
program.addCommand(restartCmd);
program.addCommand(statusCmd);
program.addCommand(logCmd);
program.addCommand(upgradeCmd);

program.parse();
