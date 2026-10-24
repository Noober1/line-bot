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
  readonly settingsChangeHelp: (command: string) => string;
  readonly settingsResetHelp: (command: string, resetValue: string) => string;
  readonly unknownSetting: (name: string, command: string) => string;
  readonly settingUsage: (command: string, key: string, hint: string) => string;
  readonly settingReset: (key: string, value: string) => string;
  readonly invalidValue: (value: string, key: string, hint: string) => string;
  readonly settingChanged: (key: string, value: string) => string;
  // Sent once when a chat goes over RATE_LIMIT_PER_MINUTE; later messages in that minute get no reply.
  readonly rateLimited: string;
  // /elysia without text, or a group message that only mentions the bot.
  readonly elysiaUsage: string;
  // /config in a group: LINE has no private reply there and a push DM costs quota.
  readonly configInGroup: string;
  // Join event reply: there is no user ID, so it comes in DEFAULT_REPLY_LANG.
  readonly joinNotice: string;
  // A message to the bot in a group that is not allowed (at most once per NOT_PERMITTED_NOTICE_MS per group).
  readonly notPermitted: (id: number) => string;
  // Same, when LINE sent no user ID (e.g. LINE for PC).
  readonly unknownSender: string;
  // A 1:1 message from anyone but the owner that is not one of the DM commands.
  readonly dmGroupsOnly: string;
  readonly groupsTitle: string;
  readonly groupsEmpty: string;
  // Unknown ID, someone else's group, or an impossible change: one text, so other people's groups are not revealed.
  readonly groupNotFound: string;
  readonly groupIdUsage: (usage: string) => string;
  readonly groupApproved: (id: number) => string;
  readonly groupLimitReached: (max: number) => string;
  readonly groupRevoked: (id: number) => string;
  readonly groupDenied: (id: number) => string;
  readonly adminSet: (id: number, userId: string) => string;
  readonly adminCleared: (id: number) => string;
  readonly groupSettingsTitle: string;
  readonly groupConfigNotAdmin: string;
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
  settingsChangeHelp: (command) => `Ubah: ${command} <nama> <nilai>`,
  settingsResetHelp: (command, resetValue) => `Kembali ke bawaan: ${command} <nama> ${resetValue}`,
  unknownSetting: (name, command) => `Pengaturan ${name} tidak dikenal. Ketik ${command} untuk daftar pengaturan.`,
  settingUsage: (command, key, hint) => `Pakai: ${command} ${key} <nilai>. Nilai: ${hint}.`,
  settingReset: (key, value) => `${key} kembali ke bawaan: ${value}.`,
  invalidValue: (value, key, hint) => `Nilai ${value} tidak valid untuk ${key}. Pakai ${hint}.`,
  settingChanged: (key, value) => `${key} diubah ke ${value}.`,
  rateLimited: "Pesannya terlalu banyak. Tunggu sebentar lalu coba lagi.",
  elysiaUsage: "Pakai: /elysia <pesan>. Di grup, bisa juga mention bot lalu tulis pesannya.",
  configInGroup: "Ganti pengaturan kamu lewat chat pribadi (DM) dengan bot, jangan di grup. Admin grup: pengaturan grup pakai /groupconfig.",
  joinNotice: "Halo! Bot ini perlu diizinkan dulu di grup ini. Yang menambahkan bot: mention bot di sini, lalu DM bot dan ketik /groups, lalu /approve <id>.",
  notPermitted: (id) => `Bot belum diizinkan di grup ini (grup #${id}). Yang pertama menyapa bot di sini bisa DM bot lalu ketik /approve ${id}.`,
  unknownSender: "Bot belum diizinkan di grup ini. LINE tidak mengirim ID kamu (mis. LINE PC), jadi minta anggota lain yang pakai LINE di HP untuk mention bot.",
  dmGroupsOnly: "Di chat pribadi, bot cuma untuk mengatur grup dan pengaturanmu: /groups, /approve <id>, /deny <id>, /groupconfig <id>, /config. Ngobrol dengan AI di grup yang sudah diizinkan (mention bot atau /elysia).",
  groupsTitle: "Daftar grup:",
  groupsEmpty: "Belum ada grup. Tambahkan bot ke grup, mention bot di sana, lalu ketik /groups lagi.",
  groupNotFound: "Grup itu tidak ada, bukan punya kamu, atau statusnya tidak bisa diubah begitu. Cek /groups.",
  groupIdUsage: (usage) => `Pakai: ${usage}. ID grup ada di /groups.`,
  groupApproved: (id) => `Grup #${id} sudah diizinkan. Mention bot di grup itu untuk mulai.`,
  groupLimitReached: (max) => `Kamu sudah jadi admin di ${max} grup (batas maksimal). Cabut salah satu dulu dengan /deny <id>.`,
  groupRevoked: (id) => `Izin grup #${id} dicabut. Grup itu kembali menunggu /approve.`,
  groupDenied: (id) => `Grup #${id} ditolak. Bot diam di grup itu sampai di-approve owner lagi.`,
  adminSet: (id, userId) => `Admin grup #${id} sekarang ${userId}.`,
  adminCleared: (id) => `Admin dan pengaju grup #${id} dikosongkan.`,
  groupSettingsTitle: "Pengaturan grup:",
  groupConfigNotAdmin: "Pengaturan grup cuma bisa diubah admin grup ini.",
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
  settingsChangeHelp: (command) => `Change: ${command} <name> <value>`,
  settingsResetHelp: (command, resetValue) => `Back to default: ${command} <name> ${resetValue}`,
  unknownSetting: (name, command) => `Unknown setting ${name}. Type ${command} for the list of settings.`,
  settingUsage: (command, key, hint) => `Usage: ${command} ${key} <value>. Value: ${hint}.`,
  settingReset: (key, value) => `${key} is back to the default: ${value}.`,
  invalidValue: (value, key, hint) => `Value ${value} is not valid for ${key}. Use ${hint}.`,
  settingChanged: (key, value) => `${key} changed to ${value}.`,
  rateLimited: "Too many messages. Please wait a moment and try again.",
  elysiaUsage: "Usage: /elysia <message>. In a group you can also mention the bot and write your message.",
  configInGroup: "Change your settings in a private chat (DM) with the bot, not in a group. Group admin: use /groupconfig for the group's settings.",
  joinNotice: "Hi! This bot needs to be allowed in this group first. Whoever added the bot: mention the bot here, then DM the bot and type /groups, then /approve <id>.",
  notPermitted: (id) => `The bot is not allowed in this group yet (group #${id}). The first person who talked to the bot here can DM the bot and type /approve ${id}.`,
  unknownSender: "The bot is not allowed in this group yet. LINE did not send your ID (e.g. LINE for PC), so ask another member using LINE on a phone to mention the bot.",
  dmGroupsOnly: "In a private chat the bot only manages groups and your settings: /groups, /approve <id>, /deny <id>, /groupconfig <id>, /config. Chat with the AI in an allowed group (mention the bot or use /elysia).",
  groupsTitle: "Groups:",
  groupsEmpty: "No groups yet. Add the bot to a group, mention it there, then type /groups again.",
  groupNotFound: "That group does not exist, is not yours, or cannot be changed that way. Check /groups.",
  groupIdUsage: (usage) => `Usage: ${usage}. Group IDs are in /groups.`,
  groupApproved: (id) => `Group #${id} is now allowed. Mention the bot in that group to start.`,
  groupLimitReached: (max) => `You are already the admin of ${max} groups (the maximum). Revoke one first with /deny <id>.`,
  groupRevoked: (id) => `Group #${id} is no longer allowed. It is waiting for /approve again.`,
  groupDenied: (id) => `Group #${id} is denied. The bot stays silent there until the owner approves it again.`,
  adminSet: (id, userId) => `The admin of group #${id} is now ${userId}.`,
  adminCleared: (id) => `The admin and requester of group #${id} are cleared.`,
  groupSettingsTitle: "Group settings:",
  groupConfigNotAdmin: "Only this group's admin can change the group settings.",
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
  settingsChangeHelp: (command) => `変更: ${command} <名前> <値>`,
  settingsResetHelp: (command, resetValue) => `既定に戻す: ${command} <名前> ${resetValue}`,
  unknownSetting: (name, command) => `設定 ${name} は存在しません。${command} で設定一覧を表示できます。`,
  settingUsage: (command, key, hint) => `使い方: ${command} ${key} <値>。値: ${hint}。`,
  settingReset: (key, value) => `${key} を既定値に戻しました: ${value}。`,
  invalidValue: (value, key, hint) => `${value} は ${key} に使えない値です。${hint} を指定してください。`,
  settingChanged: (key, value) => `${key} を ${value} に変更しました。`,
  rateLimited: "メッセージが多すぎます。少し待ってからもう一度お試しください。",
  elysiaUsage: "使い方: /elysia <メッセージ>。グループではボットをメンションしてメッセージを書くこともできます。",
  configInGroup: "自分の設定の変更はグループではなく、ボットとの個別チャットで行ってください。グループの管理者は /groupconfig でグループの設定を変更できます。",
  joinNotice: "こんにちは！このグループでボットを使うには許可が必要です。ボットを追加した人は、ここでボットをメンションしてから、ボットとの個別チャットで /groups と入力し、/approve <id> を送ってください。",
  notPermitted: (id) => `このグループではまだボットが許可されていません（グループ #${id}）。ここで最初にボットに話しかけた人が、ボットとの個別チャットで /approve ${id} を送ってください。`,
  unknownSender: "このグループではまだボットが許可されていません。LINE からあなたの ID が送られていません（PC 版 LINE など）。スマートフォンの LINE を使っている他のメンバーにボットをメンションしてもらってください。",
  dmGroupsOnly: "個別チャットではグループの管理と自分の設定のみできます: /groups、/approve <id>、/deny <id>、/groupconfig <id>、/config。AI との会話は許可済みのグループで（ボットをメンションするか /elysia）。",
  groupsTitle: "グループ一覧:",
  groupsEmpty: "グループはまだありません。ボットをグループに追加してメンションしてから、もう一度 /groups と入力してください。",
  groupNotFound: "そのグループは存在しないか、あなたのグループではないか、その操作はできません。/groups で確認してください。",
  groupIdUsage: (usage) => `使い方: ${usage}。グループ ID は /groups で確認できます。`,
  groupApproved: (id) => `グループ #${id} を許可しました。そのグループでボットをメンションして始めてください。`,
  groupLimitReached: (max) => `すでに ${max} グループの管理者です（上限）。先に /deny <id> でどれかを取り消してください。`,
  groupRevoked: (id) => `グループ #${id} の許可を取り消しました。再び /approve 待ちになります。`,
  groupDenied: (id) => `グループ #${id} を拒否しました。オーナーが再び許可するまで、ボットはそのグループで反応しません。`,
  adminSet: (id, userId) => `グループ #${id} の管理者を ${userId} にしました。`,
  adminCleared: (id) => `グループ #${id} の管理者と申請者を解除しました。`,
  groupSettingsTitle: "グループの設定:",
  groupConfigNotAdmin: "グループの設定を変更できるのはこのグループの管理者だけです。",
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
  settingsChangeHelp: (command) => `更改：${command} <名称> <值>`,
  settingsResetHelp: (command, resetValue) => `恢复默认：${command} <名称> ${resetValue}`,
  unknownSetting: (name, command) => `未知设置 ${name}。输入 ${command} 查看设置列表。`,
  settingUsage: (command, key, hint) => `用法：${command} ${key} <值>。值：${hint}。`,
  settingReset: (key, value) => `${key} 已恢复默认：${value}。`,
  invalidValue: (value, key, hint) => `${value} 不是 ${key} 的有效值。请使用${hint}。`,
  settingChanged: (key, value) => `${key} 已更改为 ${value}。`,
  rateLimited: "消息太多了，请稍等片刻再试。",
  elysiaUsage: "用法：/elysia <消息>。在群组中也可以 @机器人 后输入消息。",
  configInGroup: "请在与机器人的私聊中更改你的设置，不要在群组中更改。群组管理员：请用 /groupconfig 更改群组设置。",
  joinNotice: "你好！需要先允许机器人在此群组中使用。添加机器人的人：请在这里 @机器人，然后私聊机器人输入 /groups，再输入 /approve <id>。",
  notPermitted: (id) => `机器人尚未获准在此群组使用（群组 #${id}）。第一个在这里和机器人说话的人可以私聊机器人并输入 /approve ${id}。`,
  unknownSender: "机器人尚未获准在此群组使用。LINE 没有发送你的 ID（例如电脑版 LINE），请让使用手机 LINE 的其他成员 @机器人。",
  dmGroupsOnly: "私聊中机器人只能管理群组和你的设置：/groups、/approve <id>、/deny <id>、/groupconfig <id>、/config。请在已允许的群组中与 AI 聊天（@机器人 或使用 /elysia）。",
  groupsTitle: "群组列表：",
  groupsEmpty: "还没有群组。请把机器人加入群组并在群组中 @机器人，然后再输入 /groups。",
  groupNotFound: "该群组不存在、不属于你，或无法这样更改。请查看 /groups。",
  groupIdUsage: (usage) => `用法：${usage}。群组 ID 可在 /groups 中查看。`,
  groupApproved: (id) => `群组 #${id} 已获允许。在该群组中 @机器人 即可开始。`,
  groupLimitReached: (max) => `你已经是 ${max} 个群组的管理员（上限）。请先用 /deny <id> 撤销一个。`,
  groupRevoked: (id) => `已撤销群组 #${id} 的允许，该群组重新等待 /approve。`,
  groupDenied: (id) => `已拒绝群组 #${id}。在拥有者重新允许之前，机器人在该群组中不会回应。`,
  adminSet: (id, userId) => `群组 #${id} 的管理员已设为 ${userId}。`,
  adminCleared: (id) => `已清除群组 #${id} 的管理员和申请人。`,
  groupSettingsTitle: "群组设置：",
  groupConfigNotAdmin: "只有本群组的管理员可以更改群组设置。",
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
  settingsChangeHelp: (command) => `變更：${command} <名稱> <值>`,
  settingsResetHelp: (command, resetValue) => `恢復預設：${command} <名稱> ${resetValue}`,
  unknownSetting: (name, command) => `未知設定 ${name}。輸入 ${command} 查看設定列表。`,
  settingUsage: (command, key, hint) => `用法：${command} ${key} <值>。值：${hint}。`,
  settingReset: (key, value) => `${key} 已恢復預設：${value}。`,
  invalidValue: (value, key, hint) => `${value} 不是 ${key} 的有效值。請使用${hint}。`,
  settingChanged: (key, value) => `${key} 已變更為 ${value}。`,
  rateLimited: "訊息太多了，請稍候再試。",
  elysiaUsage: "用法：/elysia <訊息>。在群組中也可以 @機器人 後輸入訊息。",
  configInGroup: "請在與機器人的私聊中變更你的設定，不要在群組中變更。群組管理員：請用 /groupconfig 變更群組設定。",
  joinNotice: "你好！需要先允許機器人在此群組中使用。新增機器人的人：請在這裡 @機器人，然後私訊機器人輸入 /groups，再輸入 /approve <id>。",
  notPermitted: (id) => `機器人尚未獲准在此群組使用（群組 #${id}）。第一個在這裡和機器人說話的人可以私訊機器人並輸入 /approve ${id}。`,
  unknownSender: "機器人尚未獲准在此群組使用。LINE 沒有傳送你的 ID（例如電腦版 LINE），請讓使用手機 LINE 的其他成員 @機器人。",
  dmGroupsOnly: "私訊中機器人只能管理群組和你的設定：/groups、/approve <id>、/deny <id>、/groupconfig <id>、/config。請在已允許的群組中與 AI 聊天（@機器人 或使用 /elysia）。",
  groupsTitle: "群組列表：",
  groupsEmpty: "還沒有群組。請把機器人加入群組並在群組中 @機器人，然後再輸入 /groups。",
  groupNotFound: "該群組不存在、不屬於你，或無法這樣變更。請查看 /groups。",
  groupIdUsage: (usage) => `用法：${usage}。群組 ID 可在 /groups 中查看。`,
  groupApproved: (id) => `群組 #${id} 已獲允許。在該群組中 @機器人 即可開始。`,
  groupLimitReached: (max) => `你已經是 ${max} 個群組的管理員（上限）。請先用 /deny <id> 撤銷一個。`,
  groupRevoked: (id) => `已撤銷群組 #${id} 的允許，該群組重新等待 /approve。`,
  groupDenied: (id) => `已拒絕群組 #${id}。在擁有者重新允許之前，機器人在該群組中不會回應。`,
  adminSet: (id, userId) => `群組 #${id} 的管理員已設為 ${userId}。`,
  adminCleared: (id) => `已清除群組 #${id} 的管理員和申請人。`,
  groupSettingsTitle: "群組設定：",
  groupConfigNotAdmin: "只有本群組的管理員可以變更群組設定。",
};

export const MESSAGES: Readonly<Record<Locale, Messages>> = { id, en, ja, "zh-Hans": zhHans, "zh-Hant": zhHant };
