import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { createDedupe } from "./dedupe";

function event(webhookEventId?: string, isRedelivery = false): webhook.Event {
  return { type: "follow", webhookEventId, deliveryContext: { isRedelivery } } as webhook.Event;
}

describe("createDedupe", () => {
  spyOn(console, "log").mockImplementation(() => {});
  let db: Database;
  beforeEach(() => { db = new Database(":memory:"); });

  test("passes events seen for the first time", () => {
    const events = [event("e1"), event("e2")];
    expect(createDedupe(db)(events)).toEqual(events);
  });
  test("drops a redelivered event that was already handled", () => {
    const dedupe = createDedupe(db);
    dedupe([event("e1")]);
    expect(dedupe([event("e1", true)])).toEqual([]);
  });
  test("drops a duplicate inside one batch", () => {
    expect(createDedupe(db)([event("e1"), event("e1")])).toHaveLength(1);
  });
  test("never drops events without an ID", () => {
    expect(createDedupe(db)([event(), event()])).toHaveLength(2);
  });
  test("remembers IDs across a restart (same database)", () => {
    createDedupe(db)([event("e1")]);
    expect(createDedupe(db)([event("e1")])).toEqual([]);
  });
  test("forgets IDs after the TTL", () => {
    let now = 0;
    const dedupe = createDedupe(db, 1000, () => now);
    dedupe([event("e1")]);
    now = 1001;
    expect(dedupe([event("e1")])).toHaveLength(1);
  });
});
