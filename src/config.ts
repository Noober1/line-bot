import type { AiConfig } from "./ai";
import { LOCALES, parseLocale, type Locale } from "./language";
import { parseSettingValue, type Settings } from "./settings";

export type Config = {
  readonly port: number;
  readonly lineChannelSecret: string;
  readonly lineChannelAccessToken: string;
  // Operator: the only user with AI chat in a 1:1 chat, passes the access check in every group. Undefined = none.
  readonly ownerUserId: string | undefined;
  // Allowed groups one admin may hold at a time; the owner has no limit.
  readonly maxGroupsPerUser: number;
  readonly databasePath: string;
  readonly ai: AiConfig;
  // Global defaults for per-user settings (/config).
  readonly defaultSettings: Settings;
  // Reply language when the user's LINE language is unknown or not supported.
  readonly defaultLocale: Locale;
  // Messages per minute the bot handles per chat (user, group or room). 0 = no limit.
  readonly rateLimitPerMinute: number;
  // Printed at startup, e.g. a removed env key that is still set.
  readonly warnings: readonly string[];
};

type Env = Record<string, string | undefined>;

const REQUIRED_KEYS = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "AI_MODEL"] as const;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const DEFAULT_DATABASE_PATH = "bot.sqlite";
const DEFAULT_AI_BASE_URL = "http://localhost:20128/v1";
// Chat text and AI_API_KEY go to AI_BASE_URL, so plain http is only allowed to this machine (or any host when APP_ENV=development, e.g. over a tailnet).
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEFAULT_TRANSLATE_LANG = "en";
const DEFAULT_REPLY_LANG: Locale = "id";
const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
const DEFAULT_MAX_GROUPS_PER_USER = 3;
const REMOVED_KEYS = ["ALLOWED_USER_IDS", "ALLOWED_GROUP_IDS"] as const;
// A LINE user ID: "U" and 32 lowercase hex characters.
export const LINE_USER_ID = /^U[0-9a-f]{32}$/;

export function loadConfig(env: Env): Config {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }

  const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  const translate = parseSettingValue("translate", env.DEFAULT_TRANSLATE_LANG?.trim() || DEFAULT_TRANSLATE_LANG);
  if (!translate) {
    throw new Error(`Invalid DEFAULT_TRANSLATE_LANG: ${env.DEFAULT_TRANSLATE_LANG} (use an ISO 639-1 code)`);
  }

  const defaultLocale = parseLocale(env.DEFAULT_REPLY_LANG?.trim() || DEFAULT_REPLY_LANG);
  if (!defaultLocale) {
    throw new Error(`Invalid DEFAULT_REPLY_LANG: ${env.DEFAULT_REPLY_LANG} (use one of: ${LOCALES.join(", ")})`);
  }

  const rateLimitPerMinute = env.RATE_LIMIT_PER_MINUTE?.trim()
    ? Number(env.RATE_LIMIT_PER_MINUTE)
    : DEFAULT_RATE_LIMIT_PER_MINUTE;
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 0) {
    throw new Error(`Invalid RATE_LIMIT_PER_MINUTE: ${env.RATE_LIMIT_PER_MINUTE} (use a whole number, 0 = no limit)`);
  }

  const ownerUserId = env.OWNER_USER_ID?.trim() || undefined;
  if (ownerUserId && !LINE_USER_ID.test(ownerUserId)) {
    throw new Error(`Invalid OWNER_USER_ID: ${ownerUserId} (use a LINE user ID: U and 32 hex characters)`);
  }

  const maxGroupsPerUser = env.MAX_GROUPS_PER_USER?.trim()
    ? Number(env.MAX_GROUPS_PER_USER)
    : DEFAULT_MAX_GROUPS_PER_USER;
  if (!Number.isInteger(maxGroupsPerUser) || maxGroupsPerUser < 1) {
    throw new Error(`Invalid MAX_GROUPS_PER_USER: ${env.MAX_GROUPS_PER_USER} (use a whole number above 0)`);
  }

  const aiBaseUrl = env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL;
  const parsedAiBaseUrl = URL.parse(aiBaseUrl);
  const isDevelopment = env.APP_ENV?.trim() === "development";
  if (
    !parsedAiBaseUrl ||
    !(parsedAiBaseUrl.protocol === "https:" ||
      (parsedAiBaseUrl.protocol === "http:" && (isDevelopment || LOOPBACK_HOSTS.has(parsedAiBaseUrl.hostname))))
  ) {
    throw new Error(
      `Invalid AI_BASE_URL: ${aiBaseUrl} (use https://, or http:// only for localhost, 127.0.0.1 or [::1]; any http:// host needs APP_ENV=development)`,
    );
  }

  const warnings = REMOVED_KEYS.filter((key) => env[key]?.trim()).map(
    (key) => `${key} is no longer used and is ignored: groups are allowed with /approve in a DM to the bot. Remove it from .env.`,
  );

  return {
    port,
    lineChannelSecret: env.LINE_CHANNEL_SECRET!,
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN!,
    ownerUserId,
    maxGroupsPerUser,
    databasePath: env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
    ai: {
      baseUrl: aiBaseUrl,
      apiKey: env.AI_API_KEY?.trim() || undefined,
      model: env.AI_MODEL!.trim(),
    },
    defaultSettings: { translate },
    defaultLocale,
    rateLimitPerMinute,
    warnings,
  };
}
