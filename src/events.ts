import type { webhook } from "@line/bot-sdk";
import { ACCESS_COMMANDS, isOwner, runAccessCommand, type Access } from "./access-commands";
import type { Ai, AiImage } from "./ai";
import { describeSource } from "./allowlist";
import type { AutoTranslateStore } from "./auto-translate";
import { autoTranslatePrompt, MAX_TRANSLATE_CHARS, parseCommand, parseInstruction, runCommand, type Command } from "./commands";
import { LONG_ANSWER_CHARS, translateLanguageOptions, type ReplyExtras } from "./flex";
import type { FetchImage } from "./image";
import { localeFromLine, type LineLanguage, type Locale } from "./language";
import { logger, preview, shortId, withEvent } from "./log";
import { plainText, protectMentions, restoreMentions, type Mentions, type ShieldedText } from "./mentions";
import { MESSAGES, type CommandName } from "./messages";
import { buildChatPrompts, DEFAULT_PERSONA, type ChatPrompts } from "./persona";
import type { RateLimit } from "./ratelimit";
import { sourceKey, type SessionStore, type StoredMessage } from "./session";
import { resolveSettings, settingsFor, type SettingsStore } from "./settings";
import { MAX_TEXT_LENGTH, splitReply } from "./split";

const log = logger("events");

// `mentions` (placeholder -> user ID, see mentions.ts) makes the reply a text v2 message that mentions those users.
// `extras` dresses the reply as a card and/or adds quick reply buttons (flex.ts).
export type Reply = (
  replyToken: string,
  text: string,
  quoteToken?: string,
  mentions?: Mentions,
  extras?: ReplyExtras,
) => Promise<void>;

// Shows LINE's loading animation in a 1:1 chat (a group has none) until the bot's next message or a timeout.
export type ShowLoading = (userId: string) => Promise<void>;

export type Languages = {
  readonly lineLanguage: LineLanguage;
  // Reply language when the sender's LINE language is unknown or not supported (DEFAULT_REPLY_LANG).
  readonly defaultLocale: Locale;
};

// System prompts for plain chat (DM vs group); /translate and auto-translate bring their own.
const DEFAULT_PROMPTS = buildChatPrompts(DEFAULT_PERSONA);

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

const GROUPS_COMMAND = "groups";

// The only access command that also works in a group.
const GROUP_CONFIG_COMMAND = "groupconfig";

