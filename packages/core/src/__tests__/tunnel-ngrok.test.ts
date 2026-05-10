import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

const { mockSpawn, mockChildProcess, mockHttpRequest } = vi.hoisted(() => {
  const mockChildProcess = {
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
    exitCode: null as number | null,
    pid: 9999,
  };
  const mockSpawn = vi.fn();
  const mockHttpRequest = vi.fn();
  return { mockSpawn, mockChildProcess, mockHttpRequest };
});

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("http", async (original) => {
  const mod = (await original()) as Record<string, unknown>;
  return { ...mod, request: mockHttpRequest };
});

import { NgrokTunnel } from "../tunnel.js";

function mockEmptyApi() {
  mockHttpRequest.mockImplementation((_url: string, _options: any, callback: any) => {
    const res = {
      on: vi.fn((event: string, handler: any) => {
        if (event === "end") handler();
      }),
    };
    callback(res);
    return { on: vi.fn(), end: vi.fn() };
  });
}

describe("NgrokTunnel", () => {
  let activePromises: Promise<unknown>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockChildProcess.on = vi.fn();
    mockChildProcess.kill = vi.fn();
    mockChildProcess.killed = false;
    mockChildProcess.exitCode = null;
    mockSpawn.mockReturnValue(mockChildProcess);
    activePromises = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function trackedStart(tunnel: NgrokTunnel): Promise<string> {
    const p = tunnel.start().catch(() => "");
    activePromises.push(p);
    return p;
  }

  describe("constructor", () => {
    it("stores targetUrl and apiUrl", () => {
      const tunnel = new NgrokTunnel("http://127.0.0.1:9000");
      expect(tunnel).toBeDefined();
    });

    it("accepts custom apiUrl", () => {
      const tunnel = new NgrokTunnel("http://127.0.0.1:9000", "http://localhost:4041/api");
      expect(tunnel).toBeDefined();
    });
  });

  describe("start", () => {
    it("spawns ngrok process with target URL", async () => {
      mockHttpRequest.mockImplementation((url: string, options: any, callback: any) => {
        const res = {
          on: vi.fn((event: string, handler: any) => {
            if (event === "data") setTimeout(() => handler('{"endpoints":[]}'), 0);
            if (event === "end") setTimeout(() => handler(), 5);
          }),
        };
        setTimeout(() => callback(res), 0);
        return { on: vi.fn(), end: vi.fn() };
      });

      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      void trackedStart(tunnel);

      expect(mockSpawn).toHaveBeenCalledWith("ngrok", ["http", "http://127.0.0.1:8080"], {
        stdio: "ignore",
      });
    });

    it("throws when ngrok exits before creating tunnel", async () => {
      mockChildProcess.exitCode = 1;

      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      await expect(tunnel.start()).rejects.toThrow("ngrok exited before creating a tunnel");
    });

    it("returns public URL when found via endpoints API", async () => {
      mockHttpRequest.mockImplementation((url: string, _options: any, callback: any) => {
        if (url.includes("endpoints")) {
          const res = {
            on: vi.fn((event: string, handler: any) => {
              if (event === "data")
                handler(
                  JSON.stringify({
                    endpoints: [{ url: "https://test.ngrok-free.dev" }],
                  }),
                );
              if (event === "end") handler();
            }),
          };
          callback(res);
        } else {
          const res = {
            on: vi.fn((event: string, handler: any) => {
              if (event === "end") handler();
            }),
          };
          callback(res);
        }
        return { on: vi.fn(), end: vi.fn() };
      });

      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      const url = await tunnel.start();
      expect(url).toBe("https://test.ngrok-free.dev");
    });

    it("returns public URL when found via tunnels API", async () => {
      mockHttpRequest.mockImplementation((url: string, _options: any, callback: any) => {
        if (url.includes("tunnels")) {
          const res = {
            on: vi.fn((event: string, handler: any) => {
              if (event === "data")
                handler(
                  JSON.stringify({
                    tunnels: [{ public_url: "https://tunnel.ngrok-free.dev" }],
                  }),
                );
              if (event === "end") handler();
            }),
          };
          callback(res);
        } else {
          const res = {
            on: vi.fn((event: string, handler: any) => {
              if (event === "end") handler();
            }),
          };
          callback(res);
        }
        return { on: vi.fn(), end: vi.fn() };
      });

      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      const url = await tunnel.start();
      expect(url).toBe("https://tunnel.ngrok-free.dev");
    });
  });

  describe("stop", () => {
    it("sends SIGTERM after start", async () => {
      mockEmptyApi();
      mockChildProcess.killed = false;
      mockChildProcess.exitCode = null;
      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      void trackedStart(tunnel);

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled(), { timeout: 100 });

      tunnel.stop();
      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("skips kill when process already killed", async () => {
      mockEmptyApi();
      mockChildProcess.killed = true;
      mockChildProcess.exitCode = null;
      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      void trackedStart(tunnel);
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled(), { timeout: 100 });

      mockChildProcess.kill.mockClear();
      tunnel.stop();
      expect(mockChildProcess.kill).not.toHaveBeenCalled();
    });

    it("no-ops when not started", () => {
      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      expect(() => tunnel.stop()).not.toThrow();
    });

    it("schedules SIGKILL after 5s", async () => {
      vi.useFakeTimers();
      mockEmptyApi();
      mockChildProcess.killed = false;
      mockChildProcess.exitCode = null;
      const tunnel = new NgrokTunnel("http://127.0.0.1:8080");
      void trackedStart(tunnel);
      await vi.advanceTimersByTimeAsync(10);

      tunnel.stop();
      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGTERM");

      vi.advanceTimersByTime(6000);
      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
    });
  });
});
