export type Config = {
  readonly port: number;
  readonly lineChannelSecret: string;
  readonly lineChannelAccessToken: string;
};

type Env = Record<string, string | undefined>;

const REQUIRED_KEYS = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"] as const;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

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
  };
}
