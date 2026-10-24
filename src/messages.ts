import type { Locale } from "./language";
import type { SettingKey } from "./settings";

export type CommandName = "help" | "ping" | "reset" | "translate" | "config" | "elysia";

// The bot's own reply texts. AI answers are not here: the AI picks the user's language itself.
export type Messages = {
  readonly commandsTitle: string;
  readonly commandDescriptions: Readonly<Record<CommandName, string>>;
  readonly historyCleared: string;
  readonly unknownCommand: (name: string) => string;
  readonly translateUsage: (language: string) => string;
  readonly translateTooLong: (max: number) => string;
  readonly translateFailed: string;
  readonly settingsUnavailable: string;
  readonly settingsTitle: string;
  readonly settingDescriptions: Readonly<Record<SettingKey, string>>;
  readonly settingHints: Readonly<Record<SettingKey, string>>;
  // Appended to a value that is not the user's own.
  readonly defaultMark: string;
  readonly valueLabel: string;
  readonly settingsChangeHelp: string;
  readonly settingsResetHelp: (resetValue: string) => string;
  readonly unknownSetting: (name: string) => string;
  readonly settingUsage: (key: string, hint: string) => string;
  readonly settingReset: (key: string, value: string) => string;
  readonly invalidValue: (value: string, key: string, hint: string) => string;
  readonly settingChanged: (key: string, value: string) => string;
  // Sent once when a chat goes over RATE_LIMIT_PER_MINUTE; later messages in that minute get no reply.
  readonly rateLimited: string;
  // /elysia without text, or a group message that only mentions the bot.
  readonly elysiaUsage: string;
  // /config in a group or room: LINE has no private reply there and a push DM costs quota.
  readonly configInGroup: string;
};

const id: Messages = {
  commandsTitle: "Daftar perintah:",
  commandDescriptions: {
    help: "tampilkan daftar perintah",
    ping: "cek apakah bot aktif",
    reset: "hapus riwayat chat",
    translate: "terjemahkan teks ke bahasa pilihan kamu (atur: /config translate)",
    config: "lihat atau ubah pengaturan kamu",
    elysia: "tanya AI (di grup: pengganti mention bot)",
  },
  historyCleared: "Riwayat chat sudah dihapus.",
  unknownCommand: (name) => `Perintah /${name} tidak dikenal. Ketik /help untuk daftar perintah.`,
  translateUsage: (language) =>
    `Pakai: /translate <teks>. Bahasa tujuan kamu: ${language}. Ubah: /config translate <kode>.`,
  translateTooLong: (max) => `Teks terlalu panjang (maks ${max} karakter).`,
  translateFailed: "Gagal menerjemahkan. Coba lagi nanti.",
  settingsUnavailable: "Pengaturan tidak bisa dipakai: LINE tidak mengirim ID kamu.",
  settingsTitle: "Pengaturan kamu:",
  settingDescriptions: { translate: "bahasa tujuan /translate" },
  settingHints: { translate: "kode bahasa ISO 639-1, mis. en, id, ja, ko, zh" },
  defaultMark: " (bawaan)",
  valueLabel: "nilai",
  settingsChangeHelp: "Ubah: /config <nama> <nilai>",
  settingsResetHelp: (resetValue) => `Kembali ke bawaan: /config <nama> ${resetValue}`,
  unknownSetting: (name) => `Pengaturan ${name} tidak dikenal. Ketik /config untuk daftar pengaturan.`,
  settingUsage: (key, hint) => `Pakai: /config ${key} <nilai>. Nilai: ${hint}.`,
  settingReset: (key, value) => `${key} kembali ke bawaan: ${value}.`,
  invalidValue: (value, key, hint) => `Nilai ${value} tidak valid untuk ${key}. Pakai ${hint}.`,
  settingChanged: (key, value) => `${key} diubah ke ${value}.`,
  rateLimited: "Pesannya terlalu banyak. Tunggu sebentar lalu coba lagi.",
  elysiaUsage: "Pakai: /elysia <pesan>. Di grup, bisa juga mention bot lalu tulis pesannya.",
  configInGroup: "Ganti pengaturan lewat chat pribadi (DM) dengan bot aja, jangan di grup.",
};

