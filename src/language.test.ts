import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createLineLanguage, LINE_LANGUAGE_TTL_MS, localeFromLine, parseLocale } from "./language";

describe("localeFromLine", () => {
  test("maps supported LINE languages, ignoring case and region", () => {
    expect(localeFromLine("ja")).toBe("ja");
    expect(localeFromLine("ja-JP")).toBe("ja");
    expect(localeFromLine("id")).toBe("id");
    expect(localeFromLine("en-US")).toBe("en");
    expect(localeFromLine("EN")).toBe("en");
  });

  test("Chinese with a Traditional script or region is zh-Hant", () => {
    for (const tag of ["zh-Hant", "zh-hant", "zh-TW", "zh-HK", "zh-MO", "zh-Hant-TW"]) {
      expect(localeFromLine(tag)).toBe("zh-Hant");
    }
  });

  test("other Chinese is zh-Hans", () => {
    for (const tag of ["zh-Hans", "zh-CN", "zh-SG", "zh"]) {
      expect(localeFromLine(tag)).toBe("zh-Hans");
    }
  });

  test("a Simplified script wins over a Traditional region", () => {
    expect(localeFromLine("zh-Hans-HK")).toBe("zh-Hans");
    expect(localeFromLine("zh-Hans-TW")).toBe("zh-Hans");
  });

  test("unsupported or missing languages give null", () => {
    expect(localeFromLine("ko")).toBeNull();
    expect(localeFromLine("th-TH")).toBeNull();
    expect(localeFromLine("")).toBeNull();
    expect(localeFromLine(undefined)).toBeNull();
  });
});

describe("parseLocale", () => {
  test("accepts every locale, case-insensitive and trimmed", () => {
    expect(parseLocale("id")).toBe("id");
    expect(parseLocale(" JA ")).toBe("ja");
    expect(parseLocale("zh-hans")).toBe("zh-Hans");
    expect(parseLocale("ZH-HANT")).toBe("zh-Hant");
  });

  test("rejects anything else", () => {
    for (const value of ["", "zh", "ko", "ja-JP", "zh-TW"]) {
      expect(parseLocale(value)).toBeNull();
    }
  });
});

describe("createLineLanguage", () => {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  let db: Database;
  let time: number;
  const now = () => time;

  beforeEach(() => {
    logSpy.mockClear();
    errorSpy.mockClear();
    db = new Database(":memory:");
    time = 1_000_000;
  });

  afterAll(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function answering(language: string | undefined) {
    return mock(async (_userId: string) => language);
  }

  function failing() {
    return mock(async (_userId: string): Promise<string | undefined> => {
      throw new Error("404 - Not Found");
    });
  }

  test("fetches the language once and then serves it from the cache", async () => {
    const fetchLanguage = answering("ja");
    const lineLanguage = createLineLanguage(db, fetchLanguage, LINE_LANGUAGE_TTL_MS, now);
    expect(await lineLanguage("U1")).toBe("ja");
    expect(await lineLanguage("U1")).toBe("ja");
    expect(fetchLanguage).toHaveBeenCalledTimes(1);
    expect(fetchLanguage).toHaveBeenCalledWith("U1");
  });

  test("logs the raw LINE value of a fresh fetch", async () => {
    await createLineLanguage(db, answering("zh-Hant"), LINE_LANGUAGE_TTL_MS, now)("U1");
    expect(logSpy).toHaveBeenCalledWith("LINE language of user U1: zh-Hant");
  });

  test("caches per user", async () => {
    const fetchLanguage = mock(async (userId: string) => (userId === "U1" ? "ja" : "en"));
    const lineLanguage = createLineLanguage(db, fetchLanguage, LINE_LANGUAGE_TTL_MS, now);
    expect(await lineLanguage("U1")).toBe("ja");
    expect(await lineLanguage("U2")).toBe("en");
    expect(await lineLanguage("U1")).toBe("ja");
    expect(fetchLanguage).toHaveBeenCalledTimes(2);
  });

  test("the cache survives a new instance on the same database", async () => {
    await createLineLanguage(db, answering("ja"), LINE_LANGUAGE_TTL_MS, now)("U1");
    const fetchLanguage = answering("en");
    expect(await createLineLanguage(db, fetchLanguage, LINE_LANGUAGE_TTL_MS, now)("U1")).toBe("ja");
    expect(fetchLanguage).not.toHaveBeenCalled();
  });

  test("fetches again once the TTL has passed", async () => {
    const answers = ["ja", "en"];
    const fetchLanguage = mock(async (_userId: string) => answers.shift());
    const lineLanguage = createLineLanguage(db, fetchLanguage, 1000, now);
    expect(await lineLanguage("U1")).toBe("ja");
    time += 999;
    expect(await lineLanguage("U1")).toBe("ja");
    time += 1;
    expect(await lineLanguage("U1")).toBe("en");
    expect(fetchLanguage).toHaveBeenCalledTimes(2);
  });

  test("a profile without a language is cached as unknown", async () => {
    const fetchLanguage = answering(undefined);
    const lineLanguage = createLineLanguage(db, fetchLanguage, LINE_LANGUAGE_TTL_MS, now);
    expect(await lineLanguage("U1")).toBeUndefined();
    expect(await lineLanguage("U1")).toBeUndefined();
    expect(fetchLanguage).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("LINE language of user U1: (none)");
  });

  test("a failed fetch gives undefined, is logged, and is not cached", async () => {
    const fetchLanguage = failing();
    const lineLanguage = createLineLanguage(db, fetchLanguage, LINE_LANGUAGE_TTL_MS, now);
    expect(await lineLanguage("U1")).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("Get profile failed for user U1: 404 - Not Found");
    await lineLanguage("U1");
    expect(fetchLanguage).toHaveBeenCalledTimes(2);
  });

  test("a failed refetch keeps using the expired value", async () => {
    await createLineLanguage(db, answering("ja"), 1000, now)("U1");
    time += 5000;
    expect(await createLineLanguage(db, failing(), 1000, now)("U1")).toBe("ja");
  });
});
