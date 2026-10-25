import type { Database } from "bun:sqlite";

// Who has /auto-translate on, per group. A row means on.
export type AutoTranslateStore = {
  readonly isOn: (groupId: string, userId: string) => boolean;
  // Flips the sender's switch in that group; returns the new state.
  readonly toggle: (groupId: string, userId: string) => boolean;
  // The sender's last translated messages in that group, oldest first; kept in memory only (lost on restart,
  // emptied when the sender switches off) and only for senders who are on. Context for the next translation.
  readonly recent: (groupId: string, userId: string) => readonly string[];
  readonly remember: (groupId: string, userId: string, text: string) => void;
};

export const CONTEXT_MESSAGES = 3;
export const CONTEXT_CHARS = 200;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS auto_translate (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
`;

export function createAutoTranslateStore(db: Database): AutoTranslateStore {
  db.run(SCHEMA);
  const select = db.query<{ n: number }, [string, string]>(
    "SELECT 1 AS n FROM auto_translate WHERE group_id = ? AND user_id = ?",
  );
  const remove = db.query<void, [string, string]>("DELETE FROM auto_translate WHERE group_id = ? AND user_id = ?");
  const insert = db.query<void, [string, string]>("INSERT INTO auto_translate (group_id, user_id) VALUES (?, ?)");
  // shortcut: one entry per sender who is on, never pruned for groups the bot left; fine at this scale.
  const context = new Map<string, readonly string[]>();
  const contextKey = (groupId: string, userId: string) => `${groupId}\n${userId}`;
  const isOn = (groupId: string, userId: string) => select.get(groupId, userId) !== null;
  return {
    isOn,
    toggle: (groupId, userId) => {
      if (remove.run(groupId, userId).changes === 1) {
        context.delete(contextKey(groupId, userId));
        return false;
      }
      insert.run(groupId, userId);
      return true;
    },
    recent: (groupId, userId) => context.get(contextKey(groupId, userId)) ?? [],
    remember: (groupId, userId, text) => {
      if (!isOn(groupId, userId)) return;
      const key = contextKey(groupId, userId);
      context.set(key, [...(context.get(key) ?? []), text.slice(0, CONTEXT_CHARS)].slice(-CONTEXT_MESSAGES));
    },
  };
}
