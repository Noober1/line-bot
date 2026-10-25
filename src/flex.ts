import type { messagingApi } from "@line/bot-sdk";

// LINE limits: altText up to 400 characters, a Flex message up to 30 KB of JSON, a quick reply up to 13
// buttons with labels up to 20 characters.
export const MAX_ALT_TEXT = 400;
export const MAX_FLEX_BYTES = 25_000;
export const MAX_QUICK_REPLIES = 13;
export const MAX_QUICK_LABEL = 20;
// An AI answer longer than this goes out as a card in a 1:1 chat.
export const LONG_ANSWER_CHARS = 600;
const ANSWER_TITLE = "Elysia";

// A tap on the button sends `text` as the user's own message, so it must be something the bot understands.
export type QuickReplyOption = { readonly label: string; readonly text: string };

// How a reply is dressed. "card": the first line is the title and each other line a row (/help, /groups,
// /config). "answer": a title and the paragraphs of an AI answer. Flex messages cannot carry a quote token,
// so events.ts asks for them in 1:1 chats only.
export type ReplyExtras = {
  readonly flex?: "card" | "answer";
  readonly quickReplies?: readonly QuickReplyOption[];
};

// undefined when the text cannot be a card (nothing to put in the body, or over MAX_FLEX_BYTES): send it as text.
export function flexMessage(text: string, kind: "card" | "answer"): messagingApi.FlexMessage | undefined {
  const lines = text.split("\n");
  const title = kind === "card" ? (lines.shift() ?? "").trim() : ANSWER_TITLE;
  const blocks = (kind === "card" ? lines : text.split(/\n{2,}/)).map((block) => block.trim()).filter(Boolean);
  if (!title || blocks.length === 0) return undefined;
  const contents: messagingApi.FlexBubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [{ type: "text", text: title, weight: "bold", size: "lg", wrap: true }],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: blocks.map((block) => ({ type: "text", text: block, size: "sm", wrap: true }) as const),
    },
  };
  if (Buffer.byteLength(JSON.stringify(contents)) > MAX_FLEX_BYTES) return undefined;
  return { type: "flex", altText: altText(text), contents };
}

// What a notification or a quote shows instead of the card, so it is the whole text, cut to LINE's limit.
function altText(text: string): string {
  if (text.length <= MAX_ALT_TEXT) return text;
  const cut = text.slice(0, MAX_ALT_TEXT - 1);
  const last = cut.charCodeAt(cut.length - 1);
  // Not between the two halves of a surrogate pair (emoji).
  return `${last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut}…`;
}

export function quickReply(options: readonly QuickReplyOption[]): messagingApi.QuickReply {
  return {
    items: options.slice(0, MAX_QUICK_REPLIES).map(({ label, text }) => ({
      type: "action",
      action: { type: "message", label: label.slice(0, MAX_QUICK_LABEL), text },
    })),
  };
}

// Common target languages for `/config translate`, shown by their own name, plus a button to go back to the default.
const QUICK_LANGUAGES = ["en", "id", "ja", "ko", "zh", "es", "fr", "de", "th", "vi", "pt", "ar"] as const;

export function translateLanguageOptions(resetLabel: string): QuickReplyOption[] {
  return [
    ...QUICK_LANGUAGES.map((code) => {
      const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
      return { label: name.charAt(0).toLocaleUpperCase(code) + name.slice(1), text: `/config translate ${code}` };
    }),
    { label: resetLabel, text: "/config translate reset" },
  ];
}
