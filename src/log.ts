import { AsyncLocalStorage } from "node:async_hooks";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export function parseLogLevel(value: string): LogLevel | undefined {
  return LOG_LEVELS.find((level) => level === value.toLowerCase());
}

// Values print as key=value; a string with a space, quote or "=" (or an empty one) is quoted.
export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = {
  readonly debug: (message: string, fields?: LogFields) => void;
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warn: (message: string, fields?: LogFields) => void;
  // An `err` field holding an Error prints its stack under the line.
  readonly error: (message: string, fields?: LogFields) => void;
};

type LogSettings = {
  level: LogLevel;
  // Receives one finished line (no trailing newline); the default writes to console, looked up at call time.
  sink: (level: LogLevel, line: string) => void;
  now: () => Date;
  color: boolean;
  // Exact strings (channel secret, tokens, API key) that must never reach the output.
  secrets: readonly string[];
};

const MIN_SECRET_LENGTH = 8;
const PREVIEW_CHARS = 200;
const SHORT_ID_CHARS = 8;
const COLORS: Readonly<Record<LogLevel, string>> = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };
const RESET = "\x1b[0m";

function consoleSink(level: LogLevel, line: string): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const defaults = (): LogSettings => ({
  level: "info",
  sink: consoleSink,
  now: () => new Date(),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  secrets: [],
});

let settings = defaults();

export function configureLog(changes: Partial<LogSettings>): void {
  settings = { ...settings, ...changes };
}

export function resetLog(): void {
  settings = defaults();
}

// For tests: collects the lines instead of printing them. Call restore() when done.
export function captureLog(level: LogLevel = "debug"): { readonly lines: string[]; readonly restore: () => void } {
  const previous = settings;
  const lines: string[] = [];
  configureLog({ level, sink: (_level, line) => void lines.push(line), color: false });
  return { lines, restore: () => void (settings = previous) };
}

// Lines logged inside withEvent carry `ev=<id>`, so one LINE event can be followed through the output.
const eventContext = new AsyncLocalStorage<string>();

export function withEvent<T>(id: string, run: () => Promise<T>): Promise<T> {
  return eventContext.run(id, run);
}

// LINE IDs are long and private: 8 characters are enough to tell them apart, the whole ID only at debug level.
export function shortId(id: string | undefined): string {
  if (!id) return "-";
  return settings.level === "debug" ? id : id.slice(0, SHORT_ID_CHARS);
}

// Message text appears only at debug level, cut short.
export function preview(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

export function logger(scope: string): Logger {
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(settings.level)) return;
    settings.sink(level, formatLine(level, scope, message, fields));
  };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function formatLine(level: LogLevel, scope: string, message: string, fields: LogFields = {}): string {
  const event = eventContext.getStore();
  const pairs = Object.entries({ ...(event ? { ev: event } : {}), ...fields })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}=${formatValue(value)}`)
    .join("");
  const label = level.toUpperCase().padEnd(5);
  const head = `${formatTime(settings.now())} ${settings.color ? `${COLORS[level]}${label}${RESET}` : label} [${scope}]`;
  const err = fields.err;
  const stack = level === "error" && err instanceof Error && err.stack ? `\n${err.stack}` : "";
  return redact(`${head} ${message}${pairs}${stack}`);
}

function formatTime(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function formatValue(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text === "" || /[\s"=]/.test(text) ? JSON.stringify(text) : text;
}

function redact(line: string): string {
  return settings.secrets.reduce(
    (text, secret) => (secret.length >= MIN_SECRET_LENGTH ? text.replaceAll(secret, "***") : text),
    line,
  );
}
