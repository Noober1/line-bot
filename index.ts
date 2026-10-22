import { messagingApi } from "@line/bot-sdk";
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

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.lineChannelAccessToken,
});

const reply: Reply = async (replyToken, text) => {
  await client.replyMessage({ replyToken, messages: [{ type: "text", text }] });
};

const app = createApp({
  channelSecret: config.lineChannelSecret,
  onEvents: (events) => void handleEvents(events, reply),
});

const server = Bun.serve({ port: config.port, fetch: app });
console.log(`Listening on ${server.url}`);
