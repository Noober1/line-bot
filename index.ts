import { messagingApi } from "@line/bot-sdk";
import { filterAllowed } from "./src/allowlist";
import { createApp } from "./src/app";
import { loadConfig, type Config } from "./src/config";
import { handleEvents, type Reply } from "./src/events";

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

const reply: Reply = async (replyToken, text) => {
  await client.replyMessage({ replyToken, messages: [{ type: "text", text }] });
};

const app = createApp({
  channelSecret: config.lineChannelSecret,
  onEvents: (events) => void handleEvents(filterAllowed(events, allowlist), reply),
});

const server = Bun.serve({ port: config.port, fetch: app });
console.log(`Listening on ${server.url}`);
