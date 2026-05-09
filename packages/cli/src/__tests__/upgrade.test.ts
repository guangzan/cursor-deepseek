import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

const { mockFetch, mockLog, mockConfirm, mockIsCancel, mockCancel } = vi.hoisted(() => {
  const mockLog = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    step: vi.fn(),
  };
  const mockConfirm = vi.fn();
  const mockIsCancel = vi.fn().mockReturnValue(false);
  const mockCancel = vi.fn();
  return { mockFetch: vi.fn(), mockLog, mockConfirm, mockIsCancel, mockCancel };
});

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  confirm: mockConfirm,
  isCancel: mockIsCancel,
  cancel: mockCancel,
  intro: vi.fn(),
  outro: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("module", async (original) => {
  const mod = (await original()) as Record<string, unknown>;
  return {
    ...mod,
    createRequire: vi.fn().mockReturnValue(vi.fn().mockReturnValue({ version: "0.1.0" })),
  };
});

globalThis.fetch = mockFetch;

import { upgradeCmd, compareVersions } from "../commands/upgrade.js";
import { execSync } from "child_process";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns negative when first is older", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });

  it("returns positive when first is newer", () => {
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("compares major version first", () => {
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.99.99", "2.0.0")).toBeLessThan(0);
  });

  it("compares minor version when major is equal", () => {
    expect(compareVersions("1.5.99", "1.4.99")).toBeGreaterThan(0);
    expect(compareVersions("1.4.99", "1.5.99")).toBeLessThan(0);
  });

  it("compares patch version when major and minor are equal", () => {
    expect(compareVersions("1.0.10", "1.0.5")).toBeGreaterThan(0);
    expect(compareVersions("1.0.5", "1.0.10")).toBeLessThan(0);
  });
});

describe("upgrade command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
    mockConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  function mockRegistryVersion(version: string | null, status = 200) {
    if (version === null) {
      mockFetch.mockRejectedValue(new Error("Network error"));
    } else {
      mockFetch.mockResolvedValue({
        ok: status === 200,
        json: async () => ({ version }),
      });
    }
  }

  async function runCmd(args: string[]): Promise<void> {
    const exitMock = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await upgradeCmd.parseAsync(["node", "dsl", ...args]);
    } catch (e) {
      const msg = String(e);
      if (!msg.startsWith("Error: process.exit")) throw e;
    }
    exitMock.mockRestore();
  }

  it("shows already up to date when versions match", async () => {
    mockRegistryVersion("0.1.0");
    await runCmd(["--dry-run"]);
    expect(mockLog.success).toHaveBeenCalledWith("Already up to date (v0.1.0)");
  });

  it("shows development build when current is newer", async () => {
    mockRegistryVersion("0.0.5");
    await runCmd(["--dry-run"]);
    expect(mockLog.info).toHaveBeenCalledWith(
      "Current v0.1.0 is newer than latest v0.0.5 (development build)",
    );
  });

  it("shows current and latest versions when update available", async () => {
    mockRegistryVersion("0.2.0");
    await runCmd(["--dry-run"]);
    expect(mockLog.info).toHaveBeenCalledWith("Current: v0.1.0");
    expect(mockLog.info).toHaveBeenCalledWith("Latest:  v0.2.0");
  });

  it("dry-run does not prompt or upgrade", async () => {
    mockRegistryVersion("0.2.0");
    await runCmd(["--dry-run"]);
    expect(mockLog.info).toHaveBeenCalledWith("Dry run — not upgrading");
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
  });

  it("executes npm install with --yes flag", async () => {
    mockRegistryVersion("0.2.0");
    await runCmd(["--yes"]);
    expect(mockLog.step).toHaveBeenCalledWith("Upgrading via npm install -g...");
    expect(execSync).toHaveBeenCalledWith("npm install -g deepseek-lane@latest", {
      stdio: "inherit",
    });
    expect(mockLog.success).toHaveBeenCalledWith("Upgraded to v0.2.0");
  });

  it("skips upgrade when user declines confirmation", async () => {
    mockRegistryVersion("0.2.0");
    mockConfirm.mockResolvedValue(false);
    await runCmd([]);
    expect(mockLog.info).toHaveBeenCalledWith("Not upgrading");
    expect(execSync).not.toHaveBeenCalled();
  });

  it("cancels when user cancels confirm prompt", async () => {
    mockRegistryVersion("0.2.0");
    mockIsCancel.mockReturnValue(true);
    await runCmd([]);
    expect(mockCancel).toHaveBeenCalledWith("Cancelled");
    expect(execSync).not.toHaveBeenCalled();
  });

  it("shows error when registry fetch fails", async () => {
    mockRegistryVersion(null);
    const exitMock = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await upgradeCmd.parseAsync(["node", "dsl"]);
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain("process.exit(1)");
    }
    expect(mockLog.error).toHaveBeenCalledWith("Failed to fetch latest version from npm registry");
    exitMock.mockRestore();
  });

  it("shows error when npm install fails", async () => {
    mockRegistryVersion("0.2.0");
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("EACCES");
    });
    const exitMock = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await upgradeCmd.parseAsync(["node", "dsl", "--yes"]);
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain("process.exit(1)");
    }
    expect(mockLog.error).toHaveBeenCalledWith("Upgrade failed: Error: EACCES");
    exitMock.mockRestore();
  });

  it("prompts user for confirmation without --yes", async () => {
    mockRegistryVersion("0.2.0");
    await runCmd([]);
    expect(mockConfirm).toHaveBeenCalledWith({
      message: "Upgrade to v0.2.0?",
      initialValue: true,
    });
  });

  it("skips prompt with --yes flag", async () => {
    mockRegistryVersion("0.2.0");
    await runCmd(["--yes"]);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("handles non-200 response from registry", async () => {
    mockRegistryVersion("0.2.0", 500);
    const exitMock = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      await upgradeCmd.parseAsync(["node", "dsl"]);
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain("process.exit(1)");
    }
    expect(mockLog.error).toHaveBeenCalledWith("Failed to fetch latest version from npm registry");
    exitMock.mockRestore();
  });
});
