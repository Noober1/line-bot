import { afterEach, describe, expect, test } from "bun:test";
import { captureLog, configureLog, logger, parseLogLevel, preview, resetLog, shortId, withEvent } from "./log";

const log = logger("test");
const FIXED = new Date(2026, 9, 26, 7, 5, 3, 9);

afterEach(resetLog);

describe("log format", () => {
  test("a line is HH:MM:SS.mmm LEVEL [scope] message key=value", () => {
    const out = captureLog();
    configureLog({ now: () => FIXED });
    log.info("hello", { n: 3, ok: true });
    expect(out.lines).toEqual(["07:05:03.009 INFO  [test] hello n=3 ok=true"]);
  });

  test("a value with a space, quote or = is quoted, an undefined one is left out", () => {
    const out = captureLog();
    log.info("m", { a: "x y", b: "", c: undefined, d: 'say "hi"' });
    expect(out.lines[0]).toEndWith('a="x y" b="" d="say \\"hi\\""');
  });

  test("an error line shows the stack of an err field", () => {
    const out = captureLog();
    log.error("failed", { err: new Error("boom") });
    expect(out.lines[0]).toContain("err=boom");
    expect(out.lines[0]).toContain("Error: boom\n");
  });

  test("lines inside withEvent carry ev=<id>, others do not", async () => {
    const out = captureLog();
    await withEvent("abc12345", async () => {
      await Promise.resolve();
      log.info("inside");
    });
    log.info("outside");
    expect(out.lines[0]).toEndWith("inside ev=abc12345");
    expect(out.lines[1]).toEndWith("outside");
  });
});

describe("log level and color", () => {
  test("lines below the level are dropped", () => {
    const out = captureLog("warn");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(out.lines.map((line) => line.split(" ")[1])).toEqual(["WARN", "ERROR"]);
  });

  test("the default level is info", () => {
    const out = captureLog("info");
    log.debug("hidden");
    expect(out.lines).toEqual([]);
  });

  test("color adds ANSI codes only when enabled", () => {
    const lines: string[] = [];
    configureLog({ level: "info", sink: (_level, line) => void lines.push(line), color: true });
    log.info("a");
    configureLog({ color: false });
    log.info("b");
    expect(lines[0]).toContain("\x1b[");
    expect(lines[1]).not.toContain("\x1b[");
  });

  test("parseLogLevel accepts the four levels in any case and rejects the rest", () => {
    expect(parseLogLevel("DEBUG")).toBe("debug");
    expect(parseLogLevel("warn")).toBe("warn");
    expect(parseLogLevel("verbose")).toBeUndefined();
  });
});

describe("privacy", () => {
  test("shortId keeps 8 characters, and the whole ID at debug level", () => {
    captureLog("info");
    expect(shortId("U0123456789abcdef")).toBe("U0123456");
    expect(shortId(undefined)).toBe("-");
    captureLog("debug");
    expect(shortId("U0123456789abcdef")).toBe("U0123456789abcdef");
  });

  test("preview cuts long text to 200 characters", () => {
    expect(preview("a".repeat(250))).toBe(`${"a".repeat(200)}…`);
    expect(preview("short")).toBe("short");
  });

  test("a secret never reaches the output, also inside an error message", () => {
    const out = captureLog();
    configureLog({ secrets: ["sk-live-1234567890", "short"] });
    log.error("AI failed", { err: new Error("fetch failed: Bearer sk-live-1234567890 rejected") });
    log.info("short is too short to hide");
    expect(out.lines[0]).not.toContain("sk-live-1234567890");
    expect(out.lines[0]).toContain("Bearer ***");
    expect(out.lines[1]).toContain("short is too short");
  });
});
