import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

const {
  mockLog,
  mockReadPid,
  mockIsRunning,
  mockExistsSync,
  mockReadFileSync,
  mockDetectNgrokUrl,
} = vi.hoisted(() => {
  const mockLog = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    step: vi.fn(),
  };
  const mockReadPid = vi.fn();
  const mockIsRunning = vi.fn();
  const mockExistsSync = vi.fn();
  const mockReadFileSync = vi.fn();
  const mockDetectNgrokUrl = vi.fn();
  return {
    mockLog,
    mockReadPid,
    mockIsRunning,
    mockExistsSync,
    mockReadFileSync,
    mockDetectNgrokUrl,
  };
});

vi.mock("@clack/prompts", () => ({
  log: mockLog,
}));

vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock("../daemon.js", () => ({
  readPid: mockReadPid,
  isRunning: mockIsRunning,
  detectNgrokUrl: mockDetectNgrokUrl,
  CONFIG_PATH: "/home/testuser/.deepseek-lane/config.yaml",
}));

import { statusCmd } from "../commands/status.js";

describe("status command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows running status with PID when proxy is active", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "# deepseek-lane config\nbase_url: https://api.test.com\nport: 19199\n",
    );
    mockDetectNgrokUrl.mockReturnValue(null);

    await statusCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.success).toHaveBeenCalledWith("Proxy is running (PID 12345)");
    expect(mockLog.info).toHaveBeenCalledWith("API:  https://api.test.com");
    expect(mockLog.info).toHaveBeenCalledWith("Port: 19199");
  });

  it("shows not running when no PID found", async () => {
    mockReadPid.mockReturnValue(null);
    mockIsRunning.mockReturnValue(false);

    await statusCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.info).toHaveBeenCalledWith("Proxy is not running");
  });

  it("shows running with ngrok URL when available", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    mockDetectNgrokUrl.mockReturnValue("https://abc.ngrok-free.dev/v1");

    await statusCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.success).toHaveBeenCalledWith("Proxy is running (PID 12345)");
    expect(mockLog.info).toHaveBeenCalledWith("Public URL: https://abc.ngrok-free.dev/v1");
  });

  it("handles config read errors gracefully", async () => {
    mockReadPid.mockReturnValue(12345);
    mockIsRunning.mockReturnValue(true);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("permission");
    });
    mockDetectNgrokUrl.mockReturnValue(null);

    await statusCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.success).toHaveBeenCalledWith("Proxy is running (PID 12345)");
  });
});
