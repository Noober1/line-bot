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
| `/translate <teks>` | the text translated into your `translate` language (see "Translate") |
| `/config` | shows or changes your own settings (see "User settings") |
| `/elysia <teks>` | talks to the AI like a plain message, with the chat history (in a group: the way to ask without a mention) |

In a group or multi-person chat the AI answers only a message that mentions the bot (type `@` and pick the bot) or starts with `/elysia`. The mention itself is not sent to the AI; `@All` does not count. Other messages are ignored, and do not count toward the rate limit. Commands work as usual. `/elysia` alone, or a bare mention, gets a short usage text.

An unknown command gets `Perintah /<name> tidak dikenal. Ketik /help untuk daftar perintah.`
(in Indonesian; see "Reply language" for the other languages).

## Chat history

Every text sent to the AI (without the bot's mention or the /elysia prefix) and the bot's reply are saved in a SQLite file
(`DATABASE_PATH`, default `bot.sqlite` in the working directory; git-ignored).

- One history per chat: per user in a 1:1 chat, shared by everyone in a group.
- Only the newest 100 messages per chat are kept.
- Commands are not saved. A message whose reply failed is not saved.
- `/reset` deletes the history of the chat it is sent in.

The file holds chat text in plain form. Keep it private and back it up like `.env`.

## AI chat

Any text that is not a command, and `/elysia <teks>` (in a group: see "Commands"), is sent to an AI through
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
- Long answers are split into up to 5 messages of at most 5000 characters (LINE's limits), at a paragraph, line or sentence break when possible.
- Chat text is sent to whatever provider your 9router model or combo uses. Choose accordingly.
- Keep 9router on localhost, or turn on `REQUIRE_API_KEY=true`, and change its default
  dashboard password (`INITIAL_PASSWORD`, default `123456`).

## Limits

- `RATE_LIMIT_PER_MINUTE` (default 10, `0` = off): messages per minute the bot handles per chat
  (a user, or a whole group). The first message over the limit gets a short notice in the sender's
  language; the rest of that minute is ignored. The count resets when the bot restarts.
- Duplicate webhook events (LINE redelivery) are skipped by `webhookEventId`, remembered for 24 h in
  the `seen_events` table. Logged as `Skipped duplicate event <id>`.

## Translate

`/translate <teks>` sends only that text to the AI, with a translate prompt. It uses no chat
history and saves nothing. The target language is your `translate` setting (see "User settings");
in a group, the sender's setting.

```
/translate selamat pagi         -> Good morning   (translate = en)
/translate                      -> usage and your current target language
```

- Text over 1000 characters is refused: `Teks terlalu panjang (maks 1000 karakter).`
- If the AI fails, the bot replies `Gagal menerjemahkan. Coba lagi nanti.` and logs `Translate failed: ...`.
- The text is sent to the same 9router model as AI chat (`AI_MODEL`).

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
| `translate` | ISO 639-1 code (`en`, `id`, `ja`, `ko`, `zh`, ...) | your LINE app language, else `DEFAULT_TRANSLATE_LANG` (`en`) |

Order: your own value > your LINE app language (see "Reply language") > `DEFAULT_TRANSLATE_LANG` > `en`.
LINE does not send a user ID for some group members (for example LINE desktop users);
they get `Pengaturan tidak bisa dipakai: LINE tidak mengirim ID kamu.`

## Reply language

The bot's own texts (`/help`, `/reset`, `/config`, `/translate` usage and errors, `/elysia` usage, unknown command)
come in the sender's LINE app language: `id`, `en`, `ja`, `zh-Hans` or `zh-Hant`. Any other
language, or an unknown one, gets `DEFAULT_REPLY_LANG` (default `id`). AI chat answers are not
affected: the AI answers in the language the user writes in.

- The language comes from LINE's Get profile API, only when a command is sent, and is cached per user
  in SQLite (table `user_languages`) for 7 days.
- Get profile works only for users who added the bot as a friend. In a group, a member who is not a
  friend gets `DEFAULT_REPLY_LANG`. The bot logs `Get profile failed for user <id>: 404 - Not Found`
  and tries again on their next command.
- LINE leaves out the language when the user has not consented to its privacy policy; that user
  also gets `DEFAULT_REPLY_LANG`.
- Each fetch logs `LINE language of user <id>: <tag>` so the mapping can be checked.
  `zh-TW`, `zh-HK`, `zh-MO` and `zh-Hant` map to `zh-Hant`; other `zh` tags map to `zh-Hans`.
- The same LINE language is the default target of `/translate` (see "User settings").
