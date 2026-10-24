import { settingsText, type Command } from "./commands";
import { LINE_USER_ID } from "./config";
import type { Group, GroupStore } from "./groups";
import type { Locale } from "./language";
import { MESSAGES, type Messages } from "./messages";
import { settingsFor, type SettingsStore } from "./settings";

// Get group summary, reduced to its groupName. Rejects when LINE refuses (404: the bot is not in the group).
export type FetchGroupName = (groupId: string) => Promise<string>;

type AccessCommandName = "groups" | "approve" | "deny" | "admin" | "groupconfig";
export const ACCESS_COMMANDS: ReadonlySet<string> = new Set<AccessCommandName>([
  "groups",
  "approve",
  "deny",
  "admin",
  "groupconfig",
]);

// Group access, shared by every event.
export type Access = {
  readonly groups: GroupStore;
  readonly groupSettings: SettingsStore;
  readonly ownerUserId: string | undefined;
  readonly maxGroupsPerUser: number;
  readonly groupName: FetchGroupName;
};

export type AccessContext = {
  readonly access: Access;
  // Undefined when LINE sent no user ID (a group member on LINE for PC).
  readonly userId: string | undefined;
  // Set when the command came from a group (only /groupconfig is run from a group).
  readonly groupId?: string;
  readonly locale: Locale;
};

const RESET_VALUE = "reset";

export function isOwner(access: Access, userId: string | undefined): boolean {
  return userId !== undefined && userId === access.ownerUserId;
}

export async function runAccessCommand(command: Command, context: AccessContext): Promise<string> {
  const t = MESSAGES[context.locale];
  const owner = isOwner(context.access, context.userId);
  const [first = "", second = ""] = command.args.trim().split(/\s+/);
  switch (command.name as AccessCommandName) {
    case "groups":
      return groupsText(context, owner, t);
    case "approve":
      return approve(first, context, owner, t);
    case "deny":
      return deny(first, context, owner, t);
    case "admin":
      return admin(first, second, context, owner, t);
    case "groupconfig":
      return groupConfig(command.args, context, owner, t);
  }
  return t.unknownCommand(command.name);
}

// "#3" or "3" (as shown by /groups).
function findGroup(arg: string, groups: GroupStore): Group | null {
  const match = /^#?(\d{1,9})$/.exec(arg);
  return match ? groups.byId(Number(match[1])) : null;
}

async function groupsText({ access, userId }: AccessContext, owner: boolean, t: Messages): Promise<string> {
  const rows = access.groups
    .list()
    .filter((group) => owner || (userId !== undefined && (group.requesterId === userId || group.adminId === userId)));
  if (rows.length === 0) return t.groupsEmpty;
  // Names are fetched for the list only and never stored.
  const names = await Promise.allSettled(rows.map((group) => access.groupName(group.groupId)));
  const lines = rows.map((group, i) => {
    const name = names[i];
    if (name?.status === "rejected") {
      const reason = name.reason instanceof Error ? name.reason.message : String(name.reason);
      console.error(`Get group summary failed for group ${group.groupId}: ${reason}`);
    }
    const line = `#${group.id} ${group.status} ${name?.status === "fulfilled" ? name.value : group.groupId}`;
    return owner ? `${line} | requester: ${group.requesterId ?? "-"} | admin: ${group.adminId ?? "-"}` : line;
  });
  return [t.groupsTitle, ...lines].join("\n");
}

function approve(arg: string, { access, userId }: AccessContext, owner: boolean, t: Messages): string {
  if (!arg) return t.groupIdUsage("/approve <id>");
  const group = findGroup(arg, access.groups);
  // A group without requester cannot be approved: the owner sets one with /admin first.
  if (!group?.requesterId) return t.groupNotFound;
  const allowed = owner
    ? group.status === "pending" || group.status === "denied"
    : group.status === "pending" && group.requesterId === userId;
  if (!allowed) return t.groupNotFound;
  if (!owner && access.groups.allowedCount(group.requesterId) >= access.maxGroupsPerUser) {
    return t.groupLimitReached(access.maxGroupsPerUser);
  }
  access.groups.approve(group.id);
  return t.groupApproved(group.id);
}

function deny(arg: string, { access, userId }: AccessContext, owner: boolean, t: Messages): string {
  if (!arg) return t.groupIdUsage("/deny <id>");
  const group = findGroup(arg, access.groups);
  if (owner && (group?.status === "pending" || group?.status === "allowed")) {
    access.groups.setStatus(group.id, "denied");
    return t.groupDenied(group.id);
  }
  if (!owner && group?.status === "allowed" && group.adminId === userId) {
    access.groups.setStatus(group.id, "pending");
    return t.groupRevoked(group.id);
  }
  return t.groupNotFound;
}

function admin(idArg: string, target: string, { access }: AccessContext, owner: boolean, t: Messages): string {
  if (!owner) return t.groupNotFound;
  const usage = t.groupIdUsage("/admin <id> <userId|reset>");
  if (!idArg || !target) return usage;
  const group = findGroup(idArg, access.groups);
  if (!group || group.status === "left") return t.groupNotFound;
  if (target.toLowerCase() === RESET_VALUE) {
    access.groups.setAdmin(group.id, null);
    return t.adminCleared(group.id);
  }
  // The owner is never recorded as requester or admin.
  if (!LINE_USER_ID.test(target) || target === access.ownerUserId) return usage;
  access.groups.setAdmin(group.id, target);
  return t.adminSet(group.id, target);
}

function groupConfig(args: string, { access, userId, groupId }: AccessContext, owner: boolean, t: Messages): string {
  if (groupId) {
    if (!owner && (!userId || access.groups.get(groupId)?.adminId !== userId)) return t.groupConfigNotAdmin;
    return settingsText(args, settingsFor(access.groupSettings, groupId), t, t.groupSettingsTitle, "/groupconfig");
  }
  const [idArg = "", ...rest] = args.trim().split(/\s+/);
  if (!idArg) return t.groupIdUsage("/groupconfig <id>");
  const group = findGroup(idArg, access.groups);
  if (!group || !(owner || (group.status === "allowed" && group.adminId === userId))) return t.groupNotFound;
  return settingsText(
    rest.join(" "),
    settingsFor(access.groupSettings, group.groupId),
    t,
    t.groupSettingsTitle,
    `/groupconfig ${group.id}`,
  );
}
