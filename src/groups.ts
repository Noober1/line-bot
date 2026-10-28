import type { Database } from "bun:sqlite";

export type GroupStatus = "pending" | "allowed" | "denied" | "left";

export type Group = {
  // groups.id: the short number typed in /approve, /deny, /admin, /groupconfig. Stable: rows are never deleted.
  readonly id: number;
  readonly groupId: string;
  readonly status: GroupStatus;
  readonly requesterId: string | null;
  readonly adminId: string | null;
};

export type GroupStore = {
  readonly get: (groupId: string) => Group | null;
  readonly byId: (id: number) => Group | null;
  // Every group except left ones: pending, then allowed, then denied; oldest first within a status.
  readonly list: () => Group[];
  // Allowed groups whose admin is `adminId` (MAX_GROUPS_PER_USER).
  readonly allowedCount: (adminId: string) => number;
  // Join event: any group but a denied one becomes pending without requester (admin kept).
  readonly join: (groupId: string) => Group;
  // A message to the bot: adds a missing group as pending (a left one too: the bot is evidently there),
  // then records `userId` as requester when the group is pending and has none.
  readonly request: (groupId: string, userId: string | undefined) => Group;
  readonly leave: (groupId: string) => void;
  // The owner talks to the bot in a group that is missing, pending or left: it becomes allowed with the owner as
  // requester and admin, so nobody else can claim it. Allowed groups keep their admin; denied stay denied.
  readonly claim: (groupId: string, ownerId: string) => void;
  // True at most once per `windowMs` per group: the caller may send the not-permitted notice.
  readonly claimNotice: (groupId: string, windowMs: number) => boolean;
  // -> allowed, the requester becomes admin.
  readonly approve: (id: number) => void;
  readonly setStatus: (id: number, status: "pending" | "denied") => void;
  // Owner override: requester and admin together; null clears both.
  readonly setAdmin: (id: number, userId: string | null) => void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','allowed','denied','left')),
  requester_id TEXT,
  admin_id TEXT,
  notified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

type Row = { id: number; group_id: string; status: GroupStatus; requester_id: string | null; admin_id: string | null };
const COLUMNS = "id, group_id, status, requester_id, admin_id";
const INSERT_PENDING = "INSERT INTO groups (group_id, status, created_at, updated_at) VALUES (?1, 'pending', ?2, ?2)";
const RESET_TO_PENDING = "DO UPDATE SET status = 'pending', requester_id = NULL, notified_at = NULL, updated_at = ?2";

export function createGroupStore(db: Database, now: () => number = Date.now): GroupStore {
  db.run(SCHEMA);
  const selectByGroupId = db.query<Row, [string]>(`SELECT ${COLUMNS} FROM groups WHERE group_id = ?`);
  const selectById = db.query<Row, [number]>(`SELECT ${COLUMNS} FROM groups WHERE id = ?`);
  const selectList = db.query<Row, []>(
    `SELECT ${COLUMNS} FROM groups WHERE status <> 'left'
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'allowed' THEN 1 ELSE 2 END, id`,
  );
  const countAllowed = db.query<{ n: number }, [string]>(
    "SELECT COUNT(*) AS n FROM groups WHERE status = 'allowed' AND admin_id = ?",
  );
  const join = db.query<void, [string, number]>(
    `${INSERT_PENDING} ON CONFLICT (group_id) ${RESET_TO_PENDING} WHERE status <> 'denied'`,
  );
  const ensure = db.query<void, [string, number]>(
    `${INSERT_PENDING} ON CONFLICT (group_id) ${RESET_TO_PENDING} WHERE status = 'left'`,
  );
  const fillRequester = db.query<void, [string, string, number]>(
    "UPDATE groups SET requester_id = ?2, updated_at = ?3 WHERE group_id = ?1 AND status = 'pending' AND requester_id IS NULL",
  );
  const leave = db.query<void, [string, number]>("UPDATE groups SET status = 'left', updated_at = ?2 WHERE group_id = ?1");
  const ownerClaim = db.query<void, [string, string, number]>(
    `INSERT INTO groups (group_id, status, requester_id, admin_id, created_at, updated_at)
     VALUES (?1, 'allowed', ?2, ?2, ?3, ?3)
     ON CONFLICT (group_id) DO UPDATE SET status = 'allowed', requester_id = ?2, admin_id = ?2, updated_at = ?3
     WHERE status IN ('pending', 'left')`,
  );
  const claim = db.query<void, [string, number, number]>(
    "UPDATE groups SET notified_at = ?2 WHERE group_id = ?1 AND (notified_at IS NULL OR notified_at <= ?2 - ?3)",
  );
  const approve = db.query<void, [number, number]>(
    "UPDATE groups SET status = 'allowed', admin_id = requester_id, updated_at = ?2 WHERE id = ?1",
  );
  const setStatus = db.query<void, [number, string, number]>("UPDATE groups SET status = ?2, updated_at = ?3 WHERE id = ?1");
  const setAdmin = db.query<void, [number, string | null, number]>(
    "UPDATE groups SET requester_id = ?2, admin_id = ?2, updated_at = ?3 WHERE id = ?1",
  );

  const get = (groupId: string) => toGroup(selectByGroupId.get(groupId));
  return {
    get,
    byId: (id) => toGroup(selectById.get(id)),
    list: () => selectList.all().map((row) => toGroup(row)!),
    allowedCount: (adminId) => countAllowed.get(adminId)?.n ?? 0,
    join: (groupId) => {
      join.run(groupId, now());
      return get(groupId)!;
    },
    request: (groupId, userId) => {
      const time = now();
      ensure.run(groupId, time);
      if (userId) fillRequester.run(groupId, userId, time);
      return get(groupId)!;
    },
    leave: (groupId) => {
      leave.run(groupId, now());
    },
    claim: (groupId, ownerId) => {
      ownerClaim.run(groupId, ownerId, now());
    },
    claimNotice: (groupId, windowMs) => claim.run(groupId, now(), windowMs).changes === 1,
    approve: (id) => {
      approve.run(id, now());
    },
    setStatus: (id, status) => {
      setStatus.run(id, status, now());
    },
    setAdmin: (id, userId) => {
      setAdmin.run(id, userId, now());
    },
  };
}

function toGroup(row: Row | null): Group | null {
  return row
    ? { id: row.id, groupId: row.group_id, status: row.status, requesterId: row.requester_id, adminId: row.admin_id }
    : null;
}
