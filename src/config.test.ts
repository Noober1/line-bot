import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const validEnv = {
  LINE_CHANNEL_SECRET: "secret",
  LINE_CHANNEL_ACCESS_TOKEN: "token",
};

describe("loadConfig", () => {
  test("returns config with default port when PORT is unset", () => {
    expect(loadConfig(validEnv)).toEqual({
      port: 3000,
      lineChannelSecret: "secret",
      lineChannelAccessToken: "token",
    });
  });

  test("uses PORT when set", () => {
    expect(loadConfig({ ...validEnv, PORT: "8080" }).port).toBe(8080);
  });

  test("throws listing every missing required key", () => {
    expect(() => loadConfig({})).toThrow(
      "Missing required env: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN",
    );
  });

  test("treats blank values as missing", () => {
    expect(() => loadConfig({ ...validEnv, LINE_CHANNEL_SECRET: "  " })).toThrow(
      "Missing required env: LINE_CHANNEL_SECRET",
    );
  });

  test("throws on non-numeric PORT", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "abc" })).toThrow("Invalid PORT: abc");
  });

  test("throws on out-of-range PORT", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "70000" })).toThrow("Invalid PORT: 70000");
  });

  test("error message never contains secret values", () => {
    expect(() => loadConfig({ LINE_CHANNEL_SECRET: "s3cr3t" })).toThrow(
      "Missing required env: LINE_CHANNEL_ACCESS_TOKEN",
    );
    try {
      loadConfig({ LINE_CHANNEL_SECRET: "s3cr3t" });
    } catch (error) {
      expect(String(error)).not.toContain("s3cr3t");
    }
  });
});
