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
commands (see below) get their reply, any other text is answered by the AI (see "AI chat").

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
| `/reset` | clears the chat history of this chat (in a group: the whole group's) |
| `/config` | shows or changes your own settings (see "User settings") |

An unknown command gets `Perintah /<name> tidak dikenal. Ketik /help untuk daftar perintah.`

## Chat history

Every non-command text and the bot's reply are saved in a SQLite file
(`DATABASE_PATH`, default `bot.sqlite` in the working directory; git-ignored).

- One history per chat: per user in a 1:1 chat, shared by everyone in a group.
- Only the newest 100 messages per chat are kept.
- Commands are not saved. A message whose reply failed is not saved.
- `/reset` deletes the history of the chat it is sent in.

The file holds chat text in plain form. Keep it private and back it up like `.env`.

## AI chat

Any text that is not a command is sent to an AI through
[9router](https://github.com/decolua/9router), an OpenAI-compatible gateway
(`POST {AI_BASE_URL}/chat/completions`). The AI gets the newest 20 messages of the
chat plus the new one.

```bash
AI_MODEL=my-combo                         # required: 9router combo or provider/model
AI_BASE_URL=http://localhost:20128/v1     # optional
AI_API_KEY=                               # optional: only if 9router has REQUIRE_API_KEY=true
```

- If the AI fails (9router down, timeout after 40 s, error status, empty answer), the bot
  sends **no reply**, logs `Failed to handle event: ...`, and saves nothing.
- Answers are cut to 4500 characters (LINE's limit is 5000).
- Chat text is sent to whatever provider your 9router model or combo uses. Choose accordingly.
- Keep 9router on localhost, or turn on `REQUIRE_API_KEY=true`, and change its default
  dashboard password (`INITIAL_PASSWORD`, default `123456`).

## User settings

Each user has their own settings, stored in the same SQLite file (table `user_settings`).
In a group, `/config` changes the settings of the person who sends it, never the group's.

```
/config                    list your settings
/config translate ja       set the target language of /translate
/config translate reset    go back to the default
```

| Setting | Values | Default |
|---|---|---|
| `translate` | ISO 639-1 code (`en`, `id`, `ja`, `ko`, `zh`, ...) | `DEFAULT_TRANSLATE_LANG` (`en`); your LINE language once task 7c is done |

Order: your own value > your LINE app language (from task 7c; not used yet) > `DEFAULT_TRANSLATE_LANG` > `en`.
LINE does not send a user ID for some group members (for example LINE desktop users);
they get `Pengaturan tidak bisa dipakai: LINE tidak mengirim ID kamu.`
