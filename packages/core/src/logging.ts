import chalk from "chalk";
import ora from "ora";

const PREFIX = {
  info: chalk.cyan("▸"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✗"),
  success: chalk.green("✓"),
};

let _verbose = false;

export function setVerbose(v: boolean) {
  _verbose = v;
}

export function log(...args: unknown[]) {
  console.log(PREFIX.info, ...args);
}

export function logInfo(msg: string) {
  console.log(PREFIX.info, msg);
}

export function logWarn(msg: string) {
  console.log(PREFIX.warn, chalk.yellow(msg));
}

export function logError(msg: string) {
  console.error(PREFIX.error, chalk.red(msg));
}

export function logSuccess(msg: string) {
  console.log(PREFIX.success, chalk.green(msg));
}

export function logVerbose(msg: string) {
  if (_verbose) {
    console.log(chalk.gray(`[verbose] ${msg}`));
  }
}

export function logJson(label: string, data: unknown) {
  if (_verbose) {
    console.log(chalk.gray(`[verbose] ${label}:`));
    console.log(JSON.stringify(data, null, 2).replace(/^/gm, "  "));
  }
}

export function createSpinner(text: string) {
  const spinner = ora({
    text,
    color: "cyan",
  });
  return spinner;
}

export const boxChar = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  tee: "├",
  bottomTee: "└",
};
