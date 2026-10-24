import type { webhook } from "@line/bot-sdk";

export type Allowlist = {
  readonly userIds: ReadonlySet<string>;
  // Also holds room IDs: rooms are checked against the group list.
  readonly groupIds: ReadonlySet<string>;
};

export function isAllowed(source: webhook.Source | undefined, allowlist: Allowlist): boolean {
  if (!source) return false;
  if (source.userId && allowlist.userIds.has(source.userId)) return true;
  if (source.type === "group") return allowlist.groupIds.has(source.groupId);
  if (source.type === "room") return allowlist.groupIds.has(source.roomId);
  return false;
}

// Logs IDs of ignored events (never message text) so the owner can find new group IDs.
export function filterAllowed(events: webhook.Event[], allowlist: Allowlist): webhook.Event[] {
  return events.filter((event) => {
    const allowed = isAllowed(event.source, allowlist);
    if (!allowed) console.log(`Ignored ${event.type} event from ${describeSource(event.source)}`);
    return allowed;
  });
}

function describeSource(source: webhook.Source | undefined): string {
  if (!source) return "unknown source";
  const user = source.userId ? `user ${source.userId}` : "unknown user";
  if (source.type === "group") return `group ${source.groupId} (${user})`;
  if (source.type === "room") return `room ${source.roomId} (${user})`;
  return user;
}