const en: Messages = {
  commandsTitle: "Commands:",
  commandDescriptions: {
    help: "show the list of commands",
    ping: "check that the bot is up",
    reset: "clear the chat history",
    translate: "translate text into your chosen language (set it: /config translate)",
    config: "view or change your settings",
    elysia: "ask the AI (in a group: instead of mentioning the bot)",
  },
  historyCleared: "Chat history cleared.",
  unknownCommand: (name) => `Unknown command /${name}. Type /help for the list of commands.`,
  translateUsage: (language) =>
    `Usage: /translate <text>. Your target language: ${language}. Change it: /config translate <code>.`,
  translateTooLong: (max) => `Text too long (max ${max} characters).`,
  translateFailed: "Translation failed. Please try again later.",
  settingsUnavailable: "Settings are unavailable: LINE did not send your ID.",
  settingsTitle: "Your settings:",
  settingDescriptions: { translate: "target language of /translate" },
  settingHints: { translate: "ISO 639-1 language code, e.g. en, id, ja, ko, zh" },
  defaultMark: " (default)",
  valueLabel: "value",
  settingsChangeHelp: "Change: /config <name> <value>",
  settingsResetHelp: (resetValue) => `Back to default: /config <name> ${resetValue}`,
  unknownSetting: (name) => `Unknown setting ${name}. Type /config for the list of settings.`,
  settingUsage: (key, hint) => `Usage: /config ${key} <value>. Value: ${hint}.`,
  settingReset: (key, value) => `${key} is back to the default: ${value}.`,
  invalidValue: (value, key, hint) => `Value ${value} is not valid for ${key}. Use ${hint}.`,
  settingChanged: (key, value) => `${key} changed to ${value}.`,
  rateLimited: "Too many messages. Please wait a moment and try again.",
  elysiaUsage: "Usage: /elysia <message>. In a group you can also mention the bot and write your message.",
  configInGroup: "Change your settings in a private chat (DM) with the bot, not in a group.",
};

const ja: Messages = {
  commandsTitle: "コマンド一覧:",
  commandDescriptions: {
    help: "コマンド一覧を表示",
    ping: "ボットが動いているか確認",
    reset: "チャット履歴を削除",
    translate: "テキストを指定の言語に翻訳（設定: /config translate）",
    config: "自分の設定を表示・変更",
    elysia: "AI に質問（グループではボットへのメンションの代わり）",
  },
  historyCleared: "チャット履歴を削除しました。",
  unknownCommand: (name) => `/${name} は不明なコマンドです。/help でコマンド一覧を表示できます。`,
  translateUsage: (language) =>
    `使い方: /translate <テキスト>。翻訳先の言語: ${language}。変更: /config translate <コード>。`,
  translateTooLong: (max) => `テキストが長すぎます（最大 ${max} 文字）。`,
  translateFailed: "翻訳に失敗しました。しばらくしてからもう一度お試しください。",
  settingsUnavailable: "設定を利用できません: LINE からユーザー ID が送られていません。",
  settingsTitle: "あなたの設定:",
  settingDescriptions: { translate: "/translate の翻訳先の言語" },
  settingHints: { translate: "ISO 639-1 の言語コード（例: en, id, ja, ko, zh）" },
  defaultMark: "（既定）",
  valueLabel: "値",
  settingsChangeHelp: "変更: /config <名前> <値>",
  settingsResetHelp: (resetValue) => `既定に戻す: /config <名前> ${resetValue}`,
  unknownSetting: (name) => `設定 ${name} は存在しません。/config で設定一覧を表示できます。`,
  settingUsage: (key, hint) => `使い方: /config ${key} <値>。値: ${hint}。`,
  settingReset: (key, value) => `${key} を既定値に戻しました: ${value}。`,
  invalidValue: (value, key, hint) => `${value} は ${key} に使えない値です。${hint} を指定してください。`,
  settingChanged: (key, value) => `${key} を ${value} に変更しました。`,
  rateLimited: "メッセージが多すぎます。少し待ってからもう一度お試しください。",
  elysiaUsage: "使い方: /elysia <メッセージ>。グループではボットをメンションしてメッセージを書くこともできます。",
  configInGroup: "設定の変更はグループではなく、ボットとの個別チャットで行ってください。",
};

