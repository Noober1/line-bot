import type { webhook } from "@line/bot-sdk";
import { ACCESS_COMMANDS, isOwner, runAccessCommand, type Access } from "./access-commands";
import type { Ai } from "./ai";
import type { AutoTranslateStore } from "./auto-translate";
import { autoTranslatePrompt, MAX_TRANSLATE_CHARS, parseCommand, parseInstruction, runCommand } from "./commands";
import { localeFromLine, type LineLanguage, type Locale } from "./language";
import { plainText, protectMentions, restoreMentions, type Mentions, type ShieldedText } from "./mentions";
import { MESSAGES, type CommandName } from "./messages";
import type { RateLimit } from "./ratelimit";
import { sourceKey, type SessionStore, type StoredMessage } from "./session";
import { resolveSettings, settingsFor, type SettingsStore } from "./settings";
import { MAX_TEXT_LENGTH } from "./split";

// `mentions` (placeholder -> user ID, see mentions.ts) makes the reply a text v2 message that mentions those users.
export type Reply = (replyToken: string, text: string, quoteToken?: string, mentions?: Mentions) => Promise<void>;

export type Languages = {
  readonly lineLanguage: LineLanguage;
  // Reply language when the sender's LINE language is unknown or not supported (DEFAULT_REPLY_LANG).
  readonly defaultLocale: Locale;
};

// How many stored messages go to the AI with each new message.
export const AI_HISTORY_LIMIT = 20;

// "/elysia <text>" asks the AI like a plain message: the fallback when a mention of the bot is not possible.
const ELYSIA_COMMAND: CommandName = "elysia";

// Settings are changed in a 1:1 chat only: a group has no private reply, and a push DM costs quota.
const CONFIG_COMMAND: CommandName = "config";

// Toggled in a group only; elsewhere the router answers autoTranslateGroupOnly.
const AUTO_TRANSLATE_COMMAND: CommandName = "auto-translate";
const TRANSLATE_COMMAND: CommandName = "translate";

// A pending group gets the "not permitted" notice at most this often.
export const NOT_PERMITTED_NOTICE_MS = 10 * 60 * 1000;

// What a 1:1 chat with anyone but the owner may use; everything else gets dmGroupsOnly.
const DM_COMMANDS: ReadonlySet<string> = new Set(["groups", "approve", "deny", "groupconfig", "config", "auto-translate", "help", "ping"]);

// The only access command that also works in a group.
const GROUP_CONFIG_COMMAND = "groupconfig";

