import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockChmodSync,
  mockExecSync,
} = vi.hoisted(() => {
  const mockExistsSync = vi.fn();
  const mockReadFileSync = vi.fn();
  const mockWriteFileSync = vi.fn();
  const mockMkdirSync = vi.fn();
  const mockChmodSync = vi.fn();
  const mockExecSync = vi.fn();
  return {
    mockExistsSync,
    mockReadFileSync,
    mockWriteFileSync,
    mockMkdirSync,
    mockChmodSync,
    mockExecSync,
  };
});

vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  chmodSync: mockChmodSync,
}));

vi.mock("child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("os", () => ({
  homedir: () => "/home/testuser",
}));

import {
  APP_DIR,
  CONFIG_PATH,
  PID_PATH,
  LOG_PATH,
  ensureDir,
  readPid,
  isRunning,
  isServerRunning,
  detectNgrokUrl,
  writeConfig,
  writePidFile,
  removePidFile,
  sleep,
} from "../daemon.js";

describe("daemon constants", () => {
  it("APP_DIR resolves to ~/.deepseek-lane", () => {
    expect(APP_DIR).toBe("/home/testuser/.deepseek-lane");
  });

  it("CONFIG_PATH is under APP_DIR", () => {
    expect(CONFIG_PATH).toBe("/home/testuser/.deepseek-lane/config.yaml");
  });

  it("PID_PATH is under APP_DIR", () => {
    expect(PID_PATH).toBe("/home/testuser/.deepseek-lane/pid");
  });

  it("LOG_PATH is under APP_DIR", () => {
    expect(LOG_PATH).toBe("/home/testuser/.deepseek-lane/log");
  });
});

describe("ensureDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates directory when it does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    ensureDir();
    expect(mockMkdirSync).toHaveBeenCalledWith(APP_DIR, { recursive: true, mode: 0o700 });
  });

  it("does not create directory when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    ensureDir();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

describe("readPid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns PID from PID file", () => {
    mockExistsSync.mockImplementation((p: string) => p === PID_PATH);
    mockReadFileSync.mockReturnValue("12345\n");
    expect(readPid()).toBe(12345);
  });

  it("returns null when PID file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => {
      throw new Error("pgrep failed");
    });
    expect(readPid()).toBeNull();
  });

  it("returns null when PID file is empty", () => {
    mockExistsSync.mockImplementation((p: string) => p === PID_PATH);
    mockReadFileSync.mockReturnValue("");
    mockExecSync.mockImplementation(() => {
      throw new Error("pgrep failed");
    });
    expect(readPid()).toBeNull();
  });

  it("falls back to pgrep when PID file read fails", () => {
    mockExistsSync.mockImplementation((p: string) => p === PID_PATH);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });
    mockExecSync.mockReturnValue("5555\n6666\n");
    expect(readPid()).toBe(6666);
  });

  it("returns last PID from pgrep output", () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue("1111\n2222\n");
    expect(readPid()).toBe(2222);
  });

  it("returns null when pgrep also fails", () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => {
      throw new Error("pgrep not found");
    });
    expect(readPid()).toBeNull();
  });
});

describe("isRunning", () => {
  it("returns true when kill(pid, 0) succeeds", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(isRunning(12345)).toBe(true);
    vi.restoreAllMocks();
  });

  it("returns false when kill(pid, 0) throws", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(isRunning(12345)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("isServerRunning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when PID exists and process is running", () => {
    mockExistsSync.mockImplementation((p: string) => p === PID_PATH);
    mockReadFileSync.mockReturnValue("12345\n");
    vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(isServerRunning()).toBe(true);
    vi.restoreAllMocks();
  });

  it("returns false when PID exists but process is not running", () => {
    mockExistsSync.mockImplementation((p: string) => p === PID_PATH);
    mockReadFileSync.mockReturnValue("12345\n");
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(isServerRunning()).toBe(false);
    vi.restoreAllMocks();
  });

  it("returns false when no PID found", () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => {
      throw new Error("no match");
    });
    expect(isServerRunning()).toBe(false);
  });
});

describe("detectNgrokUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ngrok URL from log file", () => {
    mockExistsSync.mockImplementation((p: string) => p === LOG_PATH);
    mockReadFileSync.mockReturnValue(
      "ngrok_url: https://abc123.ngrok-free.dev/v1\nother log line\n",
    );
    expect(detectNgrokUrl()).toBe("https://abc123.ngrok-free.dev/v1");
  });

  it("returns null when log file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectNgrokUrl()).toBeNull();
  });

  it("returns null when no ngrok URL in log", () => {
    mockExistsSync.mockImplementation((p: string) => p === LOG_PATH);
    mockReadFileSync.mockReturnValue("some other content\n");
    expect(detectNgrokUrl()).toBeNull();
  });

  it("returns null when read fails", () => {
    mockExistsSync.mockImplementation((p: string) => p === LOG_PATH);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("read error");
    });
    expect(detectNgrokUrl()).toBeNull();
  });
});

describe("writeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes YAML config to file with 0600 permissions", () => {
    mockExistsSync.mockReturnValue(true);
    writeConfig({ base_url: "https://api.test.com", port: 19199 });
    const content = mockWriteFileSync.mock.calls[0][1] as string;
    expect(content).toContain("# deepseek-lane config");
    expect(content).toContain("base_url: https://api.test.com");
    expect(content).toContain("port: 19199");
    expect(mockChmodSync).toHaveBeenCalledWith(CONFIG_PATH, 0o600);
  });
});

describe("writePidFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes given PID to file", () => {
    mockExistsSync.mockReturnValue(true);
    writePidFile(9999);
    expect(mockWriteFileSync).toHaveBeenCalledWith(PID_PATH, "9999", "utf-8");
  });

  it("writes process.pid when no argument given", () => {
    mockExistsSync.mockReturnValue(true);
    writePidFile();
    expect(mockWriteFileSync).toHaveBeenCalledWith(PID_PATH, String(process.pid), "utf-8");
  });
});

describe("removePidFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears PID file when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    removePidFile();
    expect(mockWriteFileSync).toHaveBeenCalledWith(PID_PATH, "", "utf-8");
  });

  it("does nothing when PID file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    removePidFile();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("catches errors silently", () => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockImplementation(() => {
      throw new Error("permission");
    });
    expect(() => removePidFile()).not.toThrow();
  });
});

describe("sleep", () => {
  it("resolves after specified milliseconds", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
