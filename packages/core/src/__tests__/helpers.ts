import http from "http";
import net from "net";
import os from "os";
import fs from "fs";
import path from "path";

export interface MockUpstream {
  url: string;
  server: http.Server;
}

export function getRandomPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export function createMockUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  port?: number,
): Promise<MockUpstream> {
  return new Promise((resolve) => {
    const startServer = (p: number) => {
      const server = http.createServer(handler);
      server.listen(p, () => {
        resolve({ url: `http://127.0.0.1:${p}`, server });
      });
      server.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
          void getRandomPort().then(startServer);
        } else {
          throw err;
        }
      });
    };

    if (port !== undefined) {
      startServer(port);
    } else {
      void getRandomPort().then(startServer);
    }
  });
}

export function tmpDbPath(): string {
  const name = `deepseek-lane-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.sqlite`;
  return path.join(os.tmpdir(), name);
}

export function removeFile(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ok
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function fetchJson(url: string, options?: RequestInit): Promise<unknown> {
  return fetch(url, options).then((r) => r.json());
}

export function fetchText(url: string, options?: RequestInit): Promise<string> {
  return fetch(url, options).then((r) => r.text());
}

export function sseString(chunks: Record<string, unknown>[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}
