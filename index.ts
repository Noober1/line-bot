import { Database } from "bun:sqlite";
import { messagingApi } from "@line/bot-sdk";
import { AI_TIMEOUT_MS, createAi } from "./src/ai";
import type { Access } from "./src/access-commands";
import { filterDms } from "./src/allowlist";
import { createApp, MAX_REQUEST_BODY_BYTES } from "./src/app";
import { createAutoTranslateStore } from "./src/auto-translate";
import { loadConfig, type Config } from "./src/config";
import { createDedupe } from "./src/dedupe";
import { handleEvents, type Languages, type Reply, type ShowLoading } from "./src/events";
import { createGroupStore } from "./src/groups";
import { createFetchImage } from "./src/image";
import { configureLog, logger } from "./src/log";
import { createLineLanguage } from "./src/language";
import { buildChatPrompts } from "./src/persona";
import { createRateLimit } from "./src/ratelimit";
import { createSessionStore } from "./src/session";
import { createSettingsStore } from "./src/settings";
import { replyMessages } from "./src/split";

const log = logger("app");
const AI_LOADING_SECONDS = Math.ceil(AI_TIMEOUT_MS / 1000 / 5) * 5;

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  log.error(`config error: ${(error as Error).message}`);
  process.exit(1);
}

// Secrets never reach the terminal, not even inside an error message from fetch.
configureLog({ level: config.logLevel, secrets: [config.lineChannelSecret, config.lineChannelAccessToken, config.ai.apiKey ?? ""] });
for (const warning of config.warnings) log.warn(warning);

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.lineChannelAccessToken,
});

// A reply token works once, so a long answer goes out as up to 5 messages in one reply.
const reply: Reply = async (replyToken, text, quoteToken, mentions, extras) => {
  await client.replyMessage({ replyToken, messages: replyMessages(text, quoteToken, mentions, extras) });
};

// LINE accepts 5 to 60 seconds in steps of 5. The animation ends with the bot's next message.
const showLoading: ShowLoading = async (userId) => {
  await client.showLoadingAnimation({ chatId: userId, loadingSeconds: AI_LOADING_SECONDS });
};

const db = new Database(config.databasePath);
const sessions = createSessionStore(db);
const settings = createSettingsStore(db, config.defaultSettings);
const access: Access = {
  groups: createGroupStore(db),
  groupSettings: createSettingsStore(db, config.defaultSettings, "group_settings"),
  ownerUserId: config.ownerUserId,
  maxGroupsPerUser: config.maxGroupsPerUser,
  groupName: async (groupId) => (await client.getGroupSummary(groupId)).groupName,
};
const dedupe = createDedupe(db);
const autoTranslate = createAutoTranslateStore(db);
const rateLimit = createRateLimit(config.rateLimitPerMinute);
const ai = createAi(config.ai);
const fetchImage = createFetchImage(config.lineChannelAccessToken);
const prompts = buildChatPrompts(config.persona);
const languages: Languages = {
  lineLanguage: createLineLanguage(db, async (userId) => (await client.getProfile(userId)).language),
  defaultLocale: config.defaultLocale,
};

const app = createApp({
  channelSecret: config.lineChannelSecret,
  onEvents: (events) =>
    void handleEvents(dedupe(filterDms(events)), reply, sessions, ai, settings, languages, rateLimit, access, autoTranslate, showLoading, prompts, fetchImage),
});

const server = Bun.serve({ port: config.port, maxRequestBodySize: MAX_REQUEST_BODY_BYTES, fetch: app });
const aiUrl = new URL(config.ai.baseUrl);
log.info("started", {
  url: server.url.href,
  port: config.port,
  aiModel: config.ai.model,
  aiBaseUrl: `${aiUrl.origin}${aiUrl.pathname}`,
  appEnv: process.env.APP_ENV?.trim() || "production",
  logLevel: config.logLevel,
  maxGroupsPerUser: config.maxGroupsPerUser,
  owner: config.ownerUserId ? "set" : "none",
  // Source and size only, never the text.
  persona: `${config.personaSource} chars=${config.persona.length}`,
  rateLimitPerMinute: config.rateLimitPerMinute,
  database: config.databasePath,
});
