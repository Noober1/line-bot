import type { AiConfig } from "./ai";
import type { Allowlist } from "./allowlist";

export type Config = {
  readonly port: number;
  readonly lineChannelSecret: string;
  readonly lineChannelAccessToken: string;
  readonly allowlist: Allowlist;
  readonly databasePath: string;
  readonly ai: AiConfig;
};

type Env = Record<string, string | undefined>;

const REQUIRED_KEYS = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "AI_MODEL"] as const;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const DEFAULT_DATABASE_PATH = "bot.sqlite";
const DEFAULT_AI_BASE_URL = "http://localhost:20128/v1";

export function loadConfig(env: Env): Config {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }

  const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
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
  };
}

function parseIdList(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}
