import type { Database } from "bun:sqlite";

// Who has /auto-translate on, per group. A row means on.
export type AutoTranslateStore = {
  readonly isOn: (groupId: string, userId: string) => boolean;
  // Flips the sender's switch in that group; returns the new state.
  readonly toggle: (groupId: string, userId: string) => boolean;
};

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
  return {
    isOn: (groupId, userId) => select.get(groupId, userId) !== null,
    toggle: (groupId, userId) => {
      if (remove.run(groupId, userId).changes === 1) return false;
      insert.run(groupId, userId);
      return true;
    },
  };
}
