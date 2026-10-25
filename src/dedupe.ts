import type { Database } from "bun:sqlite";
import type { webhook } from "@line/bot-sdk";
import { logger, shortId } from "./log";

const log = logger("dedupe");

// A redelivered event keeps its webhookEventId. LINE refuses its reply token 20 min after the event, so a day is plenty.
export const SEEN_EVENT_TTL_MS = 24 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seen_events (
  event_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
`;

// Drops events whose webhookEventId was already seen (LINE redelivery, network duplicates).
export type Dedupe = (events: webhook.Event[]) => webhook.Event[];

export function createDedupe(db: Database, ttlMs = SEEN_EVENT_TTL_MS, now: () => number = Date.now): Dedupe {
  db.run(SCHEMA);
  // shortcut: purge scans the table (no index); fine for a private bot's few thousand rows a day.
  const purge = db.query<void, [number]>("DELETE FROM seen_events WHERE seen_at < ?");
  const insert = db.query<void, [string, number]>("INSERT OR IGNORE INTO seen_events (event_id, seen_at) VALUES (?, ?)");
  return (events) => {
    const time = now();
    purge.run(time - ttlMs);
    return events.filter((event) => {
      if (!event.webhookEventId) return true;
      if (insert.run(event.webhookEventId, time).changes === 1) return true;
      log.info("duplicate event skipped", { event: shortId(event.webhookEventId) });
      return false;
    });
  };
}
