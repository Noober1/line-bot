import type { webhook } from "@line/bot-sdk";
import { ACCESS_COMMANDS, isOwner, runAccessCommand, type Access } from "./access-commands";
import type { Ai } from "./ai";
import { describeSource } from "./allowlist";
import type { AutoTranslateStore } from "./auto-translate";
import { autoTranslatePrompt, MAX_TRANSLATE_CHARS, parseCommand, parseInstruction, runCommand } from "./commands";
import { localeFromLine, type LineLanguage, type Locale } from "./language";
import { logger, preview, shortId, withEvent } from "./log";
import { plainText, protectMentions, restoreMentions, type Mentions, type ShieldedText } from "./mentions";
import { MESSAGES, type CommandName } from "./messages";
import type { RateLimit } from "./ratelimit";
import { sourceKey, type SessionStore, type StoredMessage } from "./session";
import { resolveSettings, settingsFor, type SettingsStore } from "./settings";
import { MAX_TEXT_LENGTH, splitReply } from "./split";

const log = logger("events");

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
  await Promise.all(
    events.map((event) =>
      withEvent(shortId(event.webhookEventId), async () => {
        const started = Date.now();
        log.info("event", { type: event.type, source: describeSource(event.source), kind: messageKind(event) });
        try {
          await handleEvent(event, timedReply(reply), sessions, timedAi(ai), settings, languages, rateLimit, access, autoTranslate);
        } catch (error) {
          log.error("event failed", { err: error });
        } finally {
          log.info("done", { ms: Date.now() - started });
        }
      }),
    ),
  );
}

function messageKind(event: webhook.Event): string | undefined {
  return event.type === "message" ? event.message.type : undefined;
}

// Reply and AI are logged here, once, so every path through handleEvent is covered. Lengths only, never the text.
function timedReply(reply: Reply): Reply {
  return async (...args) => {
    const [, text, quoteToken, mentions] = args;
    const started = Date.now();
    try {
      await reply(...args);
      log.info("reply sent", {
        parts: mentions ? 1 : splitReply(text).length,
        chars: text.length,
        quote: Boolean(quoteToken),
        mentions: mentions ? Object.keys(mentions).length : 0,
        ms: Date.now() - started,
      });
    } catch (error) {
      log.warn("reply failed", { ms: Date.now() - started, err: error });
      throw error;
    }
  };
}

function timedAi(ai: Ai): Ai {
  return async (...args) => {
    const started = Date.now();
    try {
      const answer = await ai(...args);
      log.info("ai answered", { messages: args[0].length, chars: answer.length, ms: Date.now() - started });
      return answer;
    } catch (error) {
      log.warn("ai failed", { messages: args[0].length, ms: Date.now() - started, err: error });
      throw error;
    }
  };
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
    log.info("left group", { group: shortId(groupId) });
    return;
  }
  if (event.type !== "message" || event.message.type !== "text" || !event.replyToken) {
    return;
  }
  const { text } = event.message;
  log.debug("text", { chars: text.length, text: preview(text) });
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
    log.debug("ignored: plain group chat", { group: shortId(groupId) });
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
        log.info("ignored: group not allowed", { status: group.status, group: shortId(groupId), id: group.id });
        return;
      }
      log.info("group not allowed: sending the notice", { status: group.status, group: shortId(groupId), id: group.id });
      const t = MESSAGES[(await senderLanguage(userId, languages)).locale];
      await respond(userId ? t.notPermitted(group.id) : t.unknownSender);
      return;
    }
  }
  const verdict = key ? rateLimit(key) : "allow";
  if (verdict !== "allow") {
    if (verdict === "notify") {
      log.warn("rate limited: sending the notice", { source: shortId(key ?? undefined) });
      // A translation is not a request to the bot: no notice.
      if (!autoTranslating) await respond(MESSAGES[(await senderLanguage(userId, languages)).locale].rateLimited);
    } else {
      log.debug("rate limited: silent", { source: shortId(key ?? undefined) });
    }
    return;
  }
  if (autoTranslating && groupId && userId) {
    log.info("auto-translate", { group: shortId(groupId), chars: text.length });
    await autoTranslateText(shielded, groupId, userId, respond, ai, settings, languages, access, autoTranslate);
    return;
  }
  if (!inGroup && !owner && !(command && DM_COMMANDS.has(command.name))) {
    log.info("ignored: DM from a non-owner outside the DM commands");
    await respond(MESSAGES[(await senderLanguage(userId, languages)).locale].dmGroupsOnly);
    return;
  }
  // /groups, /approve, /deny, /admin only in a 1:1 chat; in a group they fall through to "unknown command".
  if (command && ACCESS_COMMANDS.has(command.name) && (!inGroup || command.name === GROUP_CONFIG_COMMAND)) {
    log.info("access command", { name: command.name });
    const { locale } = await senderLanguage(userId, languages);
    await respond(await runAccessCommand(command, { access, userId, groupId, locale }));
    return;
  }
  if (command && command.name !== ELYSIA_COMMAND) {
    log.info("command", { name: command.name.slice(0, 32) });
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
  const past = history(sessions, key);
  log.info("ai chat", { history: past.length, chars: prompt.length, via: command ? "/elysia" : mentionPrompt === null ? "dm" : "mention" });
  const answer = await ai([...past, { role: "user", content: prompt }]);
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
    log.info("ignored: join from a denied group", { group: shortId(groupId) });
    return;
  }
  const group = access.groups.join(groupId);
  log.info("joined group, waiting for /approve", { group: shortId(groupId), id: group.id });
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
    log.info("auto-translate skipped: message too long", { group: shortId(groupId), chars: text.length, max: MAX_TRANSLATE_CHARS });
    return;
  }
  const { lineLanguage } = await senderLanguage(userId, languages);
  const language = settingsFor(settings, userId, lineLanguage, access.groupSettings.stored(groupId)).resolved().translate;
  const { instruction, text: body } = parseInstruction(text);
  const earlier = autoTranslate.recent(groupId, userId);
  const answer = await ai([{ role: "user", content: body }], autoTranslatePrompt(language, instruction, earlier));
  // "NOOP" (case and trailing punctuation tolerated): already in the target language.
  if (/^noop\W*$/i.test(answer)) {
    log.info("auto-translate skipped: already in the target language (NOOP)", { group: shortId(groupId) });
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
