import type { Database } from "bun:sqlite";

// Languages the bot's own texts (/help, /config, errors) come in.
export const LOCALES = ["id", "en", "ja", "zh-Hans", "zh-Hant"] as const;
export type Locale = (typeof LOCALES)[number];

// How long a fetched LINE language is reused before Get profile is called again.
export const LINE_LANGUAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Get profile, reduced to its `language`. Undefined when the user has not consented to share it.
// Rejects when LINE refuses, e.g. 404 when the user is not a friend of the bot.
export type FetchLanguage = (userId: string) => Promise<string | undefined>;

// The user's LINE language (BCP 47), or undefined when unknown. Never rejects on a LINE error.
export type LineLanguage = (userId: string) => Promise<string | undefined>;

// Script and region subtags that mean Traditional Chinese.
const TRADITIONAL_CHINESE = new Set(["hant", "tw", "hk", "mo"]);

// language is NULL when the profile had none (no consent): that answer is cached too.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS user_languages (
  user_id TEXT PRIMARY KEY,
  language TEXT,
  fetched_at INTEGER NOT NULL
);
`;

export function createLineLanguage(
  db: Database,
  fetchLanguage: FetchLanguage,
  ttlMs = LINE_LANGUAGE_TTL_MS,
  now: () => number = Date.now,
): LineLanguage {
  db.run(SCHEMA);
  const select = db.query<{ language: string | null; fetched_at: number }, [string]>(
    "SELECT language, fetched_at FROM user_languages WHERE user_id = ?",
  );
  const upsert = db.query<void, [string, string | null, number]>(
    `INSERT INTO user_languages (user_id, language, fetched_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id) DO UPDATE SET language = excluded.language, fetched_at = excluded.fetched_at`,
  );

  return async (userId) => {
    const cached = select.get(userId);
    if (cached && now() - cached.fetched_at < ttlMs) {
      return cached.language ?? undefined;
    }
    let language: string | undefined;
    try {
      language = await fetchLanguage(userId);
    } catch (error) {
      // Not cached, so the next command tries again. An expired value beats none.
      console.error(`Get profile failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      return cached?.language ?? undefined;
    }
    // Logged so the mapping in localeFromLine can be checked against real LINE values.
    console.log(`LINE language of user ${userId}: ${language ?? "(none)"}`);
    upsert.run(userId, language ?? null, now());
    return language;
  };
}

// A LINE language tag (BCP 47: "ja", "en-US", "zh-Hant", "zh-TW") to a bot locale; null when not supported.
export function localeFromLine(tag: string | undefined): Locale | null {
  const [primary = "", ...rest] = (tag ?? "").toLowerCase().split("-");
  if (primary === "zh") {
    // An explicit script wins over the region: "zh-Hans-HK" is Simplified.
    if (rest.includes("hans")) return "zh-Hans";
    return rest.some((part) => TRADITIONAL_CHINESE.has(part)) ? "zh-Hant" : "zh-Hans";
  }
  return LOCALES.find((locale) => locale === primary) ?? null;
}

// Case-insensitive ("zh-hant" -> "zh-Hant"). Null when not a supported locale.
export function parseLocale(value: string): Locale | null {
  const lower = value.trim().toLowerCase();
  return LOCALES.find((locale) => locale.toLowerCase() === lower) ?? null;
}
