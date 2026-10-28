import type { Database } from "bun:sqlite";

// Every ISO 639-1 code (183). Two letters only, so no zh-Hans / zh-Hant.
export const ISO_639_1: ReadonlySet<string> = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz " +
    "ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii " +
    "ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi " +
    "mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw " +
    "sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk " +
    "ur uz ve vi vo wa wo xh yi yo za zh zu"
  ).split(" "),
);

export type SettingKey = "translate";
export type Settings = Readonly<Record<SettingKey, string>>;

// Description and hint texts live in messages.ts, one per reply language.
type SettingSpec = {
  // The canonical value, or null when the input is not allowed.
  readonly parse: (value: string) => string | null;
};

// A Map, not an object literal: input like "/config constructor x" must not hit Object.prototype.
export const SETTINGS: ReadonlyMap<SettingKey, SettingSpec> = new Map<SettingKey, SettingSpec>([
  ["translate", { parse: parseLanguage }],
]);

export type SettingsStore = {
  // Global defaults (env), used when there is no own value.
  readonly defaults: Settings;
  // `id`: a user ID (user_settings) or a LINE group ID (group_settings). Only set values; invalid stored ones are skipped.
  readonly stored: (id: string) => Partial<Settings>;
  readonly set: (id: string, key: SettingKey, value: string) => void;
  readonly unset: (id: string, key: SettingKey) => void;
};

// The settings of one user, as commands see them.
export type UserSettings = {
  readonly stored: () => Partial<Settings>;
  readonly resolved: () => Settings;
  readonly set: (key: SettingKey, value: string) => void;
  readonly unset: (key: SettingKey) => void;
};

// The same key/value table per user or per LINE group. A literal union, so no SQL can be injected.
export type SettingsTable = "user_settings" | "group_settings";
const ID_COLUMNS: Readonly<Record<SettingsTable, string>> = { user_settings: "user_id", group_settings: "group_id" };

export function createSettingsStore(db: Database, defaults: Settings, table: SettingsTable = "user_settings"): SettingsStore {
  const column = ID_COLUMNS[table];
  db.run(`
CREATE TABLE IF NOT EXISTS ${table} (
  ${column} TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (${column}, key)
);`);
  const select = db.query<{ key: string; value: string }, [string]>(
    `SELECT key, value FROM ${table} WHERE ${column} = ?`,
  );
  const upsert = db.query<void, [string, string, string, number]>(
    `INSERT INTO ${table} (${column}, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (${column}, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const remove = db.query<void, [string, string]>(`DELETE FROM ${table} WHERE ${column} = ? AND key = ?`);

  return {
    defaults,
    stored: (id) =>
      Object.fromEntries(
        select.all(id).flatMap((row) => {
          const key = parseSettingKey(row.key);
          const value = key && parseSettingValue(key, row.value);
          return key && value ? [[key, value]] : [];
        }),
      ),
    set: (id, key, value) => {
      upsert.run(id, key, value, Date.now());
    },
    unset: (id, key) => {
      remove.run(id, key);
    },
  };
}

// Binds the store to one user (or one group). `lineLanguage`: the user's LINE language (BCP 47), if known.
// `group`: the stored settings of the group the command came from ({} outside a group).
export function settingsFor(
  store: SettingsStore,
  userId: string,
  lineLanguage?: string,
  group: Partial<Settings> = {},
): UserSettings {
  return {
    stored: () => store.stored(userId),
    resolved: () => resolveSettings(store.stored(userId), store.defaults, lineLanguage, group),
    set: (key, value) => store.set(userId, key, value),
    unset: (key) => store.unset(userId, key),
  };
}

// Order: the user's own value > the group's value (in that group only) > the user's LINE language (translate only) > global default.
export function resolveSettings(
  stored: Partial<Settings>,
  defaults: Settings,
  lineLanguage?: string,
  group: Partial<Settings> = {},
): Settings {
  // A BCP 47 tag like "zh-Hant" or "pt-BR" maps to its ISO 639-1 part.
  const fromLine = lineLanguage ? parseLanguage(lineLanguage.split("-")[0] ?? "") : null;
  return { ...defaults, ...(fromLine ? { translate: fromLine } : {}), ...group, ...stored };
}

// Case-insensitive. Null for an unknown key.
export function parseSettingKey(name: string): SettingKey | null {
  const key = name.toLowerCase() as SettingKey;
  return SETTINGS.has(key) ? key : null;
}

export function parseSettingValue(key: SettingKey, value: string): string | null {
  return SETTINGS.get(key)?.parse(value) ?? null;
}

function parseLanguage(value: string): string | null {
  const code = value.trim().toLowerCase();
  return ISO_639_1.has(code) ? code : null;
}
