import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

const { mockLog, mockReadPid, mockIsRunning, mockRemovePidFile, mockSleep, mockExecSync } =
  vi.hoisted(() => {
    const mockLog = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      step: vi.fn(),
    };
    const mockReadPid = vi.fn();
    const mockIsRunning = vi.fn();
    const mockRemovePidFile = vi.fn();
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const mockExecSync = vi.fn();
    return {
      mockLog,
      mockReadPid,
      mockIsRunning,
      mockRemovePidFile,
      mockSleep,
      mockExecSync,
    };
  });

vi.mock("@clack/prompts", () => ({
  log: mockLog,
}));

vi.mock("child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("../daemon.js", () => ({
  readPid: mockReadPid,
  isRunning: mockIsRunning,
  removePidFile: mockRemovePidFile,
  sleep: mockSleep,
}));

import { stopCmd } from "../commands/stop.js";

describe("stop command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops running proxy by PID", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    await stopCmd.parseAsync(["node", "dsl"]);

    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(mockLog.success).toHaveBeenCalledWith("Stopped proxy (PID 12345)");
    expect(mockRemovePidFile).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("sends SIGKILL after SIGTERM if process persists", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    const killSpy2 = vi.spyOn(process, "kill").mockImplementation(() => true);

    await stopCmd.parseAsync(["node", "dsl"]);

    expect(killSpy2).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(killSpy2).toHaveBeenCalledWith(12345, "SIGKILL");
    expect(mockSleep).toHaveBeenCalled();
    killSpy2.mockRestore();
  });

  it("kills ngrok and shows success when no PID file", async () => {
    mockReadPid.mockReturnValue(null);
    mockExecSync.mockReturnValue(Buffer.from(""));
    mockIsRunning.mockReturnValue(false);

    await stopCmd.parseAsync(["node", "dsl"]);

    expect(mockExecSync).toHaveBeenCalledWith("pkill -f ngrok", { stdio: "ignore" });
    expect(mockLog.success).toHaveBeenCalledWith("Stopped proxy process");
    expect(mockRemovePidFile).toHaveBeenCalled();
  });

  it("shows not running when pkill also fails", async () => {
    mockReadPid.mockReturnValue(null);
    mockExecSync.mockImplementation(() => {
      throw new Error("no processes matched");
    });

    await stopCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.info).toHaveBeenCalledWith("Proxy is not running");
  });

  it("catches process.kill errors gracefully", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    await stopCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.success).toHaveBeenCalledWith("Stopped proxy (PID 12345)");
    vi.restoreAllMocks();
  });
});
