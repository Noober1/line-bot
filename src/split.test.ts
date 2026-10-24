import { describe, expect, test } from "bun:test";
import { MAX_REPLY_MESSAGES, MAX_TEXT_LENGTH, splitReply } from "./split";

describe("splitReply", () => {
  test("a short text is one part, unchanged", () => {
    expect(splitReply("halo\n\napa kabar")).toEqual(["halo\n\napa kabar"]);
  });
  test("a text of exactly the limit is one part", () => {
    expect(splitReply("a".repeat(MAX_TEXT_LENGTH))).toEqual(["a".repeat(MAX_TEXT_LENGTH)]);
  });
  test("splits at a blank line first", () => {
    expect(splitReply("one two\n\nthree four", 12)).toEqual(["one two", "three four"]);
  });
  test("then at a line break, a sentence end, a space", () => {
    expect(splitReply("aaaa bb\ncccc", 10)).toEqual(["aaaa bb", "cccc"]);
    expect(splitReply("aaaaaa. bbbbbb", 10)).toEqual(["aaaaaa.", "bbbbbb"]);
    expect(splitReply("あいう。えおか", 5)).toEqual(["あいう。", "えおか"]);
    expect(splitReply("aaaaaa bbbb", 10)).toEqual(["aaaaaa", "bbbb"]);
  });
  test("hard-cuts a text without breaks", () => {
    expect(splitReply("a".repeat(12_000))).toEqual(["a".repeat(5000), "a".repeat(5000), "a".repeat(2000)]);
  });
  test("never cuts an emoji in half", () => {
    expect(splitReply("abcd😀", 5)).toEqual(["abcd", "😀"]);
  });
  test("keeps at most 5 parts and marks the cut with …", () => {
    const parts = splitReply("a".repeat(30_000));
    expect(parts).toHaveLength(MAX_REPLY_MESSAGES);
    expect(parts.at(-1)).toEndWith("…");
    expect(parts.every((p) => p.length <= MAX_TEXT_LENGTH)).toBe(true);
  });
  test("every part fits and no text is lost", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Kalimat nomor ${i} cukup panjang.`).join(" ");
    const parts = splitReply(text, 500, 100);
    expect(parts.every((p) => p.length <= 500)).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });
});
