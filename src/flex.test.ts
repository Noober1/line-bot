import { describe, expect, test } from "bun:test";
import { flexMessage, MAX_ALT_TEXT, MAX_FLEX_BYTES, MAX_QUICK_LABEL, MAX_QUICK_REPLIES, quickReply, translateLanguageOptions } from "./flex";

describe("flexMessage card", () => {
  const text = "Daftar perintah:\n/help - bantuan\n/ping - cek bot";

  test("the first line is the title and each other line a row", () => {
    const message = flexMessage(text, "card")!;
    expect(message.type).toBe("flex");
    const bubble = message.contents as { header: { contents: { text: string }[] }; body: { contents: { text: string; wrap: boolean }[] } };
    expect(bubble.header.contents[0]!.text).toBe("Daftar perintah:");
    expect(bubble.body.contents.map((row) => row.text)).toEqual(["/help - bantuan", "/ping - cek bot"]);
    expect(bubble.body.contents.every((row) => row.wrap)).toBe(true);
  });

  test("altText is the whole text, so a quote or notification still reads", () => {
    expect(flexMessage(text, "card")!.altText).toBe(text);
  });

  test("altText is cut to LINE's limit with an ellipsis, not through an emoji", () => {
    const long = `Judul\n${"😀".repeat(500)}`;
    const alt = flexMessage(long, "card")!.altText;
    expect(alt.length).toBeLessThanOrEqual(MAX_ALT_TEXT);
    expect(alt).toEndWith("…");
    expect(alt.slice(-2, -1).charCodeAt(0)).not.toBeLessThan(0xdc00);
  });

  test("a text with only a title, or an empty one, is not a card", () => {
    expect(flexMessage("Cuma judul", "card")).toBeUndefined();
    expect(flexMessage("", "card")).toBeUndefined();
    expect(flexMessage("Judul\n\n  \n", "card")).toBeUndefined();
  });

  test("a card over MAX_FLEX_BYTES is not built, so the text goes out instead", () => {
    const rows = Array.from({ length: 400 }, (_, i) => `baris ${i} ${"x".repeat(80)}`).join("\n");
    expect(Buffer.byteLength(rows)).toBeGreaterThan(MAX_FLEX_BYTES);
    expect(flexMessage(`Judul\n${rows}`, "card")).toBeUndefined();
  });
});

describe("flexMessage answer", () => {
  test("has the bot's name as title and one block per paragraph, keeping line breaks inside", () => {
    const message = flexMessage("Satu\n• a\n• b\n\nDua", "answer")!;
    const bubble = message.contents as { header: { contents: { text: string }[] }; body: { contents: { text: string }[] } };
    expect(bubble.header.contents[0]!.text).toBe("Elysia");
    expect(bubble.body.contents.map((block) => block.text)).toEqual(["Satu\n• a\n• b", "Dua"]);
  });
});

describe("quickReply", () => {
  test("makes message-action buttons that send the given text", () => {
    expect(quickReply([{ label: "English", text: "/config translate en" }])).toEqual({
      items: [{ type: "action", action: { type: "message", label: "English", text: "/config translate en" } }],
    });
  });

  test("keeps at most 13 buttons and cuts labels to 20 characters", () => {
    const options = Array.from({ length: 20 }, (_, i) => ({ label: "x".repeat(40), text: `/t ${i}` }));
    const { items } = quickReply(options);
    expect(items).toHaveLength(MAX_QUICK_REPLIES);
    expect(items!.every((item) => (item.action as { label: string }).label.length === MAX_QUICK_LABEL)).toBe(true);
  });
});

describe("translateLanguageOptions", () => {
  const options = translateLanguageOptions("Reset");

  test("fits LINE's limits and ends with the reset button", () => {
    expect(options.length).toBeLessThanOrEqual(MAX_QUICK_REPLIES);
    expect(options.every((option) => option.label.length <= MAX_QUICK_LABEL && option.text.length <= 300)).toBe(true);
    expect(options.at(-1)).toEqual({ label: "Reset", text: "/config translate reset" });
  });

  test("every button sends a /config translate command with a two-letter code", () => {
    expect(options.slice(0, -1).every((option) => /^\/config translate [a-z]{2}$/.test(option.text))).toBe(true);
    expect(options[0]).toEqual({ label: "English", text: "/config translate en" });
  });
});
