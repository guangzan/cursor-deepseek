import { Command } from "commander";
import * as p from "@clack/prompts";
import { execSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
const currentVersion = pkg.version;

const REGISTRY_URL = "https://registry.npmjs.org/deepseek-lane/latest";

interface NpmRegistryVersion {
  version: string;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NpmRegistryVersion;
    return data.version;
  } catch {
    return null;
  }
}

export function compareVersions(a: string, b: string): number {
  const [a1, a2, a3] = a.split(".").map(Number);
  const [b1, b2, b3] = b.split(".").map(Number);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  if (a3 !== b3) return a3 - b3;
  return 0;
}

async function upgradeAction(opts: { yes?: boolean; dryRun?: boolean }) {
  const latest = await fetchLatestVersion();

  if (!latest) {
    p.log.error("Failed to fetch latest version from npm registry");
    process.exit(1);
  }

  const cmp = compareVersions(currentVersion, latest);

  if (cmp === 0) {
    p.log.success(`Already up to date (v${currentVersion})`);
    return;
  }

  if (cmp > 0) {
    p.log.info(`Current v${currentVersion} is newer than latest v${latest} (development build)`);
    return;
  }

  p.log.info(`Current: v${currentVersion}`);
  p.log.info(`Latest:  v${latest}`);

  if (opts.dryRun) {
    p.log.info("Dry run — not upgrading");
    return;
  }

  const shouldUpgrade =
    opts.yes ||
    (await p.confirm({
      message: `Upgrade to v${latest}?`,
      initialValue: true,
    }));

  if (p.isCancel(shouldUpgrade)) {
    p.cancel("Cancelled");
    return;
  }

  if (!shouldUpgrade) {
    p.log.info("Not upgrading");
    return;
  }

  try {
    p.log.step("Upgrading via npm install -g...");
    execSync("npm install -g deepseek-lane@latest", { stdio: "inherit" });
    p.log.success(`Upgraded to v${latest}`);
  } catch (err) {
    p.log.error(`Upgrade failed: ${String(err)}`);
    process.exit(1);
  }
}

export const upgradeCmd = new Command("upgrade")
  .description("Upgrade to the latest version")
  .option("-y, --yes", "Skip confirmation")
  .option("--dry-run", "Check for updates without upgrading")
  .action(async function (this: Command) {
    await upgradeAction(this.opts());
  });
