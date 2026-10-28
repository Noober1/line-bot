import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runAccessCommand, type Access } from "./access-commands";
import { parseCommand } from "./commands";
import { createGroupStore, type GroupStore } from "./groups";
import { MESSAGES } from "./messages";
import { createSettingsStore } from "./settings";

const OWNER = `U${"0".repeat(32)}`;
const USER5 = `U${"5".repeat(32)}`;
const T = MESSAGES.id;

describe("runAccessCommand", () => {
  let groups: GroupStore;
  let access: Access;
  let groupSettings: ReturnType<typeof createSettingsStore>;
  let nameFails: boolean;

  beforeEach(() => {
    const db = new Database(":memory:");
    groups = createGroupStore(db);
    groupSettings = createSettingsStore(db, { translate: "en" }, "group_settings");
    nameFails = false;
    access = {
      groups,
      groupSettings,
      ownerUserId: OWNER,
      maxGroupsPerUser: 2,
      groupName: async (groupId) => {
        if (nameFails) throw new Error("404");
        return `nama ${groupId}`;
      },
    };
  });

  const run = (text: string, userId: string | undefined, groupId?: string) =>
    runAccessCommand(parseCommand(text)!, { access, userId, groupId, locale: "id" });

  const pending = (groupId: string, requester: string) => groups.request(groupId, requester);
  const allowed = (groupId: string, requester: string) => {
    const group = pending(groupId, requester);
    groups.approve(group.id);
    return group;
  };

  describe("/groups", () => {
    test("owner sees every non-left group, ordered, with requester and admin", async () => {
      const a = allowed("CA", "U1");
      const b = pending("CB", "U2");
      groups.request("CC", "U3");
      groups.leave("CC");
      expect(await run("/groups", OWNER)).toBe(
        [
          T.groupsTitle,
          `#${b.id} pending nama CB | requester: U2 | admin: -`,
          `#${a.id} allowed nama CA | requester: U1 | admin: U1`,
        ].join("\n"),
      );
    });

    test("a user sees only groups they requested or administer, without requester info", async () => {
      const mine = pending("CA", "U1");
      pending("CB", "U2");
      expect(await run("/groups", "U1")).toBe([T.groupsTitle, `#${mine.id} pending nama CA`].join("\n"));
    });

    test("a failed group name falls back to the group ID and is logged", async () => {
      const group = pending("CA", "U1");
      nameFails = true;
      const spy = spyOn(console, "error").mockImplementation(() => {});
      expect(await run("/groups", "U1")).toBe([T.groupsTitle, `#${group.id} pending CA`].join("\n"));
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test("no groups gives the empty text", async () => {
      expect(await run("/groups", "U1")).toBe(T.groupsEmpty);
    });
  });

  describe("/approve", () => {
    test("the requester approves their own group; the requester becomes admin", async () => {
      const group = pending("CA", "U1");
      expect(await run(`/approve ${group.id}`, "U1")).toBe(T.groupApproved(group.id));
      expect(groups.byId(group.id)).toMatchObject({ status: "allowed", adminId: "U1" });
    });

    test("accepts the #id form", async () => {
      const group = pending("CA", "U1");
      expect(await run(`/approve #${group.id}`, "U1")).toBe(T.groupApproved(group.id));
    });

    test("another group, an unknown id and junk all give the same error", async () => {
      const other = pending("CB", "U2");
      pending("CA", "U1");
      const answers = await Promise.all([run(`/approve ${other.id}`, "U1"), run("/approve 999", "U1"), run("/approve abc", "U1")]);
      expect(answers).toEqual([T.groupNotFound, T.groupNotFound, T.groupNotFound]);
      expect(groups.byId(other.id)?.status).toBe("pending");
    });

    test("a group without requester is refused, also for the owner, until /admin sets one", async () => {
      const group = groups.join("CA");
      expect(await run(`/approve ${group.id}`, OWNER)).toBe(T.groupNotFound);
      await run(`/admin ${group.id} ${USER5}`, OWNER);
      expect(await run(`/approve ${group.id}`, OWNER)).toBe(T.groupApproved(group.id));
    });

    test("a requester at the limit is refused; the owner is exempt", async () => {
      allowed("C1", "U1");
      allowed("C2", "U1");
      const third = pending("C3", "U1");
      expect(await run(`/approve ${third.id}`, "U1")).toBe(T.groupLimitReached(2));
      expect(groups.byId(third.id)?.status).toBe("pending");
      expect(await run(`/approve ${third.id}`, OWNER)).toBe(T.groupApproved(third.id));
    });

    test("without an id it gives the usage", async () => {
      expect(await run("/approve", "U1")).toBe(T.groupIdUsage("/approve <id>"));
    });
  });

  describe("/deny", () => {
    test("the admin revokes: allowed -> pending, requester kept", async () => {
      const group = allowed("CA", "U1");
      expect(await run(`/deny ${group.id}`, "U1")).toBe(T.groupRevoked(group.id));
      expect(groups.byId(group.id)).toMatchObject({ status: "pending", requesterId: "U1" });
    });

    test("the owner denies; only the owner can approve a denied group again", async () => {
      const group = pending("CA", "U1");
      expect(await run(`/deny ${group.id}`, OWNER)).toBe(T.groupDenied(group.id));
      expect(groups.byId(group.id)?.status).toBe("denied");
      expect(await run(`/approve ${group.id}`, "U1")).toBe(T.groupNotFound);
      expect(await run(`/approve ${group.id}`, OWNER)).toBe(T.groupApproved(group.id));
    });

    test("a requester cannot deny a pending group; the owner cannot deny a denied one", async () => {
      const group = pending("CA", "U1");
      expect(await run(`/deny ${group.id}`, "U1")).toBe(T.groupNotFound);
      groups.setStatus(group.id, "denied");
      expect(await run(`/deny ${group.id}`, OWNER)).toBe(T.groupNotFound);
    });
  });

  describe("/admin", () => {
    test("the owner sets requester and admin, or clears both", async () => {
      const group = groups.join("CA");
      expect(await run(`/admin ${group.id} ${USER5}`, OWNER)).toBe(T.adminSet(group.id, USER5));
      expect(groups.byId(group.id)).toMatchObject({ requesterId: USER5, adminId: USER5 });
      expect(await run(`/admin ${group.id} reset`, OWNER)).toBe(T.adminCleared(group.id));
      expect(groups.byId(group.id)).toMatchObject({ requesterId: null, adminId: null });
    });

    test("a non-owner gets the not-found text", async () => {
      const group = groups.join("CA");
      expect(await run(`/admin ${group.id} ${USER5}`, "U1")).toBe(T.groupNotFound);
    });

    test("a bad user ID or the owner's own ID gives the usage", async () => {
      const group = groups.join("CA");
      const usage = T.groupIdUsage("/admin <id> <userId|reset>");
      expect(await run(`/admin ${group.id} nope`, OWNER)).toBe(usage);
      expect(await run(`/admin ${group.id} ${OWNER}`, OWNER)).toBe(usage);
    });
  });

  describe("/groupconfig", () => {
    test("in a group the admin changes the group's settings", async () => {
      const group = allowed("CA", "U1");
      expect(await run("/groupconfig translate ja", "U1", "CA")).toBe(T.settingChanged("translate", "ja"));
      expect(groupSettings.stored(group.groupId)).toEqual({ translate: "ja" });
    });

    test("in a group another member, or a member without user ID, is refused; the owner is fine", async () => {
      allowed("CA", "U1");
      expect(await run("/groupconfig translate ja", "U2", "CA")).toBe(T.groupConfigNotAdmin);
      expect(await run("/groupconfig translate ja", undefined, "CA")).toBe(T.groupConfigNotAdmin);
      expect(await run("/groupconfig translate ja", OWNER, "CA")).toBe(T.settingChanged("translate", "ja"));
    });

    test("in a DM the admin, or the owner, changes the settings by group id", async () => {
      const group = allowed("CA", "U1");
      expect(await run(`/groupconfig ${group.id} translate ko`, "U1")).toBe(T.settingChanged("translate", "ko"));
      expect(groupSettings.stored("CA")).toEqual({ translate: "ko" });
      expect(await run(`/groupconfig ${group.id} translate fr`, OWNER)).toBe(T.settingChanged("translate", "fr"));
    });

    test("in a DM a non-admin or a not-allowed group gives not-found", async () => {
      const group = allowed("CA", "U1");
      const waiting = pending("CB", "U1");
      expect(await run(`/groupconfig ${group.id} translate ko`, "U2")).toBe(T.groupNotFound);
      expect(await run(`/groupconfig ${waiting.id} translate ko`, "U1")).toBe(T.groupNotFound);
    });

    test("in a DM without an id it gives the usage", async () => {
      expect(await run("/groupconfig", "U1")).toBe(T.groupIdUsage("/groupconfig <id>"));
    });

    test("the list uses the group title and shows the /groupconfig command", async () => {
      const group = allowed("CA", "U1");
      const text = await run(`/groupconfig ${group.id}`, "U1");
      expect(text.startsWith(T.groupSettingsTitle)).toBe(true);
      expect(text).toContain(T.settingsChangeHelp(`/groupconfig ${group.id}`));
    });
  });
});
