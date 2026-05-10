import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import {
  setVerbose,
  log,
  logInfo,
  logWarn,
  logError,
  logSuccess,
  logVerbose,
  logJson,
  createSpinner,
  boxChar,
} from "../logging.js";

describe("logging", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setVerbose(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("setVerbose / logVerbose", () => {
    it("does not log when verbose is false", () => {
      setVerbose(false);
      logVerbose("secret");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("logs when verbose is true", () => {
      setVerbose(true);
      logVerbose("debug info");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const call = logSpy.mock.calls[0] as unknown[];
      const msg = String(call[0]);
      expect(msg).toContain("debug info");
    });
  });

  describe("logJson", () => {
    it("does not log when verbose is false", () => {
      setVerbose(false);
      logJson("config", { port: 8080 });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("logs label and formatted JSON when verbose is true", () => {
      setVerbose(true);
      logJson("config", { port: 8080, host: "localhost" });
      expect(logSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("log", () => {
    it("calls console.log with prefix", () => {
      log("test message");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("logInfo", () => {
    it("calls console.log with info prefix", () => {
      logInfo("information");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("logWarn", () => {
    it("calls console.log with warn prefix", () => {
      logWarn("warning");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("logError", () => {
    it("calls console.error with error prefix", () => {
      logError("failure");
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("logSuccess", () => {
    it("calls console.log with success prefix", () => {
      logSuccess("done");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("createSpinner", () => {
    it("returns an ora spinner instance", () => {
      const spinner = createSpinner("loading...");
      expect(spinner).toBeDefined();
      expect(typeof spinner.start).toBe("function");
      expect(typeof spinner.stop).toBe("function");
      expect(typeof spinner.succeed).toBe("function");
      expect(typeof spinner.fail).toBe("function");
    });
  });

  describe("boxChar", () => {
    it("has all box-drawing characters", () => {
      expect(boxChar.topLeft).toBeDefined();
      expect(boxChar.topRight).toBeDefined();
      expect(boxChar.bottomLeft).toBeDefined();
      expect(boxChar.bottomRight).toBeDefined();
      expect(boxChar.horizontal).toBeDefined();
      expect(boxChar.vertical).toBeDefined();
      expect(boxChar.tee).toBeDefined();
      expect(boxChar.bottomTee).toBeDefined();
    });
  });
});
