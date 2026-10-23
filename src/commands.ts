import { parseSettingKey, parseSettingValue, SETTINGS, type SettingKey, type UserSettings } from "./settings";

export type Command = { readonly name: string; readonly args: string };

// What a command may act on, bound to the chat the command came from.
export type CommandContext = {
  readonly resetHistory: () => void;
  // The sender's settings; null when LINE sent no user ID (e.g. LINE desktop users in a group).
  readonly settings: UserSettings | null;
};

type CommandSpec = {
  readonly description: string;
  readonly run: (args: string, context: CommandContext) => string;
};

const MAX_SHOWN_NAME = 32;
const RESET_VALUE = "reset";

// A Map, not an object literal: input like "/constructor" must not hit Object.prototype.
const COMMANDS: ReadonlyMap<string, CommandSpec> = new Map<string, CommandSpec>([
  ["help", { description: "tampilkan daftar perintah", run: () => helpText() }],
  ["ping", { description: "cek apakah bot aktif", run: () => "pong" }],
  [
    "reset",
    {
      description: "hapus riwayat chat",
      run: (_args, context) => {
        context.resetHistory();
        return "Riwayat chat sudah dihapus.";
      },
    },
  ],
  [
    "config",
    { description: "lihat atau ubah pengaturan kamu", run: (args, context) => configText(args, context.settings) },
  ],
]);

// Text starting with "/" (after trimming) is a command. The name is case-insensitive.
export function parseCommand(text: string): Command | null {
  const match = /^\/(\S*)\s*([\s\S]*)$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, name = "", args = ""] = match;
  return { name: name.toLowerCase(), args };
}

export function runCommand(command: Command, context: CommandContext): string {
  const spec = COMMANDS.get(command.name);
  return spec ? spec.run(command.args, context) : unknownCommandText(command.name);
}

function helpText(): string {
  const lines = [...COMMANDS].map(([name, spec]) => `/${name} - ${spec.description}`);
  return ["Daftar perintah:", ...lines].join("\n");
}

function unknownCommandText(name: string): string {
  return `Perintah /${shorten(name)} tidak dikenal. Ketik /help untuk daftar perintah.`;
}

// "/config" lists, "/config <name> <value>" sets, "/config <name> reset" goes back to the default.
function configText(args: string, settings: UserSettings | null): string {
  if (!settings) {
    return "Pengaturan tidak bisa dipakai: LINE tidak mengirim ID kamu.";
  }
  const [name = "", ...rest] = args.trim().split(/\s+/);
  const value = rest.join(" ");
  if (!name) {
    return settingsListText(settings);
  }
  const key = parseSettingKey(name);
  if (!key) {
    return `Pengaturan ${shorten(name)} tidak dikenal. Ketik /config untuk daftar pengaturan.`;
  }
  if (!value) {
    return `Pakai: /config ${key} <nilai>. Nilai: ${hint(key)}.`;
  }
  if (value.toLowerCase() === RESET_VALUE) {
    settings.unset(key);
    return `${key} kembali ke bawaan: ${settings.resolved()[key]}.`;
  }
  const parsed = parseSettingValue(key, value);
  if (!parsed) {
    return `Nilai ${shorten(value)} tidak valid untuk ${key}. Pakai ${hint(key)}.`;
  }
  settings.set(key, parsed);
  return `${key} diubah ke ${parsed}.`;
}

function settingsListText(settings: UserSettings): string {
  const stored = settings.stored();
  const resolved = settings.resolved();
  const lines = [...SETTINGS].flatMap(([key, spec]) => [
    `${key} = ${resolved[key]}${Object.hasOwn(stored, key) ? "" : " (bawaan)"} - ${spec.description}`,
    `  nilai: ${spec.hint}`,
  ]);
  return [
    "Pengaturan kamu:",
    ...lines,
    "Ubah: /config <nama> <nilai>",
    `Kembali ke bawaan: /config <nama> ${RESET_VALUE}`,
  ].join("\n");
}

function hint(key: SettingKey): string {
  return SETTINGS.get(key)?.hint ?? "";
}

function shorten(text: string): string {
  return text.length > MAX_SHOWN_NAME ? `${text.slice(0, MAX_SHOWN_NAME)}…` : text;
}
