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
(401 if missing or wrong; bodies over 1 MB get 413 from Bun first, see `MAX_REQUEST_BODY_BYTES` in `src/app.ts`), returns 200 right away, then answers every text message:
commands (see below) get their reply, any other text, and an image the owner sends in a 1:1 chat, is answered by the AI (see "AI chat").

Dev with a real LINE channel:

```bash
bun run dev
bun run tunnel   # cloudflared tunnel --url http://localhost:3000
```

Set `https://<tunnel-host>/webhook` as the Webhook URL in LINE Developers Console
(Messaging API tab), turn on "Use webhook", then press "Verify".

## Access

The bot works in groups that were allowed, and keeps their status in SQLite (table `groups`).
Nothing is listed in `.env`, and nothing needs a restart.

1. Add the bot to a group. It replies once: mention the bot, then allow the group in a DM.
2. The first member who mentions the bot (or sends a `/` command) becomes the group's requester.
   LINE does not tell the bot who invited it, so whoever adds the bot should mention it right away.
   The bot answers `notPermitted` (at most once per 10 minutes per group) until the group is allowed.
   LINE for PC sends no user ID: such a member is asked to let a phone user mention the bot.
3. The requester DMs the bot: `/groups` shows the group ID, `/approve <id>` allows it.
   The requester becomes the group's admin. One user can be admin of at most `MAX_GROUPS_PER_USER` (default 3) groups.
4. Every member of an allowed group can use the bot as usual (mention, `/elysia`, commands).

| Command (DM only) | Who | Effect |
|---|---|---|
| `/groups` | anyone | your groups (owner: all), as `#<id> <status> <name>` |
| `/approve <id>` | requester, owner | pending -> allowed (owner: also denied -> allowed) |
| `/deny <id>` | admin | allowed -> pending (approve again later) |
| `/deny <id>` | owner | -> denied: the bot stays silent in that group (the owner still passes) |
| `/admin <id> <userId\|reset>` | owner | sets or clears the group's requester and admin |
| `/groupconfig <id> [...]` | admin, owner | group settings (see "User settings") |

Wrong IDs, other people's groups and impossible changes all get the same error.

- When the owner talks to the bot in a group that is new, pending or left, that group is allowed at once and the
  owner becomes its admin (use `/admin <id> <userId>` to hand it over). Allowed groups keep their admin; denied stay denied.
- `OWNER_USER_ID` (optional): the operator. Passes in every group, sees and manages all groups, and is the only user
  who can chat with the AI in a DM. Everyone else gets only the commands above plus `/config`, `/help` and `/ping` in a DM.
- When the bot is removed from a group, the group becomes `left` (settings and admin are kept); adding it again
  needs a new `/approve`.
- Multi-person chats (rooms) are not supported and are ignored.
- `ALLOWED_USER_IDS` and `ALLOWED_GROUP_IDS` are no longer used; the bot warns at startup if one is still set.

## Commands

A text message that starts with `/` is a command. Names are case-insensitive.

