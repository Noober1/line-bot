import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  createSettingsStore,
  ISO_639_1,
  parseSettingKey,
  parseSettingValue,
  resolveSettings,
  settingsFor,
  type Settings,
} from "./settings";

const DEFAULTS: Settings = { translate: "en" };

function memoryStore(db = new Database(":memory:")) {
  return createSettingsStore(db, DEFAULTS);
}

describe("group settings", () => {
  test("the group value beats the LINE language", () => {
    expect(resolveSettings({}, DEFAULTS, "ja", { translate: "ko" }).translate).toBe("ko");
  });

  test("the user's value beats the group value", () => {
    expect(resolveSettings({ translate: "fr" }, DEFAULTS, "ja", { translate: "ko" }).translate).toBe("fr");
  });

  test("settingsFor passes the group settings into resolved", () => {
    const settings = settingsFor(memoryStore(), "U1", "ja", { translate: "ko" });
    expect(settings.resolved().translate).toBe("ko");
  });

  test("group_settings is its own table", () => {
    const db = new Database(":memory:");
    const users = createSettingsStore(db, DEFAULTS);
    const groups = createSettingsStore(db, DEFAULTS, "group_settings");
    users.set("C1", "translate", "ja");
    groups.set("C1", "translate", "ko");
    expect(users.stored("C1")).toEqual({ translate: "ja" });
    expect(groups.stored("C1")).toEqual({ translate: "ko" });
    expect(db.query("SELECT group_id FROM group_settings").all()).toHaveLength(1);
  });
});

describe("parseSettingKey", () => {
  test("accepts a known key, case-insensitive", () => {
    expect(parseSettingKey("translate")).toBe("translate");
    expect(parseSettingKey("TrAnSlAtE")).toBe("translate");
  });

  test("returns null for an unknown key", () => {
    expect(parseSettingKey("foo")).toBeNull();
    expect(parseSettingKey("")).toBeNull();
  });

  test("Object.prototype keys are unknown", () => {
    expect(parseSettingKey("constructor")).toBeNull();
    expect(parseSettingKey("__proto__")).toBeNull();
  });
});

describe("parseSettingValue", () => {
  test("translate accepts an ISO 639-1 code, lowercased and trimmed", () => {
    expect(parseSettingValue("translate", "ja")).toBe("ja");
    expect(parseSettingValue("translate", " JA ")).toBe("ja");
    expect(parseSettingValue("translate", "zh")).toBe("zh");
  });

  test("translate rejects anything that is not an ISO 639-1 code", () => {
    for (const value of ["", "xx", "jpn", "zh-Hant", "japanese", "in", "e n"]) {
      expect(parseSettingValue("translate", value)).toBeNull();
    }
  });

  test("the ISO 639-1 list has all 183 codes, two lowercase letters each", () => {
    expect(ISO_639_1.size).toBe(183);
    for (const code of ISO_639_1) expect(code).toMatch(/^[a-z]{2}$/);
  });
});

describe("resolveSettings", () => {
  test("uses the global default when nothing else is known", () => {
    expect(resolveSettings({}, DEFAULTS)).toEqual({ translate: "en" });
  });

  test("the user's LINE language beats the global default", () => {
    expect(resolveSettings({}, DEFAULTS, "ja")).toEqual({ translate: "ja" });
  });

  test("the user's own value beats the LINE language and the default", () => {
    expect(resolveSettings({ translate: "ko" }, DEFAULTS, "ja")).toEqual({ translate: "ko" });
  });

  test("a BCP 47 LINE language maps to its ISO 639-1 part", () => {
    expect(resolveSettings({}, DEFAULTS, "zh-Hant")).toEqual({ translate: "zh" });
    expect(resolveSettings({}, DEFAULTS, "pt-BR")).toEqual({ translate: "pt" });
  });

  test("an unusable LINE language falls back to the default", () => {
    for (const language of ["", "xx", "und", "-"]) {
      expect(resolveSettings({}, DEFAULTS, language)).toEqual({ translate: "en" });
    }
  });
});

describe("createSettingsStore", () => {
  test("a user with no values has nothing stored", () => {
    expect(memoryStore().stored("U1")).toEqual({});
  });

  test("set stores a value and set again overwrites it", () => {
    const store = memoryStore();
    store.set("U1", "translate", "ja");
    expect(store.stored("U1")).toEqual({ translate: "ja" });
    store.set("U1", "translate", "ko");
    expect(store.stored("U1")).toEqual({ translate: "ko" });
  });

  test("unset removes the value", () => {
    const store = memoryStore();
    store.set("U1", "translate", "ja");
    store.unset("U1", "translate");
    expect(store.stored("U1")).toEqual({});
  });

  test("values of different users are separate", () => {
    const store = memoryStore();
    store.set("U1", "translate", "ja");
    store.set("U2", "translate", "ko");
    store.unset("U2", "translate");
    expect(store.stored("U1")).toEqual({ translate: "ja" });
    expect(store.stored("U2")).toEqual({});
  });

  test("exposes the global defaults", () => {
    expect(memoryStore().defaults).toEqual(DEFAULTS);
  });

  test("skips stored rows with an unknown key or an invalid value", () => {
    const db = new Database(":memory:");
    const store = memoryStore(db);
    db.run("INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ('U1', 'old_key', 'x', 0)");
    db.run("INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ('U2', 'translate', 'xx', 0)");
    expect(store.stored("U1")).toEqual({});
    expect(store.stored("U2")).toEqual({});
  });

  test("a second store on the same database keeps existing rows", () => {
    const db = new Database(":memory:");
    memoryStore(db).set("U1", "translate", "ja");
    expect(memoryStore(db).stored("U1")).toEqual({ translate: "ja" });
  });
});

describe("settingsFor", () => {
  test("acts on one user only", () => {
    const store = memoryStore();
    const u1 = settingsFor(store, "U1");
    u1.set("translate", "ja");
    expect(u1.stored()).toEqual({ translate: "ja" });
    expect(store.stored("U2")).toEqual({});
    u1.unset("translate");
    expect(store.stored("U1")).toEqual({});
  });

  test("resolved applies user > LINE language > default", () => {
    const store = memoryStore();
    expect(settingsFor(store, "U1").resolved()).toEqual({ translate: "en" });
    expect(settingsFor(store, "U1", "ja").resolved()).toEqual({ translate: "ja" });
    store.set("U1", "translate", "ko");
    expect(settingsFor(store, "U1", "ja").resolved()).toEqual({ translate: "ko" });
  });
});
