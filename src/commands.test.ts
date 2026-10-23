import { describe, expect, mock, test } from "bun:test";
import { parseCommand, runCommand, type CommandContext } from "./commands";

const noopContext: CommandContext = { resetHistory: () => {} };

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
      ].join("\n"),
    );
  });

  test("/reset clears the history and confirms", () => {
    const resetHistory = mock(() => {});
    expect(runCommand({ name: "reset", args: "" }, { resetHistory })).toBe("Riwayat chat sudah dihapus.");
    expect(resetHistory).toHaveBeenCalledTimes(1);
  });

  test("other commands do not touch the history", () => {
    const resetHistory = mock(() => {});
    runCommand({ name: "ping", args: "" }, { resetHistory });
    runCommand({ name: "help", args: "" }, { resetHistory });
    runCommand({ name: "foo", args: "" }, { resetHistory });
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