// What the history keeps for an image: the bytes are never stored.
const IMAGE_PLACEHOLDER = "[image]";

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
  showLoading?: ShowLoading,
  prompts: ChatPrompts = DEFAULT_PROMPTS,
  // Without it, images are ignored like any other non-text message.
  fetchImage?: FetchImage,
): Promise<void> {
  await Promise.all(
    events.map((event) =>
      withEvent(shortId(event.webhookEventId), async () => {
        const started = Date.now();
        log.info("event", { type: event.type, source: describeSource(event.source), kind: messageKind(event) });
        try {
          await handleEvent(event, timedReply(reply), sessions, timedAi(ai), settings, languages, rateLimit, access, autoTranslate, showLoading, prompts, fetchImage);
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
    const [, text, quoteToken, mentions, extras] = args;
    const started = Date.now();
    try {
      await reply(...args);
      log.info("reply sent", {
        parts: mentions ? 1 : splitReply(text).length,
        chars: text.length,
        quote: Boolean(quoteToken),
        mentions: mentions ? Object.keys(mentions).length : 0,
        card: extras?.flex,
        buttons: extras?.quickReplies?.length,
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
      log.info("ai answered", { messages: args[0].length, chars: answer.length, image: args[2] ? true : undefined, ms: Date.now() - started });
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
  showLoading: ShowLoading | undefined,
  prompts: ChatPrompts,
  fetchImage: FetchImage | undefined,
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
  // A LINE image carries no mention, so in a group it is plain chat: it falls through to the non-text return
  // below, above the access gate and the rate limit. In a 1:1 chat it goes to answerImage.
  if (event.type === "message" && event.message.type === "image" && event.replyToken && !groupId && userId && fetchImage) {
    await answerImage(event.message, userId, event.replyToken, reply, sessions, ai, languages, rateLimit, access, fetchImage, showLoading, prompts);
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
  const respond = (replyText: string, mentions?: Mentions, extras?: ReplyExtras) =>
    extras
      ? reply(replyToken, replyText, quoteToken, mentions, extras)
      : mentions
        ? reply(replyToken, replyText, quoteToken, mentions)
        : reply(replyToken, replyText, quoteToken);
  // For /translate and auto-translate: mentions of other users travel through the AI as placeholders.
  const shielded = protectMentions(event.message);
  const key = sourceKey(source);
  const command = parseCommand(text);
  const inGroup = groupId !== undefined;
  // Not awaited: the animation must not delay the AI call, and a failure must not cost the user their answer.
  const startLoading = () => {
    if (showLoading && !inGroup && userId) {
      showLoading(userId).catch((error: unknown) => log.warn("loading animation failed", { err: error }));
    }
  };
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
    const text = await runAccessCommand(command, { access, userId, groupId, locale });
    await respond(text, undefined, !inGroup && command.name === GROUPS_COMMAND ? { flex: "card" } : undefined);
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
      startLoading();
      const answer = await runCommand(parseCommand(shielded.text) ?? command, context);
      const restored = restoreMentions(answer, shielded, MAX_TEXT_LENGTH);
      await respond(restored.text, restored.mentions);
      return;
    }
    await respond(await runCommand(command, context), undefined, inGroup ? undefined : commandExtras(command, locale));
    return;
  }
  const prompt = command ? command.args.trim() : (mentionPrompt ?? text);
  if (!prompt) {
    await respond(MESSAGES[(await senderLanguage(userId, languages)).locale].elysiaUsage);
    return;
  }
  const past = history(sessions, key);
  log.info("ai chat", { history: past.length, chars: prompt.length, via: command ? "/elysia" : mentionPrompt === null ? "dm" : "mention" });
  startLoading();
  let answer: string;
  try {
    answer = await ai([...past, { role: "user", content: prompt }], inGroup ? prompts.group : prompts.dm);
  } catch (error) {
    // The user is told, and nothing is saved: the history holds only what was answered.
    log.error("ai chat failed", { err: error });
    const t = MESSAGES[(await senderLanguage(userId, languages)).locale];
    await respond(isTimeout(error) ? t.aiTimeout : t.aiFailed);
    return;
  }
  await respond(answer, undefined, !inGroup && answer.length > LONG_ANSWER_CHARS ? { flex: "answer" } : undefined);
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
  const { instruction: given, text: body } = parseInstruction(text);
  // An instruction sticks for the sender's following messages until a new one replaces it.
  const instruction = given ?? autoTranslate.instruction(groupId, userId);
  const earlier = autoTranslate.recent(groupId, userId);
  const answer = await ai([{ role: "user", content: body }], autoTranslatePrompt(language, instruction, earlier));
  // "NOOP" (case and trailing punctuation tolerated): already in the target language.
  if (/^noop\W*$/i.test(answer)) {
    log.info("auto-translate skipped: already in the target language (NOOP)", { group: shortId(groupId) });
    return;
  }
  autoTranslate.remember(groupId, userId, plainText(body, shielded), given);
  const restored = restoreMentions(answer, shielded, MAX_TEXT_LENGTH);
  await respond(restored.text, restored.mentions);
}

// An image in a 1:1 chat, in the same order as text: rate limit, then the owner check (others get dmGroupsOnly), then the AI.
// The image lives in memory for this call only; the history keeps a placeholder and the answer.
async function answerImage(
  message: webhook.ImageMessageContent,
  userId: string,
  replyToken: string,
  reply: Reply,
  sessions: SessionStore,
  ai: Ai,
  languages: Languages,
  rateLimit: RateLimit,
  access: Access,
  fetchImage: FetchImage,
  showLoading: ShowLoading | undefined,
  prompts: ChatPrompts,
): Promise<void> {
  const respond = (text: string, extras?: ReplyExtras) =>
    extras ? reply(replyToken, text, message.quoteToken, undefined, extras) : reply(replyToken, text, message.quoteToken);
  const verdict = rateLimit(userId);
  if (verdict !== "allow") {
    if (verdict === "notify") {
      log.warn("rate limited: sending the notice", { source: shortId(userId) });
      await respond(MESSAGES[(await senderLanguage(userId, languages)).locale].rateLimited);
    } else {
      log.debug("rate limited: silent", { source: shortId(userId) });
    }
    return;
  }
  // The LINE language picks the prompt: an image has no text the AI could take the language from.
  const t = MESSAGES[(await senderLanguage(userId, languages)).locale];
  if (!isOwner(access, userId)) {
    log.info("ignored: DM from a non-owner outside the DM commands");
    await respond(t.dmGroupsOnly);
    return;
  }
  // Only LINE's content API is ever fetched: an external image URL is never followed.
  if (message.contentProvider.type !== "line") {
    log.info("image skipped: external content provider");
    await respond(t.imageFailed);
    return;
  }
  // Not awaited, as for text: the download is part of the wait.
  showLoading?.(userId).catch((error: unknown) => log.warn("loading animation failed", { err: error }));
  const started = Date.now();
  let image: AiImage;
  try {
    image = await fetchImage(message.id);
  } catch (error) {
    log.warn("image download failed", { ms: Date.now() - started, err: error });
    await respond(t.imageFailed);
    return;
  }
  const past = history(sessions, userId);
  // Size and type only, never the bytes.
  log.info("ai image", { history: past.length, mime: image.mime, bytes: Math.floor((image.base64.length * 3) / 4), ms: Date.now() - started, set: message.imageSet?.total });
  let answer: string;
  try {
    answer = await ai([...past, { role: "user", content: t.imagePrompt }], prompts.dm, image);
  } catch (error) {
    log.error("ai image failed", { err: error });
    await respond(isTimeout(error) ? t.aiTimeout : t.aiFailed);
    return;
  }
  await respond(answer, answer.length > LONG_ANSWER_CHARS ? { flex: "answer" } : undefined);
  // Saved only after a successful reply, like text.
  sessions.append(userId, "user", `${IMAGE_PLACEHOLDER} ${t.imagePrompt}`);
  sessions.append(userId, "assistant", answer);
}

// Cards for the list-like command answers in a 1:1 chat; /config also offers the translate languages as buttons.
function commandExtras(command: Command, locale: Locale): ReplyExtras | undefined {
  if (command.name === "help") return { flex: "card" };
  if (command.name === CONFIG_COMMAND && !command.args.trim()) {
    return { flex: "card", quickReplies: translateLanguageOptions(MESSAGES[locale].resetLabel) };
  }
  return undefined;
}

// createAi stops a request with AbortSignal.timeout, which rejects with a TimeoutError.
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
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
