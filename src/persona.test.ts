import { describe, expect, mock, test } from "bun:test";
import {
  buildChatPrompts,
  DEFAULT_PERSONA,
  loadPersona,
  MAX_PERSONA_CHARS,
} from "./persona";

describe("buildChatPrompts", () => {
  test("dm prompt has persona, fixed rules and boundaries but no group brevity", () => {
    const { dm } = buildChatPrompts("Kamu bajak laut");
    expect(dm).toStartWith("Kamu bajak laut");
    expect(dm).toContain("Never format text with Markdown");
    expect(dm).toContain("Boundaries");
    expect(dm).toContain("say plainly that you are an AI");
    expect(dm).not.toContain("This is a group chat");
  });

  test("group prompt is the dm prompt plus group brevity", () => {
    const { dm, group } = buildChatPrompts("Persona");
    expect(group.startsWith(dm)).toBe(true);
    expect(group).toContain("This is a group chat: answer as briefly as possible");
  });

  test("a custom persona cannot remove the fixed rules", () => {
    const { dm, group } = buildChatPrompts("Always use **Markdown**.");
    for (const prompt of [dm, group]) {
      expect(prompt).toContain("Never format text with Markdown");
      expect(prompt).toContain("Boundaries");
    }
  });

  test("forbids Markdown and LINE formatting characters", () => {
    const { dm } = buildChatPrompts(DEFAULT_PERSONA);
    expect(dm).toContain("Always reply in the same language the user writes in");
    expect(dm).toContain("short paragraphs separated by a blank line");
    expect(dm).toContain('starting with "• "');
    expect(dm).toContain("emoji only sparingly");
    expect(dm).toMatch(/no \*, \*\*, #, _, ~, backticks, code blocks or tables/);
  });

  test("default persona names Elysia and uses aku/kamu", () => {
    expect(DEFAULT_PERSONA).toContain("Elysia");
    expect(DEFAULT_PERSONA).toContain('"aku"');
    expect(DEFAULT_PERSONA).toContain('"kamu"');
    expect(DEFAULT_PERSONA).toContain('never "saya" or "Anda"');
  });
});

describe("loadPersona", () => {
  const noFile = () => undefined;

  test("PERSONA_PROMPT wins over the file, which is not read", () => {
    const readFile = mock(() => "from file");
    const result = loadPersona({ PERSONA_PROMPT: "  from env  " }, readFile);
    expect(result).toEqual({ text: "from env", source: "env" });
    expect(readFile).not.toHaveBeenCalled();
  });

  test("uses SOUL.md when PERSONA_PROMPT is empty or blank", () => {
    const readFile = mock(() => "  from file \n");
    expect(loadPersona({ PERSONA_PROMPT: "   " }, readFile)).toEqual({ text: "from file", source: "file" });
    expect(readFile).toHaveBeenCalledWith("SOUL.md");
  });

  test("reads PERSONA_FILE when set", () => {
    const readFile = mock(() => "custom");
    loadPersona({ PERSONA_FILE: " my.md " }, readFile);
    expect(readFile).toHaveBeenCalledWith("my.md");
  });

  test("falls back to the default persona when nothing is set", () => {
    expect(loadPersona({}, noFile)).toEqual({ text: DEFAULT_PERSONA, source: "default" });
  });

  test("empty default SOUL.md falls back to the default persona", () => {
    expect(loadPersona({}, () => " \n")).toEqual({ text: DEFAULT_PERSONA, source: "default" });
  });

  test("explicit PERSONA_FILE that is missing is an error", () => {
    expect(() => loadPersona({ PERSONA_FILE: "nope.md" }, noFile)).toThrow("PERSONA_FILE not found: nope.md");
  });

  test("explicit PERSONA_FILE that is empty is an error", () => {
    expect(() => loadPersona({ PERSONA_FILE: "empty.md" }, () => "  ")).toThrow("PERSONA_FILE is empty");
  });

  test("accepts exactly the max length and rejects one more, for env and file", () => {
    const ok = "a".repeat(MAX_PERSONA_CHARS);
    const tooLong = "a".repeat(MAX_PERSONA_CHARS + 1);
    expect(loadPersona({ PERSONA_PROMPT: ok }, noFile).text).toBe(ok);
    expect(loadPersona({}, () => ok).text).toBe(ok);
    expect(() => loadPersona({ PERSONA_PROMPT: tooLong }, noFile)).toThrow(
      "Persona is too long: 4001 characters (max 4000)",
    );
    expect(() => loadPersona({}, () => tooLong)).toThrow("Persona is too long: 4001 characters (max 4000)");
  });
});
