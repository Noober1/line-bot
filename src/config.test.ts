import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const validEnv = {
  LINE_CHANNEL_SECRET: "secret",
  LINE_CHANNEL_ACCESS_TOKEN: "token",
  AI_MODEL: "combo-chat",
};

describe("loadConfig", () => {
  test("returns config with defaults when optional keys are unset", () => {
    expect(loadConfig(validEnv)).toEqual({
      port: 3000,
      lineChannelSecret: "secret",
      lineChannelAccessToken: "token",
      ownerUserId: undefined,
      maxGroupsPerUser: 3,
      databasePath: "bot.sqlite",
      ai: { baseUrl: "http://localhost:20128/v1", apiKey: undefined, model: "combo-chat" },
      defaultSettings: { translate: "en" },
      defaultLocale: "id",
      rateLimitPerMinute: 10,
      warnings: [],
    });
  });

  test("a removed allowlist key that is still set gives a warning naming it", () => {
    expect(loadConfig({ ...validEnv, ALLOWED_USER_IDS: "U1" }).warnings).toEqual([
      expect.stringContaining("ALLOWED_USER_IDS"),
    ]);
    expect(loadConfig({ ...validEnv, ALLOWED_GROUP_IDS: "C1" }).warnings).toEqual([
      expect.stringContaining("ALLOWED_GROUP_IDS"),
    ]);
  });

  test("blank removed allowlist keys give no warning", () => {
    expect(loadConfig({ ...validEnv, ALLOWED_USER_IDS: "  ", ALLOWED_GROUP_IDS: "" }).warnings).toEqual([]);
  });

  test("uses OWNER_USER_ID when valid, trimmed; blank means none", () => {
    const id = `U${"a".repeat(32)}`;
    expect(loadConfig({ ...validEnv, OWNER_USER_ID: ` ${id} ` }).ownerUserId).toBe(id);
    expect(loadConfig({ ...validEnv, OWNER_USER_ID: "  " }).ownerUserId).toBeUndefined();
  });

  test("throws on an OWNER_USER_ID that is not a LINE user ID", () => {
    for (const value of ["Uabc", `U${"A".repeat(32)}`, `C${"a".repeat(32)}`]) {
      expect(() => loadConfig({ ...validEnv, OWNER_USER_ID: value })).toThrow(`Invalid OWNER_USER_ID: ${value}`);
    }
  });

  test("uses MAX_GROUPS_PER_USER when set; blank falls back to 3", () => {
    expect(loadConfig({ ...validEnv, MAX_GROUPS_PER_USER: "5" }).maxGroupsPerUser).toBe(5);
    expect(loadConfig({ ...validEnv, MAX_GROUPS_PER_USER: "  " }).maxGroupsPerUser).toBe(3);
  });

  test("throws on a MAX_GROUPS_PER_USER that is not a whole number above 0", () => {
    for (const value of ["0", "-1", "1.5", "abc"]) {
      expect(() => loadConfig({ ...validEnv, MAX_GROUPS_PER_USER: value })).toThrow(
        `Invalid MAX_GROUPS_PER_USER: ${value}`,
      );
    }
  });

  test("uses PORT when set", () => {
    expect(loadConfig({ ...validEnv, PORT: "8080" }).port).toBe(8080);
  });

  test("uses DATABASE_PATH when set", () => {
    expect(loadConfig({ ...validEnv, DATABASE_PATH: " data/chat.sqlite " }).databasePath).toBe("data/chat.sqlite");
  });

  test("blank DATABASE_PATH falls back to the default", () => {
    expect(loadConfig({ ...validEnv, DATABASE_PATH: "  " }).databasePath).toBe("bot.sqlite");
  });

  test("uses AI_BASE_URL, AI_API_KEY and AI_MODEL when set, trimmed", () => {
    const { ai } = loadConfig({
      ...validEnv,
      AI_BASE_URL: " http://10.0.0.5:20128/v1 ",
      AI_API_KEY: " k-123 ",
      AI_MODEL: " cc/claude-opus-4-7 ",
    });
    expect(ai).toEqual({ baseUrl: "http://10.0.0.5:20128/v1", apiKey: "k-123", model: "cc/claude-opus-4-7" });
  });

  test("blank AI_BASE_URL and AI_API_KEY fall back to the default and no key", () => {
    const { ai } = loadConfig({ ...validEnv, AI_BASE_URL: "  ", AI_API_KEY: "  " });
    expect(ai.baseUrl).toBe("http://localhost:20128/v1");
    expect(ai.apiKey).toBeUndefined();
  });

  test("throws when AI_MODEL is blank", () => {
    expect(() => loadConfig({ ...validEnv, AI_MODEL: " " })).toThrow("Missing required env: AI_MODEL");
  });

  test("uses DEFAULT_TRANSLATE_LANG when set, trimmed and lowercased", () => {
    expect(loadConfig({ ...validEnv, DEFAULT_TRANSLATE_LANG: " JA " }).defaultSettings).toEqual({ translate: "ja" });
  });

  test("blank DEFAULT_TRANSLATE_LANG falls back to en", () => {
    expect(loadConfig({ ...validEnv, DEFAULT_TRANSLATE_LANG: "  " }).defaultSettings).toEqual({ translate: "en" });
  });

  test("throws on a DEFAULT_TRANSLATE_LANG that is not an ISO 639-1 code", () => {
    for (const value of ["xx", "zh-Hant", "japanese"]) {
      expect(() => loadConfig({ ...validEnv, DEFAULT_TRANSLATE_LANG: value })).toThrow(
        `Invalid DEFAULT_TRANSLATE_LANG: ${value} (use an ISO 639-1 code)`,
      );
    }
  });

  test("uses DEFAULT_REPLY_LANG when set, matching case-insensitively", () => {
    expect(loadConfig({ ...validEnv, DEFAULT_REPLY_LANG: " zh-hant " }).defaultLocale).toBe("zh-Hant");
    expect(loadConfig({ ...validEnv, DEFAULT_REPLY_LANG: "EN" }).defaultLocale).toBe("en");
  });

  test("blank DEFAULT_REPLY_LANG falls back to id", () => {
    expect(loadConfig({ ...validEnv, DEFAULT_REPLY_LANG: "  " }).defaultLocale).toBe("id");
  });

  test("throws on a DEFAULT_REPLY_LANG the bot has no texts for", () => {
    for (const value of ["ko", "zh", "ja-JP"]) {
      expect(() => loadConfig({ ...validEnv, DEFAULT_REPLY_LANG: value })).toThrow(
        `Invalid DEFAULT_REPLY_LANG: ${value} (use one of: id, en, ja, zh-Hans, zh-Hant)`,
      );
    }
  });

  test("throws listing every missing required key", () => {
    expect(() => loadConfig({})).toThrow(
      "Missing required env: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, AI_MODEL",
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

  test("uses RATE_LIMIT_PER_MINUTE when set; 0 turns the limit off; blank falls back to 10", () => {
    expect(loadConfig({ ...validEnv, RATE_LIMIT_PER_MINUTE: " 30 " }).rateLimitPerMinute).toBe(30);
    expect(loadConfig({ ...validEnv, RATE_LIMIT_PER_MINUTE: "0" }).rateLimitPerMinute).toBe(0);
    expect(loadConfig({ ...validEnv, RATE_LIMIT_PER_MINUTE: "  " }).rateLimitPerMinute).toBe(10);
  });

  test("throws on a RATE_LIMIT_PER_MINUTE that is not a whole number >= 0", () => {
    for (const value of ["-1", "1.5", "abc"]) {
      expect(() => loadConfig({ ...validEnv, RATE_LIMIT_PER_MINUTE: value })).toThrow(
        `Invalid RATE_LIMIT_PER_MINUTE: ${value} (use a whole number, 0 = no limit)`,
      );
    }
  });
});
