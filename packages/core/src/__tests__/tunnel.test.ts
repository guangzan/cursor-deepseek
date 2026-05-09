import { describe, it, expect } from "vite-plus/test";
import { parseNgrokPublicUrl, localTunnelTarget } from "../tunnel.js";

describe("parseNgrokPublicUrl", () => {
  it("extracts https URL from endpoints format", () => {
    const result = parseNgrokPublicUrl({
      endpoints: [{ url: "https://abc.ngrok-free.dev", public_url: "https://abc.ngrok-free.dev" }],
    });
    expect(result).toBe("https://abc.ngrok-free.dev");
  });

  it("extracts URL from tunnels format", () => {
    const result = parseNgrokPublicUrl({
      tunnels: [{ public_url: "https://xyz.ngrok-free.dev" }],
    });
    expect(result).toBe("https://xyz.ngrok-free.dev");
  });

  it("prefers https over http", () => {
    const result = parseNgrokPublicUrl({
      tunnels: [{ public_url: "http://abc.ngrok.io" }, { public_url: "https://abc.ngrok.io" }],
    });
    expect(result).toBe("https://abc.ngrok.io");
  });

  it("returns null when no endpoints or tunnels", () => {
    expect(parseNgrokPublicUrl({})).toBeNull();
  });

  it("returns null when endpoints array is empty", () => {
    expect(parseNgrokPublicUrl({ endpoints: [] })).toBeNull();
  });

  it("returns null when no records at all", () => {
    expect(parseNgrokPublicUrl({})).toBeNull();
  });

  it("handles non-array endpoints gracefully", () => {
    expect(parseNgrokPublicUrl({ endpoints: "invalid" })).toBeNull();
  });

  it("falls back to http when no https", () => {
    const result = parseNgrokPublicUrl({
      tunnels: [{ public_url: "http://abc.ngrok.io" }],
    });
    expect(result).toBe("http://abc.ngrok.io");
  });
});

describe("localTunnelTarget", () => {
  it("builds URL for 127.0.0.1", () => {
    expect(localTunnelTarget("127.0.0.1", 9000)).toBe("http://127.0.0.1:9000");
  });

  it("handles 0.0.0.0 by rewriting to 127.0.0.1", () => {
    expect(localTunnelTarget("0.0.0.0", 8080)).toBe("http://127.0.0.1:8080");
  });

  it("handles :: by rewriting to 127.0.0.1", () => {
    expect(localTunnelTarget("::", 3000)).toBe("http://127.0.0.1:3000");
  });

  it("wraps IPv6 in brackets", () => {
    expect(localTunnelTarget("::1", 9090)).toBe("http://[::1]:9090");
  });

  it("handles empty host as 127.0.0.1", () => {
    expect(localTunnelTarget("", 4000)).toBe("http://127.0.0.1:4000");
  });

  it("handles whitespace in host", () => {
    expect(localTunnelTarget("  0.0.0.0  ", 5000)).toBe("http://127.0.0.1:5000");
  });
});
