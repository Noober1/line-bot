import { Database } from "bun:sqlite";
import { messagingApi } from "@line/bot-sdk";
import { createAi } from "./src/ai";
import type { Access } from "./src/access-commands";
import { filterDms } from "./src/allowlist";
import { createApp, MAX_REQUEST_BODY_BYTES } from "./src/app";
import { createAutoTranslateStore } from "./src/auto-translate";
import { loadConfig, type Config } from "./src/config";
import { createDedupe } from "./src/dedupe";
import { handleEvents, type Languages, type Reply } from "./src/events";
import { createGroupStore } from "./src/groups";
import { createLineLanguage } from "./src/language";
import { createRateLimit } from "./src/ratelimit";
import { createSessionStore } from "./src/session";
import { createSettingsStore } from "./src/settings";
import { replyMessages } from "./src/split";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(`Config error: ${(error as Error).message}`);
  process.exit(1);
}

for (const warning of config.warnings) console.warn(warning);

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.lineChannelAccessToken,
});

// A reply token works once, so a long answer goes out as up to 5 messages in one reply.
const reply: Reply = async (replyToken, text, quoteToken, mentions) => {
  await client.replyMessage({ replyToken, messages: replyMessages(text, quoteToken, mentions) });
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
console.log(`AI: model ${config.ai.model} via ${config.ai.baseUrl}`);
const languages: Languages = {
  lineLanguage: createLineLanguage(db, async (userId) => (await client.getProfile(userId)).language),
  defaultLocale: config.defaultLocale,
};

const app = createApp({
  channelSecret: config.lineChannelSecret,
  onEvents: (events) =>
    void handleEvents(dedupe(filterDms(events)), reply, sessions, ai, settings, languages, rateLimit, access, autoTranslate),
});

const server = Bun.serve({ port: config.port, maxRequestBodySize: MAX_REQUEST_BODY_BYTES, fetch: app });
console.log(`Listening on ${server.url}`);
