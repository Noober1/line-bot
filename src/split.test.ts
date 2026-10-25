import { describe, expect, test } from "bun:test";
import { MAX_REPLY_MESSAGES, MAX_TEXT_LENGTH, replyMessages, splitReply } from "./split";

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

describe("replyMessages with mentions", () => {
  test("is one text v2 message with a mention substitution per user, quoting the user's message", () => {
    expect(replyMessages("hi {u1}", "q", { u1: "Uann" })).toEqual([
      { type: "textV2", text: "hi {u1}", quoteToken: "q", substitution: { u1: { type: "mention", mentionee: { type: "user", userId: "Uann" } } } },
    ]);
  });

  test("without a quote token there is no quoteToken field", () => {
    expect(replyMessages("hi {u1}", undefined, { u1: "Uann" })[0]).not.toHaveProperty("quoteToken");
  });
});

describe("replyMessages", () => {
  test("a short answer is one text message quoting the user's message", () => {
    expect(replyMessages("halo", "q")).toEqual([{ type: "text", text: "halo", quoteToken: "q" }]);
  });
  test("a split answer quotes only in the first message", () => {
    const messages = replyMessages("a".repeat(12_000), "q");
    expect(messages).toHaveLength(3);
    expect(messages[0]).toHaveProperty("quoteToken", "q");
    expect(messages[1]).not.toHaveProperty("quoteToken");
    expect(messages[2]).not.toHaveProperty("quoteToken");
  });
  test("without a quote token no message has one", () => {
    expect(replyMessages("halo")).toEqual([{ type: "text", text: "halo" }]);
    expect(replyMessages("halo")[0]).not.toHaveProperty("quoteToken");
  });
});
