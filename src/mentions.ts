import type { webhook } from "@line/bot-sdk";

// shortcut: a text message v2 holds up to 20 mentions (from memory, not verified against the docs);
// extra mentions stay plain text. Check developers.line.biz before raising it.
export const MAX_MENTIONS = 20;

// Placeholder key -> LINE user ID.
export type Mentions = Readonly<Record<string, string>>;

export type ShieldedText = {
  // The message text with each user mention replaced by a placeholder like "{u1}".
  readonly text: string;
  readonly mentions: Mentions;
  // Placeholder key -> the "@Name" the user typed; the plain-text fallback.
  readonly labels: Readonly<Record<string, string>>;
};

const PLACEHOLDER = /\{[^{}]*\}/g;

// Mentions of other users with a user ID become placeholders, so the AI keeps them intact. The bot's own
// mention, @All, and mentions without a user ID (the user has not consented) stay as the text they are.
// shortcut: index/length are UTF-16 code units, as in withoutBotMention (events.ts).
export function protectMentions(message: webhook.TextMessageContent): ShieldedText {
  const targets = (message.mention?.mentionees ?? [])
    .flatMap((m) => (m.type === "user" && m.isSelf !== true && m.userId ? [{ index: m.index, length: m.length, userId: m.userId }] : []))
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_MENTIONS);
  const mentions: Record<string, string> = {};
  const labels: Record<string, string> = {};
  let text = message.text;
  // Last mention first, so earlier indexes stay valid; keys follow the order in the text.
  for (const [i, { index, length, userId }] of [...targets.entries()].reverse()) {
    const key = `u${i + 1}`;
    mentions[key] = userId;
    labels[key] = message.text.slice(index, index + length);
    text = `${text.slice(0, index)}{${key}}${text.slice(index + length)}`;
  }
  return { text, mentions, labels };
}

// The answer to send: the mentions it still holds, or plain text when it cannot be sent as text v2.
// An unknown {placeholder} (the AI changed one) or a too-long answer falls back to "@Name" text.
export function restoreMentions(
  answer: string,
  shielded: ShieldedText,
  maxLength: number,
): { readonly text: string; readonly mentions?: Mentions } {
  const used: Record<string, string> = {};
  let broken = answer.length > maxLength;
  for (const token of answer.match(PLACEHOLDER) ?? []) {
    const key = token.slice(1, -1);
    const userId = shielded.mentions[key];
    if (userId) used[key] = userId;
    else broken = true;
  }
  if (!broken && Object.keys(used).length > 0) {
    return { text: answer, mentions: used };
  }
  const text = answer.replace(PLACEHOLDER, (token) => shielded.labels[token.slice(1, -1)] ?? token);
  return { text };
}
