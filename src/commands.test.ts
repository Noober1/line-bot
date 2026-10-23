import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { parseCommand, runCommand, type CommandContext } from "./commands";
import { createSettingsStore, settingsFor, type SettingsStore } from "./settings";

const noopContext: CommandContext = { resetHistory: () => {}, settings: null };

describe("parseCommand", () => {
  test("returns null for plain text", () => {
    expect(parseCommand("halo")).toBeNull();
  });

  test("returns null for an empty string", () => {
    expect(parseCommand("")).toBeNull();
  });

  test("returns null when the slash is not at the start", () => {
    expect(parseCommand("halo /ping")).toBeNull();
  });

  test("parses a command without args", () => {
    expect(parseCommand("/ping")).toEqual({ name: "ping", args: "" });
  });

  test("lowercases the command name", () => {
    expect(parseCommand("/PiNg")).toEqual({ name: "ping", args: "" });
  });

  test("splits args after the first whitespace and keeps their case", () => {
    expect(parseCommand("/translate Halo Dunia")).toEqual({ name: "translate", args: "Halo Dunia" });
  });

  test("ignores whitespace around the message", () => {
    expect(parseCommand("  /ping  ")).toEqual({ name: "ping", args: "" });
  });

  test("keeps newlines inside args", () => {
    expect(parseCommand("/translate baris satu\nbaris dua")).toEqual({
      name: "translate",
      args: "baris satu\nbaris dua",
    });
  });

  test("a lone slash is a command with an empty name", () => {
    expect(parseCommand("/")).toEqual({ name: "", args: "" });
  });
});

describe("runCommand", () => {
  test("/ping replies pong", () => {
    expect(runCommand({ name: "ping", args: "" }, noopContext)).toBe("pong");
  });

  test("ignores args of commands that take none", () => {
    expect(runCommand({ name: "ping", args: "abc" }, noopContext)).toBe("pong");
  });

  test("/help lists every command", () => {
    expect(runCommand({ name: "help", args: "" }, noopContext)).toBe(
      [
        "Daftar perintah:",
        "/help - tampilkan daftar perintah",
        "/ping - cek apakah bot aktif",
        "/reset - hapus riwayat chat",
        "/config - lihat atau ubah pengaturan kamu",
      ].join("\n"),
    );
  });

  test("/reset clears the history and confirms", () => {
    const resetHistory = mock(() => {});
    expect(runCommand({ name: "reset", args: "" }, { resetHistory, settings: null })).toBe("Riwayat chat sudah dihapus.");
    expect(resetHistory).toHaveBeenCalledTimes(1);
  });

  test("other commands do not touch the history", () => {
    const resetHistory = mock(() => {});
    runCommand({ name: "ping", args: "" }, { resetHistory, settings: null });
    runCommand({ name: "help", args: "" }, { resetHistory, settings: null });
    runCommand({ name: "foo", args: "" }, { resetHistory, settings: null });
    expect(resetHistory).not.toHaveBeenCalled();
  });

  test("unknown command gets a friendly error", () => {
    expect(runCommand({ name: "foo", args: "" }, noopContext)).toBe(
      "Perintah /foo tidak dikenal. Ketik /help untuk daftar perintah.",
    );
  });

  test("Object.prototype keys are unknown commands", () => {
    expect(runCommand({ name: "constructor", args: "" }, noopContext)).toBe(
      "Perintah /constructor tidak dikenal. Ketik /help untuk daftar perintah.",
    );
    expect(runCommand({ name: "__proto__", args: "" }, noopContext)).toBe(
      "Perintah /__proto__ tidak dikenal. Ketik /help untuk daftar perintah.",
    );
  });

  test("a long unknown name is cut to 32 characters", () => {
    const reply = runCommand({ name: "a".repeat(100), args: "" }, noopContext);
    expect(reply).toBe(`Perintah /${"a".repeat(32)}… tidak dikenal. Ketik /help untuk daftar perintah.`);
  });
});

describe("/config", () => {
  let store: SettingsStore;

  beforeEach(() => {
    store = createSettingsStore(new Database(":memory:"), { translate: "en" });
  });

  function config(args: string, userId = "U1", lineLanguage?: string): string {
    const settings = settingsFor(store, userId, lineLanguage);
    return runCommand({ name: "config", args }, { resetHistory: () => {}, settings });
  }

  test("without args lists the settings, marking defaults", () => {
    expect(config("")).toBe(
      [
        "Pengaturan kamu:",
        "translate = en (bawaan) - bahasa tujuan /translate",
        "  nilai: kode bahasa ISO 639-1, mis. en, id, ja, ko, zh",
        "Ubah: /config <nama> <nilai>",
        "Kembali ke bawaan: /config <nama> reset",
      ].join("\n"),
    );
  });

  test("the list shows the user's own value without the default mark", () => {
    store.set("U1", "translate", "ja");
    expect(config("")).toContain("translate = ja - bahasa tujuan /translate");
  });

  test("the list shows the LINE language as the default when known", () => {
    expect(config("", "U1", "ko-KR")).toContain("translate = ko (bawaan)");
  });

  test("sets a value, normalizing its case, and confirms", () => {
    expect(config("translate JA")).toBe("translate diubah ke ja.");
    expect(store.stored("U1")).toEqual({ translate: "ja" });
  });

  test("the setting name is case-insensitive and extra spaces are ignored", () => {
    expect(config("  TRANSLATE   ko  ")).toBe("translate diubah ke ko.");
    expect(store.stored("U1")).toEqual({ translate: "ko" });
  });

  test("reset removes the user's value and shows the default", () => {
    store.set("U1", "translate", "ja");
    expect(config("translate reset")).toBe("translate kembali ke bawaan: en.");
    expect(store.stored("U1")).toEqual({});
  });

  test("reset is case-insensitive", () => {
    store.set("U1", "translate", "ja");
    expect(config("translate RESET")).toBe("translate kembali ke bawaan: en.");
    expect(store.stored("U1")).toEqual({});
  });

  test("an invalid value is rejected and nothing is stored", () => {
    expect(config("translate xx")).toBe(
      "Nilai xx tidak valid untuk translate. Pakai kode bahasa ISO 639-1, mis. en, id, ja, ko, zh.",
    );
    expect(config("translate ja en")).toStartWith("Nilai ja en tidak valid");
    expect(store.stored("U1")).toEqual({});
  });

  test("a long invalid value is cut to 32 characters", () => {
    expect(config(`translate ${"x".repeat(100)}`)).toStartWith(`Nilai ${"x".repeat(32)}… tidak valid`);
  });

  test("a name without a value shows the usage", () => {
    expect(config("translate")).toBe(
      "Pakai: /config translate <nilai>. Nilai: kode bahasa ISO 639-1, mis. en, id, ja, ko, zh.",
    );
  });

  test("an unknown setting is rejected", () => {
    expect(config("foo ja")).toBe("Pengaturan foo tidak dikenal. Ketik /config untuk daftar pengaturan.");
    expect(config("constructor ja")).toStartWith("Pengaturan constructor tidak dikenal.");
    expect(store.stored("U1")).toEqual({});
  });

  test("changes only the sender's settings", () => {
    config("translate ja", "U1");
    expect(store.stored("U2")).toEqual({});
    expect(config("", "U2")).toContain("translate = en (bawaan)");
  });

  test("without a user ID it explains that settings are unavailable", () => {
    expect(runCommand({ name: "config", args: "translate ja" }, noopContext)).toBe(
      "Pengaturan tidak bisa dipakai: LINE tidak mengirim ID kamu.",
    );
  });
});