// Never rejects: one failed reply or AI call must not affect the others or crash the process.
export async function handleEvents(
  events: webhook.Event[],
  reply: Reply,
  sessions: SessionStore,
  ai: Ai,
  settings: SettingsStore,
  languages: Languages,
  rateLimit: RateLimit,
  access: Access,
  autoTranslate: AutoTranslateStore,
): Promise<void> {
  const results = await Promise.allSettled(
    events.map((event) => handleEvent(event, reply, sessions, ai, settings, languages, rateLimit, access, autoTranslate)),
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
  access: Access,
  autoTranslate: AutoTranslateStore,
): Promise<void> {
  const { source } = event;
  const userId = source?.userId;
  const groupId = source?.type === "group" ? source.groupId : undefined;
  // Only groups and 1:1 chats with a user ID: rooms and events without a usable source are ignored (see filterDms).
  if (!groupId && !(source?.type === "user" && userId)) {
    return;
  }
  if (groupId && event.type === "join") {
    await onJoin(groupId, event.replyToken, reply, access, languages);
    return;
  }
  if (groupId && event.type === "leave") {
    // Admin and group settings are kept; a new join makes the group pending again.
    access.groups.leave(groupId);
    console.log(`Left group ${groupId}`);
    return;
  }
  if (event.type !== "message" || event.message.type !== "text" || !event.replyToken) {
    return;
  }
  const { text } = event.message;
  const replyToken = event.replyToken;
  const quoteToken = event.message.quoteToken;
  // Every answer to a text message quotes it; join (onJoin) has no message to quote.
  const respond = (replyText: string, mentions?: Mentions) =>
    mentions ? reply(replyToken, replyText, quoteToken, mentions) : reply(replyToken, replyText, quoteToken);
  // For /translate and auto-translate: mentions of other users travel through the AI as placeholders.
  const shielded = protectMentions(event.message);
  const key = sourceKey(source);
  const command = parseCommand(text);
  const inGroup = groupId !== undefined;
  // In a group a plain message is for the bot only when it mentions the bot, or comes from a sender with
  // /auto-translate on; the rest is members talking. Ignored here, above the access gate and the rate limit.
  const mentionPrompt = inGroup && !command ? withoutBotMention(event.message) : null;
  const autoTranslating =
    groupId !== undefined && !command && mentionPrompt === null && userId !== undefined && autoTranslate.isOn(groupId, userId);
  if (inGroup && !command && mentionPrompt === null && !autoTranslating) {
    return;
  }
  const owner = isOwner(access, userId);
  // Before the rate limit, so a group that is not allowed uses up nothing. Writes the DB: runs after dedupe.
  // The owner bypasses the gate, also in a denied group. Talking in a group also claims it for the owner,
  // so another member cannot become its requester and admin.
  if (groupId && owner && userId) {
    access.groups.claim(groupId, userId);
  }
  if (groupId && !owner) {
    const group = access.groups.request(groupId, userId);
    if (group.status !== "allowed") {
      if (autoTranslating || group.status === "denied" || !access.groups.claimNotice(groupId, NOT_PERMITTED_NOTICE_MS)) {
        console.log(`Ignored a message to the bot in ${group.status} group ${groupId}`);
        return;
      }
      const t = MESSAGES[(await senderLanguage(userId, languages)).locale];
      await respond(userId ? t.notPermitted(group.id) : t.unknownSender);
      return;
    }
  }
  const verdict = key ? rateLimit(key) : "allow";
  if (verdict !== "allow") {
    if (verdict === "notify") {
      console.log(`Rate limit reached for ${key}`);
      // A translation is not a request to the bot: no notice.
      if (!autoTranslating) await respond(MESSAGES[(await senderLanguage(userId, languages)).locale].rateLimited);
    }
    return;
  }
  if (autoTranslating && groupId && userId) {
    await autoTranslateText(shielded, groupId, userId, respond, ai, settings, languages, access, autoTranslate);
    return;
  }
  if (!inGroup && !owner && !(command && DM_COMMANDS.has(command.name))) {
    await respond(MESSAGES[(await senderLanguage(userId, languages)).locale].dmGroupsOnly);
    return;
  }
  // /groups, /approve, /deny, /admin only in a 1:1 chat; in a group they fall through to "unknown command".
  if (command && ACCESS_COMMANDS.has(command.name) && (!inGroup || command.name === GROUP_CONFIG_COMMAND)) {
    const { locale } = await senderLanguage(userId, languages);
    await respond(await runAccessCommand(command, { access, userId, groupId, locale }));
    return;
  }
  if (command && command.name !== ELYSIA_COMMAND) {
    const resetHistory = () => {
      if (key) sessions.clear(key);
    };
    // Settings and the reply language belong to the sender, also in a group.
    // The LINE language is fetched for commands only: the AI answers in the user's language by itself.
    const { lineLanguage, locale } = await senderLanguage(userId, languages);
    if (inGroup && command.name === CONFIG_COMMAND) {
      await respond(MESSAGES[locale].configInGroup);
      return;
    }
    // In a group, the group's settings sit between the sender's own and their LINE language.
    const groupStored = groupId ? access.groupSettings.stored(groupId) : {};
    const userSettings = userId ? settingsFor(settings, userId, lineLanguage, groupStored) : null;
    const defaults = resolveSettings({}, settings.defaults, undefined, groupStored);
    if (groupId && command.name === AUTO_TRANSLATE_COMMAND) {
      const t = MESSAGES[locale];
      if (!userId || !userSettings) {
        await respond(t.settingsUnavailable);
        return;
      }
      await respond(autoTranslate.toggle(groupId, userId) ? t.autoTranslateOn(userSettings.resolved().translate) : t.autoTranslateOff);
      return;
    }
    const context = { resetHistory, settings: userSettings, defaults, ai, locale };
    if (command.name === TRANSLATE_COMMAND) {
      const answer = await runCommand(parseCommand(shielded.text) ?? command, context);
      const restored = restoreMentions(answer, shielded, MAX_TEXT_LENGTH);
      await respond(restored.text, restored.mentions);
      return;
    }
    await respond(await runCommand(command, context));
    return;
  }
  const prompt = command ? command.args.trim() : (mentionPrompt ?? text);
  if (!prompt) {
    await respond(MESSAGES[(await senderLanguage(userId, languages)).locale].elysiaUsage);
    return;
  }
  // An AI failure throws and is logged by handleEvents: the user gets no reply and nothing is saved.
  const answer = await ai([...history(sessions, key), { role: "user", content: prompt }]);
  await respond(answer);
  // Saved only after a successful reply, so the history holds what the user actually saw.
  if (key) {
    sessions.append(key, "user", prompt);
    sessions.append(key, "assistant", answer);
  }
}

// LINE does not say who added the bot, and a join event has no user ID: the notice is in DEFAULT_REPLY_LANG.
// A join on an allowed/pending group (a leave event was missed) resets it to pending.
async function onJoin(groupId: string, replyToken: string, reply: Reply, access: Access, languages: Languages): Promise<void> {
  if (access.groups.get(groupId)?.status === "denied") {
    console.log(`Ignored join event from denied group ${groupId}`);
    return;
  }
  const group = access.groups.join(groupId);
  console.log(`Joined group ${groupId} (#${group.id}), waiting for /approve`);
  await reply(replyToken, MESSAGES[languages.defaultLocale].joinNotice);
}

// Only the text and the translate prompt go to the AI, and nothing is saved. An AI failure throws:
// handleEvents logs it and the sender gets no reply.
async function autoTranslateText(
  shielded: ShieldedText,
  groupId: string,
  userId: string,
  respond: (text: string, mentions?: Mentions) => Promise<void>,
  ai: Ai,
  settings: SettingsStore,
  languages: Languages,
  access: Access,
  autoTranslate: AutoTranslateStore,
): Promise<void> {
  const { text } = shielded;
  // The AI answer is capped (MAX_ANSWER_TOKENS): a longer text could come back cut off.
  if (text.length > MAX_TRANSLATE_CHARS) {
    console.log(`Skipped auto-translate of a long message in ${groupId}`);
    return;
  }
  const { lineLanguage } = await senderLanguage(userId, languages);
  const language = settingsFor(settings, userId, lineLanguage, access.groupSettings.stored(groupId)).resolved().translate;
  const { instruction, text: body } = parseInstruction(text);
  const earlier = autoTranslate.recent(groupId, userId);
  const answer = await ai([{ role: "user", content: body }], autoTranslatePrompt(language, instruction, earlier));
  // "NOOP" (case and trailing punctuation tolerated): already in the target language.
  if (/^noop\W*$/i.test(answer)) {
    console.log(`Auto-translate skipped in ${groupId}: the AI answered NOOP`);
    return;
  }
  autoTranslate.remember(groupId, userId, plainText(body, shielded));
  const restored = restoreMentions(answer, shielded, MAX_TEXT_LENGTH);
  await respond(restored.text, restored.mentions);
}

async function senderLanguage(userId: string | undefined, languages: Languages) {
  const lineLanguage = userId ? await languages.lineLanguage(userId) : undefined;
  return { lineLanguage, locale: localeFromLine(lineLanguage) ?? languages.defaultLocale };
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