| Command | Reply |
|---|---|
| `/help` | list of commands |
| `/ping` | `pong` |
| `/reset` | clears the chat history of this chat (in a group: the whole group's) |
| `/translate <teks>` | the text translated into your `translate` language (see "Translate") |
| `/auto-translate` | in a group: turns auto-translate on or off for you in that group (see below). In a DM: refused, groups only |
| `/config` | shows or changes your own settings (see "User settings") |
| `/elysia <teks>` | talks to the AI like a plain message, with the chat history (in a group: the way to ask without a mention) |
| `/groupconfig [...]` | in a group: the group's settings, admin and owner only (see "User settings") |
| `/groups`, `/approve`, `/deny`, `/admin` | DM only, see "Access" |

**Cards.** In a 1:1 chat `/help`, `/groups`, a bare `/config` and an AI answer over 600 characters are sent as a
Flex Message card (title plus rows or paragraphs), and a bare `/config` also shows the common translate
languages as quick reply buttons (a tap sends `/config translate <code>`; the last button resets it). Every card
has an `altText` with the whole text (cut to LINE's 400 characters), which is what notifications and quotes show.
A text that has no body, or whose card would pass 25 KB, is sent as plain text. LINE's Flex Message has no
quote token, so a card does **not** quote the user's message; that is why groups keep plain quoted text for
everything, and why a reply with mentions (translate) stays a quoted text v2 message.

In an allowed group the AI answers only a message that mentions the bot (type `@` and pick the bot) or starts with `/elysia`. The mention itself is not sent to the AI; `@All` does not count. Other messages are ignored, and do not count toward the rate limit (except those of a member with auto-translate on, see below). Commands work as usual. `/elysia` alone, or a bare mention, gets a short usage text.

`/auto-translate` (allowed groups only) flips a switch for the sender in that group. While it is on, every
plain text message of that sender in that group is translated into their `translate` language (same order as
`/translate`: your setting, the group's, your LINE language, the default) and answered as a quoted reply.
Commands and messages that mention the bot take their usual path. A message already in the target language
gets no reply (the AI answers `NOOP`, which is not sent). Translations use no chat history and save nothing,
count toward the group's rate limit, and stay silent when it is used up, when the AI fails (logged), or for
texts over 1000 characters. Only your own messages are translated, one way; the switch is kept in the
`auto_translate` table.

Both `/translate` and auto-translate accept a leading `*instruction*` block (e.g. `*sopan, ke atasan* selamat pagi`)
that sets the style or context of that message (in auto-translate it also stays for your following messages in
that group until a new instruction replaces it or you switch off); the instruction counts toward the 1000 characters, and an
empty or unclosed block is translated as plain text. Mentions of other users are kept: the bot sends the answer
as a text v2 message that mentions them again (users LINE gave no ID for stay plain `@Name` text). While
auto-translate is on, the bot keeps your last 3 translated messages in this group, in memory only (lost on
restart, cleared when you switch off), and sends them to the AI as context for short or ambiguous texts.
Other members' messages are never stored.

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
AI_BASE_URL=http://localhost:20128/v1     # optional; https://, or http:// only on localhost, 127.0.0.1 or [::1]
AI_API_KEY=                               # optional: only if 9router has REQUIRE_API_KEY=true
```

- Persona: the system prompt is the persona plus fixed rules. Persona source, first match wins: `PERSONA_PROMPT`
  (env), the file `PERSONA_FILE` (default `SOUL.md` in the working directory, optional), the built-in "Elysia"
  (calls itself *aku* and the user *kamu*). Max 4000 characters; a longer persona, or a `PERSONA_FILE` that is set
  but missing or empty, stops the bot at startup. The rules after the persona cannot be replaced: reply in the
  user's language, plain LINE text without Markdown, refuse content that breaks norms or law or attacks people
  over ethnicity, religion, race or group (SARA), say it is an AI when asked. In a group the bot also answers as
  briefly as possible (one to three sentences); in a 1:1 chat it does not. `/translate` and auto-translate
  have their own prompts and ignore the persona. The startup log shows the source and length (`persona=file chars=120`), never the text.
  Example `SOUL.md`: `You are Elysia, a cheerful assistant who ends answers with "nyaa".`
- If the AI fails (9router down, error status, empty answer) or times out (40 s), the bot replies with a
  short apology in the sender's language (a different one for a timeout), logs `ai chat failed` with the
  error, and saves nothing. Only auto-translate stays silent on an AI failure (it is not a request to the bot).
- In a 1:1 chat the bot shows LINE's loading animation (40 s, ends with the bot's next message) while the AI
  works on a chat message or `/translate`. Groups have none: LINE only offers it in 1:1 chats. It shows only
  while the user is looking at the chat, and a failed request for it is logged (`loading animation failed`)
  and ignored.
- Images (1:1 chat, owner only): a photo is downloaded from LINE (`api-data.line.me`, max 5 MB, JPEG/PNG/WebP/GIF, 10 s)
  and sent to `AI_MODEL` with a short "describe this" prompt in the sender's LINE language; the answer is quoted.
  Ask your question first, then send the photo: the question is in the history. `AI_MODEL` must accept images
  (vision); otherwise the bot answers with the usual AI-failure text. The image is never stored or logged: the history keeps
  `[image]` plus the answer. Images in a group are ignored (LINE sends no mention with an image); other users get the
  DM notice. An image from an external provider, too large or in another format gets a short "could not read" reply.
- Long answers are split into up to 5 messages of at most 5000 characters (LINE's limits), at a paragraph, line or sentence break when possible.
- Every reply to a text message quotes that message (LINE quote); a split answer quotes it in the first part only. The join notice is not a quote.
- Chat text is sent to whatever provider your 9router model or combo uses. Choose accordingly.
- `AI_BASE_URL` must use `https://`; plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`
  (otherwise the bot stops at startup with `Invalid AI_BASE_URL`). A 9router on another machine needs HTTPS in front,
  except in development: with `APP_ENV=development` in `.env`, `http://` is accepted for any host (e.g. a Tailscale address). Never set it in production.
- Keep 9router on localhost, or turn on `REQUIRE_API_KEY=true`, and change its default
  dashboard password (`INITIAL_PASSWORD`, default `123456`).

## Limits

- `RATE_LIMIT_PER_MINUTE` (default 10, `0` = off): messages per minute the bot handles per chat
  (a user, or a whole group). The first message over the limit gets a short notice in the sender's
  language; the rest of that minute is ignored. The count resets when the bot restarts.
- Duplicate webhook events (LINE redelivery) are skipped by `webhookEventId`, remembered for 24 h in
  the `seen_events` table. Logged as `duplicate event skipped`.

## Logging

The terminal (and `journalctl` under systemd) gets one line per thing that happens, in the form
`HH:MM:SS.mmm LEVEL [scope] message key=value ...`. `LOG_LEVEL` (`debug`, `info` default, `warn`, `error`) sets
the lowest level printed; colors appear only on a TTY (`NO_COLOR` turns them off). At startup the bot prints
its config (model, AI base URL, `APP_ENV`, log level, limits, whether an owner is set, database path; no
secrets). Each `POST /webhook` gets a line (event count, status 200/400/401, duration); `/health` is not
logged, and Bun's own 413 for an oversized body happens before the bot's code runs, so it is not logged.

Every event gets a short ID (first 8 characters of `webhookEventId`) that is on all its lines
(`ev=01ABCDEF`): `event` (type, source, message kind), the decision (`command`, `ai chat`, `auto-translate`,
`ignored: ...`, `rate limited`), `ai answered` (messages sent, chars, ms), `reply sent` (parts, chars, quote,
mentions, ms) and `done` (ms). Failures are `ai failed` / `reply failed` (warn) and `event failed` (error with
stack). Message text and AI answers are **never** logged at `info`, only their length; at `debug` the text
appears, cut to 200 characters, together with full LINE IDs (shortened to 8 characters otherwise). The channel
secret, the access token and `AI_API_KEY` are replaced by `***` wherever they would appear in a log line.
A plain chat message in a group the bot ignores is logged at `debug` only.

## Translate

`/translate <teks>` sends only that text to the AI, with a translate prompt. It uses no chat
history and saves nothing. The target language is your `translate` setting (see "User settings");
in a group, the sender's setting, else the group's setting (`/groupconfig`).

```
/translate selamat pagi         -> Good morning   (translate = en)
/translate                      -> usage and your current target language
```

- Text over 1000 characters is refused: `Teks terlalu panjang (maks 1000 karakter).`
- If the AI fails, the bot replies `Gagal menerjemahkan. Coba lagi nanti.` and logs `Translate failed: ...`.
- The text is sent to the same 9router model as AI chat (`AI_MODEL`).

## User settings

Each user has their own settings, stored in the same SQLite file (table `user_settings`).
In a group, `/config` is refused: change your own settings in a DM with the bot.

```
/config                    list your settings
/config translate ja       set the target language of /translate
/config translate reset    go back to the default
```

A group has its own settings (table `group_settings`), changed by its admin or the owner:

```
/groupconfig                       in the group: list or change, same format as /config
/groupconfig <id> translate ja     in a DM, with the ID from /groups
```

| Setting | Values | Default |
|---|---|---|
| `translate` | ISO 639-1 code (`en`, `id`, `ja`, `ko`, `zh`, ...) | your LINE app language, else `DEFAULT_TRANSLATE_LANG` (`en`) |

Order: your own value > the group's value (in that group) > your LINE app language (see "Reply language") > `DEFAULT_TRANSLATE_LANG` > `en`.
LINE does not send a user ID for some group members (for example LINE desktop users);
they get `Pengaturan tidak bisa dipakai: LINE tidak mengirim ID kamu.`

## Reply language

The bot's own texts (`/help`, `/reset`, `/config`, `/translate` usage and errors, `/elysia` usage, unknown command)
come in the sender's LINE app language: `id`, `en`, `ja`, `zh-Hans` or `zh-Hant`. Any other
language, or an unknown one, gets `DEFAULT_REPLY_LANG` (default `id`). AI chat answers are not
affected: the AI answers in the language the user writes in.

- The language comes from LINE's Get profile API, only when a command is sent, and is cached per user
  in SQLite (table `user_languages`) for 7 days.
- Get profile works for friends of the bot and for users who sent it a message without adding it; not for users who
  blocked it. Then the user gets `DEFAULT_REPLY_LANG`, the bot logs `Get profile failed for user <id>: ...`
  and tries again on their next command.
- LINE leaves out the language when the user has not consented to its privacy policy; that user
  also gets `DEFAULT_REPLY_LANG`.
- Each fetch logs `LINE language of user <id>: <tag>` so the mapping can be checked.
  `zh-TW`, `zh-HK`, `zh-MO` and `zh-Hant` map to `zh-Hant`; other `zh` tags map to `zh-Hans`.
- The same LINE language is the default target of `/translate` (see "User settings").
