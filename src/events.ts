import type { webhook } from "@line/bot-sdk";
import type { Ai } from "./ai";
import { parseCommand, runCommand } from "./commands";
import { localeFromLine, type LineLanguage, type Locale } from "./language";
import { MESSAGES, type CommandName } from "./messages";
import type { RateLimit } from "./ratelimit";
import { sourceKey, type SessionStore, type StoredMessage } from "./session";
import { settingsFor, type SettingsStore } from "./settings";

export type Reply = (replyToken: string, text: string) => Promise<void>;

export type Languages = {
  readonly lineLanguage: LineLanguage;
  // Reply language when the sender's LINE language is unknown or not supported (DEFAULT_REPLY_LANG).
  readonly defaultLocale: Locale;
};

// For callers without LINE access (tests): every sender gets Indonesian replies.
const NO_LINE_LANGUAGE: Languages = { lineLanguage: async () => undefined, defaultLocale: "id" };

// How many stored messages go to the AI with each new message.
export const AI_HISTORY_LIMIT = 20;

// "/elysia <text>" asks the AI like a plain message: the fallback when a mention of the bot is not possible.
const ELYSIA_COMMAND: CommandName = "elysia";

// Never rejects: one failed reply or AI call must not affect the others or crash the process.
export async function handleEvents(
  events: webhook.Event[],
  reply: Reply,
  sessions: SessionStore,
  ai: Ai,
  settings: SettingsStore,
  languages: Languages = NO_LINE_LANGUAGE,
  rateLimit: RateLimit = () => "allow",
): Promise<void> {
  const results = await Promise.allSettled(
    events.map((event) => handleEvent(event, reply, sessions, ai, settings, languages, rateLimit)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to handle event:", result.reason);
    }
  }
}

async function handleEvent(
  event: webhook.Event,
  reply: Reply,
  sessions: SessionStore,
  ai: Ai,
  settings: SettingsStore,
  languages: Languages,
  rateLimit: RateLimit,
): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text" || !event.replyToken) {
    return;
  }
  const { text } = event.message;
  const key = sourceKey(event.source);
  const command = parseCommand(text);
  const inGroup = event.source?.type === "group" || event.source?.type === "room";
  // In a group or room a plain message is for the bot only when it mentions the bot; the rest is members
  // talking. Ignored here, above the rate limit, so it does not use up the group's limit.
  const mentionPrompt = inGroup && !command ? withoutBotMention(event.message) : null;
  if (inGroup && !command && mentionPrompt === null) {
    return;
  }
  const verdict = key ? rateLimit(key) : "allow";
  if (verdict !== "allow") {
    if (verdict === "notify") {
      console.log(`Rate limit reached for ${key}`);
      const userId = event.source?.userId;
      const lineLanguage = userId ? await languages.lineLanguage(userId) : undefined;
      await reply(event.replyToken, MESSAGES[localeFromLine(lineLanguage) ?? languages.defaultLocale].rateLimited);
    }
    return;
  }
  if (command && command.name !== ELYSIA_COMMAND) {
    const resetHistory = () => {
      if (key) sessions.clear(key);
    };
    // Settings and the reply language belong to the sender, also in a group.
    // The LINE language is fetched for commands only: the AI answers in the user's language by itself.
    const userId = event.source?.userId;
    const lineLanguage = userId ? await languages.lineLanguage(userId) : undefined;
    const userSettings = userId ? settingsFor(settings, userId, lineLanguage) : null;
    const locale = localeFromLine(lineLanguage) ?? languages.defaultLocale;
    const context = { resetHistory, settings: userSettings, defaults: settings.defaults, ai, locale };
    await reply(event.replyToken, await runCommand(command, context));
    return;
  }
  const prompt = command ? command.args.trim() : (mentionPrompt ?? text);
  if (!prompt) {
    const userId = event.source?.userId;
    const lineLanguage = userId ? await languages.lineLanguage(userId) : undefined;
    await reply(event.replyToken, MESSAGES[localeFromLine(lineLanguage) ?? languages.defaultLocale].elysiaUsage);
    return;
  }
  // An AI failure throws and is logged by handleEvents: the user gets no reply and nothing is saved.
  const answer = await ai([...history(sessions, key), { role: "user", content: prompt }]);
  await reply(event.replyToken, answer);
  // Saved only after a successful reply, so the history holds what the user actually saw.
  if (key) {
    sessions.append(key, "user", prompt);
    sessions.append(key, "assistant", answer);
  }
}

// The window can start on an assistant row (odd limit, or an orphan row); a chat must start with the user.
function history(sessions: SessionStore, key: string | null): StoredMessage[] {
  if (!key) return [];
  const recent = sessions.recent(key, AI_HISTORY_LIMIT);
  return recent[0]?.role === "assistant" ? recent.slice(1) : recent;
}

// The text without the bot's own mentions, trimmed; null when the bot is not mentioned (@All does not count).
// shortcut: index/length are taken as UTF-16 code units (JS string index); LINE's docs do not say, verified by manual test.
function withoutBotMention(message: webhook.TextMessageContent): string | null {
  const own = (message.mention?.mentionees ?? []).filter((m) => m.type === "user" && m.isSelf === true);
  if (own.length === 0) return null;
  let text = message.text;
  // Last mention first, so earlier indexes stay valid.
  for (const { index, length } of own.sort((a, b) => b.index - a.index)) {
    text = text.slice(0, index) + text.slice(index + length);
  }
  return text.trim();
}
