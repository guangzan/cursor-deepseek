import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

const {
  mockLog,
  mockReadPid,
  mockIsRunning,
  mockRemovePidFile,
  mockSleep,
  mockExecSync,
  mockSpawn,
} = vi.hoisted(() => {
  const mockLog = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    step: vi.fn(),
  };
  const mockReadPid = vi.fn().mockReturnValue(null);
  const mockIsRunning = vi.fn().mockReturnValue(false);
  const mockRemovePidFile = vi.fn();
  const mockSleep = vi.fn().mockResolvedValue(undefined);
  const mockExecSync = vi.fn();
  const mockChild = { unref: vi.fn() };
  const mockSpawn = vi.fn().mockReturnValue(mockChild);
  return {
    mockLog,
    mockReadPid,
    mockIsRunning,
    mockRemovePidFile,
    mockSleep,
    mockExecSync,
    mockSpawn,
  };
});

vi.mock("@clack/prompts", () => ({
  log: mockLog,
}));

vi.mock("child_process", () => ({
  execSync: mockExecSync,
  spawn: mockSpawn,
}));

vi.mock("../daemon.js", () => ({
  readPid: mockReadPid,
  isRunning: mockIsRunning,
  removePidFile: mockRemovePidFile,
  sleep: mockSleep,
}));

import { restartCmd } from "../commands/restart.js";

describe("restart command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadPid.mockReturnValue(null);
    mockIsRunning.mockReturnValue(false);
    mockExecSync.mockReturnValue(Buffer.from(""));
    process.argv[1] = "/usr/local/bin/dsl";
  });

  it("stops running proxy and spawns background process", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    await restartCmd.parseAsync(["node", "dsl"]);

    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(mockLog.success).toHaveBeenCalledWith("Stopped proxy (PID 12345)");
    expect(mockRemovePidFile).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalled();
    expect(mockLog.success).toHaveBeenCalledWith("Proxy restarting in background...");
    vi.restoreAllMocks();
  });

  it("kills ngrok when no PID file exists", async () => {
    await restartCmd.parseAsync(["node", "dsl"]);

    expect(mockExecSync).toHaveBeenCalledWith("pkill -f ngrok", { stdio: "ignore" });
    expect(mockSpawn).toHaveBeenCalled();
  });

  it("catches pkill errors and continues spawning", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("no match");
    });

    await restartCmd.parseAsync(["node", "dsl"]);

    expect(mockSpawn).toHaveBeenCalled();
    expect(mockLog.success).toHaveBeenCalledWith("Proxy restarting in background...");
  });

  it("sends SIGKILL if process persists after SIGTERM", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    const killSpy2 = vi.spyOn(process, "kill").mockImplementation(() => true);

    await restartCmd.parseAsync(["node", "dsl"]);

    expect(killSpy2).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(killSpy2).toHaveBeenCalledWith(12345, "SIGKILL");
    killSpy2.mockRestore();
  });

  it("spawns with tsx for .ts file", async () => {
    process.argv[1] = "/path/to/cli.ts";
    mockSpawn.mockReturnValue({ unref: vi.fn() });

    await restartCmd.parseAsync(["node", "dsl"]);

    expect(mockSpawn).toHaveBeenCalledWith(
      "npx",
      ["tsx", "/path/to/cli.ts", "start", "--no-interactive", "--detach"],
      expect.any(Object),
    );
  });
});
