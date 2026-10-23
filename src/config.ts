import type { AiConfig } from "./ai";
import type { Allowlist } from "./allowlist";
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
};

type Env = Record<string, string | undefined>;

const REQUIRED_KEYS = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "AI_MODEL"] as const;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const DEFAULT_DATABASE_PATH = "bot.sqlite";
const DEFAULT_AI_BASE_URL = "http://localhost:20128/v1";
const DEFAULT_TRANSLATE_LANG = "en";

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
  };
}

function parseIdList(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}
