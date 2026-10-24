import type { AiConfig } from "./ai";
import type { Allowlist } from "./allowlist";
import { LOCALES, parseLocale, type Locale } from "./language";
import { parseSettingValue, type Settings } from "./settings";

export type Config = {
  readonly port: number;
  readonly lineChannelSecret: string;
  readonly lineChannelAccessToken: string;
  readonly allowlist: Allowlist;
  readonly databasePath: string;
  readonly ai: AiConfig;
  // Global defaults for per-user settings (/config).
  readonly defaultSettings: Settings;
  // Reply language when the user's LINE language is unknown or not supported.
  readonly defaultLocale: Locale;
  // Messages per minute the bot handles per chat (user, group or room). 0 = no limit.
  readonly rateLimitPerMinute: number;
};

type Env = Record<string, string | undefined>;

const REQUIRED_KEYS = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "AI_MODEL"] as const;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const DEFAULT_DATABASE_PATH = "bot.sqlite";
const DEFAULT_AI_BASE_URL = "http://localhost:20128/v1";
const DEFAULT_TRANSLATE_LANG = "en";
const DEFAULT_REPLY_LANG: Locale = "id";
const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;

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

  return {
    port,
    lineChannelSecret: env.LINE_CHANNEL_SECRET!,
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN!,
    allowlist: {
      userIds: parseIdList(env.ALLOWED_USER_IDS),
      groupIds: parseIdList(env.ALLOWED_GROUP_IDS),
    },
    databasePath: env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
    ai: {
      baseUrl: env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL,
      apiKey: env.AI_API_KEY?.trim() || undefined,
      model: env.AI_MODEL!.trim(),
    },
    defaultSettings: { translate },
    defaultLocale,
    rateLimitPerMinute,
  };
}

function parseIdList(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}
