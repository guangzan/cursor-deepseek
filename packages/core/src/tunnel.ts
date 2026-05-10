import { spawn, ChildProcess } from "child_process";
import { request } from "http";

const NGROK_API_URL = "http://127.0.0.1:4040/api";

export function localTunnelTarget(host: string, port: number): string {
  let h = host.trim() || "127.0.0.1";
  if (h === "0.0.0.0" || h === "::") h = "127.0.0.1";
  if (h.includes(":") && !h.startsWith("[")) h = `[${h}]`;
  return `http://${h}:${port}`;
}

async function fetchNgrokApi(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = request(url, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ngrok API: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("ngrok API timeout"));
    });
    req.end();
  });
}

export function parseNgrokPublicUrl(payload: Record<string, unknown>): string | null {
  const records = (payload.endpoints || payload.tunnels) as unknown[];
  if (!Array.isArray(records)) return null;

  const urls: string[] = [];
  for (const record of records) {
    if (typeof record === "object" && record !== null) {
      const r = record as Record<string, unknown>;
      if (typeof r.url === "string") urls.push(r.url);
      if (typeof r.public_url === "string") urls.push(r.public_url);
    }
  }

  const httpsUrl = urls.find((u) => u.startsWith("https://"));
  if (httpsUrl) return httpsUrl;
  const httpUrl = urls.find((u) => u.startsWith("http://"));
  if (httpUrl) return httpUrl;
  return null;
}

export class NgrokTunnel {
  private process: ChildProcess | null = null;
  private targetUrl: string;
  private apiUrl: string;
  private sigkillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(targetUrl: string, apiUrl = NGROK_API_URL) {
    this.targetUrl = targetUrl;
    this.apiUrl = apiUrl;
  }

  async start(): Promise<string> {
    this.process = spawn("ngrok", ["http", this.targetUrl], {
      stdio: "ignore",
    });

    return this.waitForPublicUrl();
  }

  private async waitForPublicUrl(): Promise<string> {
    const deadline = Date.now() + 15000;
    let lastError = "ngrok did not report a public URL";

    while (Date.now() < deadline) {
      try {
        const apiEndpoints = [`${this.apiUrl}/endpoints`, `${this.apiUrl}/tunnels`];

        for (const url of apiEndpoints) {
          try {
            const payload = await fetchNgrokApi(url);
            const publicUrl = parseNgrokPublicUrl(payload);
            if (publicUrl) return publicUrl;
          } catch (e) {
            lastError = String(e);
          }
        }
      } catch (e) {
        lastError = String(e);
      }

      // Check exit code AFTER the API call to avoid throwing
      // right after a successful fetch
      if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) {
        throw new Error("ngrok exited before creating a tunnel");
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for ngrok tunnel: ${lastError}`);
  }

  stop() {
    if (this.sigkillTimer) {
      clearTimeout(this.sigkillTimer);
      this.sigkillTimer = null;
    }
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      this.sigkillTimer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
    }
  }
}
