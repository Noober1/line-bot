# line-bot

Private LINE bot (Bun + TypeScript + Claude). Task list: `TASKS.md`.

## Setup

```bash
bun install
cp .env.example .env   # then fill in the values
```

## Run

```bash
bun run dev     # watch mode
bun run start
bun test
```

Health check: `GET /health` returns `{"status":"ok"}`.

## Webhook

`POST /webhook` receives LINE events. It checks the `x-line-signature` header
(401 if missing or wrong), returns 200 right away, then answers every text message:
commands (see below) get their reply, any other text is echoed back.

Dev with a real LINE channel:

```bash
bun run dev
bun run tunnel   # cloudflared tunnel --url http://localhost:3000
```

Set `https://<tunnel-host>/webhook` as the Webhook URL in LINE Developers Console
(Messaging API tab), turn on "Use webhook", then press "Verify".

## Allowlist

The bot is private. It only handles events from IDs listed in `.env`:

```bash
ALLOWED_USER_IDS=Uxxxxxxxx,Uyyyyyyyy   # users: allowed in 1:1 chat and in any group
ALLOWED_GROUP_IDS=Cxxxxxxxx,Rxxxxxxxx  # groups and multi-person chats: every member allowed
```

Every other event is dropped without a reply and logged with its IDs (never the
message text), for example `Ignored join event from group Cxxxx (unknown user)`.

- Your own user ID: LINE Developers Console > channel > Basic settings > "Your user ID".
- A group ID: invite the bot to the group, then copy the ID from that log line.

If both lists are empty the bot starts, ignores everything, and prints a warning.
Restart the bot after editing `.env`.

## Commands

A text message that starts with `/` is a command. Names are case-insensitive.

| Command | Reply |
|---|---|
| `/help` | list of commands |
| `/ping` | `pong` |
| `/reset` | clears the chat history (nothing is stored yet) |

An unknown command gets `Perintah /<name> tidak dikenal. Ketik /help untuk daftar perintah.`
