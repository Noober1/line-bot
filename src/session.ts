import type { Database } from "bun:sqlite";
import type { webhook } from "@line/bot-sdk";

export type Role = "user" | "assistant";
export type StoredMessage = { readonly role: Role; readonly content: string };

export type SessionStore = {
  readonly append: (key: string, role: Role, content: string) => void;
  // Newest `limit` messages, returned oldest first.
  readonly recent: (key: string, limit: number) => StoredMessage[];
  readonly clear: (key: string) => void;
};

export const MAX_STORED_PER_SOURCE = 100;

// secure_delete: /reset must also wipe the text from SQLite's free pages, not only unlink the rows.
const SCHEMA = `
PRAGMA secure_delete = ON;
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_source_id ON messages (source_key, id);
`;

export function createSessionStore(db: Database, maxPerSource = MAX_STORED_PER_SOURCE): SessionStore {
  db.run(SCHEMA);
  const insert = db.query<void, [string, Role, string, number]>(
    "INSERT INTO messages (source_key, role, content, created_at) VALUES (?, ?, ?, ?)",
  );
  // Deletes every row of the source older than its newest `maxPerSource` rows.
  const prune = db.query<void, [string, number]>(
    `DELETE FROM messages WHERE source_key = ?1 AND id <= (
       SELECT id FROM messages WHERE source_key = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2
     )`,
  );
  const selectRecent = db.query<StoredMessage, [string, number]>(
    `SELECT role, content FROM (
       SELECT id, role, content FROM messages WHERE source_key = ? ORDER BY id DESC LIMIT ?
     ) ORDER BY id`,
  );
  const remove = db.query<void, [string]>("DELETE FROM messages WHERE source_key = ?");

  const append = db.transaction((key: string, role: Role, content: string) => {
    insert.run(key, role, content, Date.now());
    prune.run(key, maxPerSource);
  });

  return {
    append: (key, role, content) => {
      append(key, role, content);
    },
    recent: (key, limit) => selectRecent.all(key, limit),
    clear: (key) => {
      remove.run(key);
    },
  };
}

// One history per chat: the user in a 1:1 chat, the whole group or room otherwise.
export function sourceKey(source: webhook.Source | undefined): string | null {
  if (!source) return null;
  if (source.type === "group") return source.groupId;
  if (source.type === "room") return source.roomId;
  return source.userId ?? null;
}
