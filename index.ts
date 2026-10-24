import { Database } from "bun:sqlite";
import { messagingApi } from "@line/bot-sdk";
import { createAi } from "./src/ai";
import { filterAllowed } from "./src/allowlist";
import { createApp } from "./src/app";
import { loadConfig, type Config } from "./src/config";
import { createDedupe } from "./src/dedupe";
import { handleEvents, type Languages, type Reply } from "./src/events";
import { createLineLanguage } from "./src/language";
import { createRateLimit } from "./src/ratelimit";
import { createSessionStore } from "./src/session";
import { createSettingsStore } from "./src/settings";
import { splitReply } from "./src/split";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(`Config error: ${(error as Error).message}`);
  process.exit(1);
}

const { allowlist } = config;
if (allowlist.userIds.size === 0 && allowlist.groupIds.size === 0) {
  console.warn(
    "Allowlist is empty: every event will be ignored. Set ALLOWED_USER_IDS and/or ALLOWED_GROUP_IDS in .env.",
  );
}

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.lineChannelAccessToken,
});

// A reply token works once, so a long answer goes out as up to 5 messages in one reply.
const reply: Reply = async (replyToken, text) => {
  await client.replyMessage({ replyToken, messages: splitReply(text).map((part) => ({ type: "text", text: part })) });
};

const db = new Database(config.databasePath);
const sessions = createSessionStore(db);
const settings = createSettingsStore(db, config.defaultSettings);
const dedupe = createDedupe(db);
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
    void handleEvents(dedupe(filterAllowed(events, allowlist)), reply, sessions, ai, settings, languages, rateLimit),
});

const server = Bun.serve({ port: config.port, fetch: app });
console.log(`Listening on ${server.url}`);
