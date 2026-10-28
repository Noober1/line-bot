import { describe, expect, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { MAX_MENTIONS, protectMentions, restoreMentions } from "./mentions";

type Mentionee = webhook.Mention["mentionees"][number];

function message(text: string, mentionees: Mentionee[] = []): webhook.TextMessageContent {
  return { type: "text", id: "m1", text, quoteToken: "q", mention: { mentionees } } as webhook.TextMessageContent;
}

const user = (index: number, length: number, userId?: string, isSelf = false): Mentionee =>
  ({ type: "user", index, length, userId, isSelf }) as Mentionee;

describe("protectMentions", () => {
  test("replaces each user mention with a placeholder, numbered in text order", () => {
    const shielded = protectMentions(message("hi @Ann and @Bob!", [user(12, 4, "Ubob"), user(3, 4, "Uann")]));
    expect(shielded.text).toBe("hi {u1} and {u2}!");
    expect(shielded.mentions).toEqual({ u1: "Uann", u2: "Ubob" });
    expect(shielded.labels).toEqual({ u1: "@Ann", u2: "@Bob" });
  });

  test("leaves the bot's own mention, @All and mentions without a user ID as text", () => {
    const all = { type: "all", index: 0, length: 4 } as Mentionee;
    const shielded = protectMentions(message("@All @Bot @Eve", [all, user(5, 4, "Ubot", true), user(10, 4)]));
    expect(shielded.text).toBe("@All @Bot @Eve");
    expect(shielded.mentions).toEqual({});
  });

  test("a message without mentions is unchanged", () => {
    expect(protectMentions({ ...message("halo"), mention: undefined }).text).toBe("halo");
  });

  test("mentions past MAX_MENTIONS stay as text", () => {
    const mentionees = Array.from({ length: MAX_MENTIONS + 1 }, (_, i) => user(i * 2, 2, `U${i}`));
    const shielded = protectMentions(message("@a".repeat(MAX_MENTIONS + 1), mentionees));
    expect(Object.keys(shielded.mentions)).toHaveLength(MAX_MENTIONS);
    expect(shielded.text).toEndWith("@a");
  });
});

describe("restoreMentions", () => {
  const shielded = protectMentions(message("hi @Ann and @Bob", [user(3, 4, "Uann"), user(12, 4, "Ubob")]));

  test("keeps the placeholders and returns the users they stand for", () => {
    expect(restoreMentions("hello {u1} and {u2}", shielded, 5000)).toEqual({
      text: "hello {u1} and {u2}",
      mentions: { u1: "Uann", u2: "Ubob" },
    });
  });

  test("returns only the mentions the answer still holds", () => {
    expect(restoreMentions("hello {u2}", shielded, 5000)).toEqual({ text: "hello {u2}", mentions: { u2: "Ubob" } });
  });

  test("a changed placeholder falls back to plain text with the typed names", () => {
    expect(restoreMentions("hello {u1} and {x9}", shielded, 5000)).toEqual({ text: "hello @Ann and {x9}" });
  });

  test("an answer over the limit falls back to plain text", () => {
    expect(restoreMentions("{u1} aaaa", shielded, 5)).toEqual({ text: "@Ann aaaa" });
  });

  test("an answer without placeholders is plain text", () => {
    expect(restoreMentions("hello", shielded, 5000)).toEqual({ text: "hello" });
  });
});