const zhHans: Messages = {
  commandsTitle: "指令列表：",
  commandDescriptions: {
    help: "显示指令列表",
    ping: "检查机器人是否在线",
    reset: "清除聊天记录",
    translate: "将文字翻译成你选择的语言（设置：/config translate）",
    config: "查看或更改你的设置",
    elysia: "向 AI 提问（群组中可代替 @机器人）",
  },
  historyCleared: "聊天记录已清除。",
  unknownCommand: (name) => `未知指令 /${name}。输入 /help 查看指令列表。`,
  translateUsage: (language) => `用法：/translate <文字>。你的目标语言：${language}。更改：/config translate <代码>。`,
  translateTooLong: (max) => `文字太长（最多 ${max} 个字符）。`,
  translateFailed: "翻译失败，请稍后再试。",
  settingsUnavailable: "无法使用设置：LINE 没有发送你的 ID。",
  settingsTitle: "你的设置：",
  settingDescriptions: { translate: "/translate 的目标语言" },
  settingHints: { translate: "ISO 639-1 语言代码，例如 en、id、ja、ko、zh" },
  defaultMark: "（默认）",
  valueLabel: "值",
  settingsChangeHelp: "更改：/config <名称> <值>",
  settingsResetHelp: (resetValue) => `恢复默认：/config <名称> ${resetValue}`,
  unknownSetting: (name) => `未知设置 ${name}。输入 /config 查看设置列表。`,
  settingUsage: (key, hint) => `用法：/config ${key} <值>。值：${hint}。`,
  settingReset: (key, value) => `${key} 已恢复默认：${value}。`,
  invalidValue: (value, key, hint) => `${value} 不是 ${key} 的有效值。请使用${hint}。`,
  settingChanged: (key, value) => `${key} 已更改为 ${value}。`,
  rateLimited: "消息太多了，请稍等片刻再试。",
  elysiaUsage: "用法：/elysia <消息>。在群组中也可以 @机器人 后输入消息。",
  configInGroup: "请在与机器人的私聊中更改设置，不要在群组中更改。",
};

const zhHant: Messages = {
  commandsTitle: "指令列表：",
  commandDescriptions: {
    help: "顯示指令列表",
    ping: "檢查機器人是否在線",
    reset: "清除聊天記錄",
    translate: "將文字翻譯成你選擇的語言（設定：/config translate）",
    config: "查看或變更你的設定",
    elysia: "向 AI 提問（群組中可代替 @機器人）",
  },
  historyCleared: "聊天記錄已清除。",
  unknownCommand: (name) => `未知指令 /${name}。輸入 /help 查看指令列表。`,
  translateUsage: (language) => `用法：/translate <文字>。你的目標語言：${language}。變更：/config translate <代碼>。`,
  translateTooLong: (max) => `文字太長（最多 ${max} 個字元）。`,
  translateFailed: "翻譯失敗，請稍後再試。",
  settingsUnavailable: "無法使用設定：LINE 沒有傳送你的 ID。",
  settingsTitle: "你的設定：",
  settingDescriptions: { translate: "/translate 的目標語言" },
  settingHints: { translate: "ISO 639-1 語言代碼，例如 en、id、ja、ko、zh" },
  defaultMark: "（預設）",
  valueLabel: "值",
  settingsChangeHelp: "變更：/config <名稱> <值>",
  settingsResetHelp: (resetValue) => `恢復預設：/config <名稱> ${resetValue}`,
  unknownSetting: (name) => `未知設定 ${name}。輸入 /config 查看設定列表。`,
  settingUsage: (key, hint) => `用法：/config ${key} <值>。值：${hint}。`,
  settingReset: (key, value) => `${key} 已恢復預設：${value}。`,
  invalidValue: (value, key, hint) => `${value} 不是 ${key} 的有效值。請使用${hint}。`,
  settingChanged: (key, value) => `${key} 已變更為 ${value}。`,
  rateLimited: "訊息太多了，請稍候再試。",
  elysiaUsage: "用法：/elysia <訊息>。在群組中也可以 @機器人 後輸入訊息。",
  configInGroup: "請在與機器人的私聊中變更設定，不要在群組中變更。",
};

export const MESSAGES: Readonly<Record<Locale, Messages>> = { id, en, ja, "zh-Hans": zhHans, "zh-Hant": zhHant };
