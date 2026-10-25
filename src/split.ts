import type { messagingApi } from "@line/bot-sdk";
import { flexMessage, quickReply, type ReplyExtras } from "./flex";
import type { Mentions } from "./mentions";

// LINE limits: a text message holds 5000 UTF-16 code units (= JS string length); a reply holds 5 messages.
export const MAX_TEXT_LENGTH = 5000;
export const MAX_REPLY_MESSAGES = 5;

// Best break first. A break only counts in the second half of a part, so no part ends up tiny.
const BREAKS = ["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", " "];

// Never returns more than maxParts parts; the last one ends with "…" when text was dropped.
export function splitReply(text: string, max = MAX_TEXT_LENGTH, maxParts = MAX_REPLY_MESSAGES): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    if (parts.length === maxParts - 1) {
      parts.push(`${rest.slice(0, cutAt(rest, max - 1)).trimEnd()}…`);
      return parts;
    }
    const cut = cutAt(rest, max);
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return rest ? [...parts, rest] : parts;
}

// One quote per answer: only the first part quotes the user's message.
// An answer with mentions is one text v2 message: restoreMentions (mentions.ts) already kept it under the limit.
// A card (extras.flex) is one Flex message without a quote: LINE has no quote token on Flex messages.
// Quick reply buttons ride on the last message.
export function replyMessages(text: string, quoteToken?: string, mentions?: Mentions, extras?: ReplyExtras): messagingApi.Message[] {
  const messages = buildMessages(text, quoteToken, mentions, extras);
  const options = extras?.quickReplies;
  const last = messages.at(-1);
  return options?.length && last ? [...messages.slice(0, -1), { ...last, quickReply: quickReply(options) }] : messages;
}

function buildMessages(text: string, quoteToken?: string, mentions?: Mentions, extras?: ReplyExtras): messagingApi.Message[] {
  const card = extras?.flex && !mentions ? flexMessage(text, extras.flex) : undefined;
  if (card) return [card];
  if (mentions) {
    const substitution = Object.fromEntries(
      Object.entries(mentions).map(([key, userId]) => [key, { type: "mention" as const, mentionee: { type: "user" as const, userId } }]),
    );
    return [{ type: "textV2", text, substitution, ...(quoteToken ? { quoteToken } : {}) }];
  }
  return splitReply(text).map((part, i) =>
    i === 0 && quoteToken ? { type: "text", text: part, quoteToken } : { type: "text", text: part },
  );
}

function cutAt(text: string, max: number): number {
  const window = text.slice(0, max);
  for (const mark of BREAKS) {
    const at = window.lastIndexOf(mark);
    if (at > max / 2) return at + mark.length;
  }
  // Hard cut, but not between the two halves of a surrogate pair (emoji).
  const last = text.charCodeAt(max - 1);
  return last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
}
