import type { webhook } from "@line/bot-sdk";
import { logger, shortId } from "./log";

const log = logger("filter");

// Keeps 1:1 chats (anyone may DM the bot) and groups (the access gate in events.ts decides there).
// Drops rooms (legacy multi-person chats: not supported, no summary API) and events without a usable source.
// Logs IDs of dropped events, never message text.
export function filterDms(events: webhook.Event[]): webhook.Event[] {
  return events.filter((event) => {
    const { source } = event;
    const kept = source?.type === "group" || (source?.type === "user" && Boolean(source.userId));
    if (!kept) log.info("event ignored", { type: event.type, source: describeSource(source) });
    return kept;
  });
}

export function describeSource(source: webhook.Source | undefined): string {
  if (!source) return "unknown source";
  const user = source.userId ? `user ${shortId(source.userId)}` : "unknown user";
  if (source.type === "group") return `group ${shortId(source.groupId)} (${user})`;
  if (source.type === "room") return `room ${shortId(source.roomId)} (${user})`;
  return user;
}
