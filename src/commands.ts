export type Command = { readonly name: string; readonly args: string };

// What a command may act on, bound to the chat the command came from.
export type CommandContext = { readonly resetHistory: () => void };

type CommandSpec = {
  readonly description: string;
  readonly run: (args: string, context: CommandContext) => string;
};

const MAX_SHOWN_NAME = 32;

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
  const shown = name.length > MAX_SHOWN_NAME ? `${name.slice(0, MAX_SHOWN_NAME)}…` : name;
  return `Perintah /${shown} tidak dikenal. Ketik /help untuk daftar perintah.`;
}
