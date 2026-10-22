export type Command = { readonly name: string; readonly args: string };

type CommandSpec = {
  readonly description: string;
  readonly run: (args: string) => string;
};

const MAX_SHOWN_NAME = 32;

// A Map, not an object literal: input like "/constructor" must not hit Object.prototype.
const COMMANDS: ReadonlyMap<string, CommandSpec> = new Map<string, CommandSpec>([
  ["help", { description: "tampilkan daftar perintah", run: () => helpText() }],
  ["ping", { description: "cek apakah bot aktif", run: () => "pong" }],
  // shortcut: nothing is stored yet, so there is nothing to delete; task 6 (session store) wires the real delete.
  ["reset", { description: "hapus riwayat chat", run: () => "Riwayat chat sudah dihapus." }],
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

export function runCommand(command: Command): string {
  const spec = COMMANDS.get(command.name);
  return spec ? spec.run(command.args) : unknownCommandText(command.name);
}

function helpText(): string {
  const lines = [...COMMANDS].map(([name, spec]) => `/${name} - ${spec.description}`);
  return ["Daftar perintah:", ...lines].join("\n");
}

function unknownCommandText(name: string): string {
  const shown = name.length > MAX_SHOWN_NAME ? `${name.slice(0, MAX_SHOWN_NAME)}…` : name;
  return `Perintah /${shown} tidak dikenal. Ketik /help untuk daftar perintah.`;
}
