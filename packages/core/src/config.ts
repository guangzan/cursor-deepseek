import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { load } from "js-yaml";
import { ProxyConfig } from "./types.js";

const APP_DIR = resolve(homedir(), ".deepseek-lane");
const CONFIG_PATH = resolve(APP_DIR, "config.yaml");
const REASONING_CONTENT_PATH = resolve(APP_DIR, "reasoning_content.sqlite3");

const DEFAULT_CONFIG_TEXT = `# deepseek-lane config
# API keys are read from Cursor's Authorization header and forwarded upstream.

base_url: https://opencode.ai/zen/go/v1
model: deepseek-v4-pro
thinking: enabled
reasoning_effort: medium
display_reasoning: true
collapsible_reasoning: true

host: 127.0.0.1
port: 19199
ngrok: true
verbose: false
request_timeout: 300
max_request_body_bytes: 20971520
cors: false

missing_reasoning_strategy: recover
reasoning_cache_max_age_seconds: 2592000
reasoning_cache_max_rows: 100000
`;

export interface CliArgs {
  config?: string;
  host?: string;
  port?: number;
  model?: string;
  baseUrl?: string;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: string;
  ngrok?: boolean;
  verbose?: boolean;
  displayReasoning?: boolean;
  collapsibleReasoning?: boolean;
  requestTimeout?: number;
  maxRequestBodyBytes?: number;
  missingReasoningStrategy?: "recover" | "reject";
  noNgrok?: boolean;
  noVerbose?: boolean;
  noDisplayReasoning?: boolean;
  noCollapsibleReasoning?: boolean;
  clearReasoningCache?: boolean;
}

function loadYamlConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(configPath, DEFAULT_CONFIG_TEXT, "utf-8");
    chmodSync(configPath, 0o600);
    return {};
  }
  const raw = readFileSync(configPath, "utf-8");
  const loaded = load(raw) as Record<string, unknown> | null;
  return loaded ?? {};
}

export function createConfig(cliArgs: CliArgs): ProxyConfig {
  const configPath = cliArgs.config ?? CONFIG_PATH;
  const fileConfig = loadYamlConfig(configPath);

  const fromFile = (key: string, def: unknown): unknown =>
    fileConfig[key] !== undefined ? fileConfig[key] : def;

  const strVal = (v: unknown, def: string): string => {
    if (v === undefined || v === null) return def;
    if (typeof v === "string") return v;
    return JSON.stringify(v) ?? def;
  };

  const boolVal = (v: unknown, def: boolean): boolean => {
    if (v === undefined || v === null) return def;
    if (typeof v === "boolean") return v;
    const s = (typeof v === "string" ? v : JSON.stringify(v)).toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return def;
  };

  const intVal = (v: unknown, def: number): number => {
    if (v === undefined || v === null) return def;
    const n = Number(v);
    return Number.isInteger(n) ? n : def;
  };

  const floatVal = (v: unknown, def: number): number => {
    if (v === undefined || v === null) return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  const thinking = (v: unknown): "enabled" | "disabled" => {
    const s = strVal(v, "enabled").toLowerCase();
    return s === "enabled" || s === "disabled" ? s : "enabled";
  };

  const effort = strVal(
    cliArgs.reasoningEffort ?? fromFile("reasoning_effort", "medium"),
    "medium",
  );
  const validEfforts = ["low", "medium", "high", "max", "xhigh"];
  const reasoningEffort = validEfforts.includes(effort) ? effort : "medium";

  return {
    host: strVal(cliArgs.host ?? fromFile("host", "127.0.0.1"), "127.0.0.1"),
    port: intVal(cliArgs.port ?? fromFile("port", 19199), 19199),
    upstreamBaseUrl: strVal(
      cliArgs.baseUrl ?? fromFile("base_url", "https://opencode.ai/zen/go/v1"),
      "https://opencode.ai/zen/go/v1",
    ).replace(/\/+$/, ""),
    upstreamModel: strVal(cliArgs.model ?? fromFile("model", "deepseek-v4-pro"), "deepseek-v4-pro"),
    thinking: thinking(cliArgs.thinking ?? fromFile("thinking", "enabled")),
    reasoningEffort,
    requestTimeout: floatVal(cliArgs.requestTimeout ?? fromFile("request_timeout", 300), 300),
    maxRequestBodyBytes: intVal(
      cliArgs.maxRequestBodyBytes ?? fromFile("max_request_body_bytes", 20 * 1024 * 1024),
      20 * 1024 * 1024,
    ),
    reasoningContentPath: strVal(
      fromFile("reasoning_content_path", REASONING_CONTENT_PATH),
      REASONING_CONTENT_PATH,
    ),
    missingReasoningStrategy: (() => {
      const s = strVal(
        cliArgs.missingReasoningStrategy ?? fromFile("missing_reasoning_strategy", "recover"),
        "recover",
      ).toLowerCase();
      return s === "recover" || s === "reject" ? s : "recover";
    })(),
    reasoningCacheMaxAgeSeconds: intVal(
      fromFile("reasoning_cache_max_age_seconds", 30 * 24 * 60 * 60),
      30 * 24 * 60 * 60,
    ),
    reasoningCacheMaxRows: intVal(fromFile("reasoning_cache_max_rows", 100000), 100000),
    displayReasoning:
      cliArgs.displayReasoning !== undefined
        ? cliArgs.displayReasoning
        : boolVal(fromFile("display_reasoning", true), true),
    collapsibleReasoning:
      cliArgs.collapsibleReasoning !== undefined
        ? cliArgs.collapsibleReasoning
        : boolVal(fromFile("collapsible_reasoning", fromFile("collasible_reasoning", true)), true),
    ngrok: cliArgs.ngrok !== undefined ? cliArgs.ngrok : boolVal(fromFile("ngrok", true), true),
    verbose:
      cliArgs.verbose !== undefined ? cliArgs.verbose : boolVal(fromFile("verbose", false), false),
  };
}

export { APP_DIR, CONFIG_PATH, REASONING_CONTENT_PATH };
