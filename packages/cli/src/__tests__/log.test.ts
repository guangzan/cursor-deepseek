import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

const { mockLog, mockExistsSync, mockReadFileSync, mockConsoleLog } = vi.hoisted(() => {
  const mockLog = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    step: vi.fn(),
  };
  const mockExistsSync = vi.fn();
  const mockReadFileSync = vi.fn();
  const mockConsoleLog = vi.fn();
  return { mockLog, mockExistsSync, mockReadFileSync, mockConsoleLog };
});

vi.mock("@clack/prompts", () => ({
  log: mockLog,
}));

vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock("../daemon.js", () => ({
  LOG_PATH: "/home/testuser/.deepseek-lane/log",
}));

vi.stubGlobal("console", {
  ...console,
  log: mockConsoleLog,
});

import { logCmd } from "../commands/log.js";

describe("log command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows last 50 lines of log file", async () => {
    mockExistsSync.mockReturnValue(true);
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    mockReadFileSync.mockReturnValue(lines.join("\n") + "\n");

    await logCmd.parseAsync(["node", "dsl"]);

    const output = mockConsoleLog.mock.calls[0][0] as string;
    const outputLines = output.split("\n");
    expect(outputLines.length).toBe(50);
    expect(outputLines[0]).toBe("line 51");
    expect(outputLines[49]).toBe("line 100");
  });

  it("shows all lines when fewer than 50", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("line 1\nline 2\nline 3\n");

    await logCmd.parseAsync(["node", "dsl"]);

    const output = mockConsoleLog.mock.calls[0][0] as string;
    expect(output.split("\n").length).toBe(3);
  });

  it("shows info when log file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    await logCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.info).toHaveBeenCalledWith("No log file found");
  });

  it("shows error when read fails", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("read error");
    });

    await logCmd.parseAsync(["node", "dsl"]);

    expect(mockLog.error).toHaveBeenCalledWith("Failed to read log: Error: read error");
  });
});
