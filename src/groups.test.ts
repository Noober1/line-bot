import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { createGroupStore, type GroupStore } from "./groups";

describe("createGroupStore", () => {
  let db: Database;
  let clock: number;
  let groups: GroupStore;
  beforeEach(() => {
    db = new Database(":memory:");
    clock = 1_000;
    groups = createGroupStore(db, () => clock);
  });

  test("join creates a pending group without requester or admin", () => {
    const group = groups.join("C1");
    expect(group).toMatchObject({ groupId: "C1", status: "pending", requesterId: null, adminId: null });
    expect(typeof group.id).toBe("number");
  });

  test("join twice keeps the same id", () => {
    expect(groups.join("C1").id).toBe(groups.join("C1").id);
  });

  test("request adds a missing group as pending and records the first user as requester", () => {
    expect(groups.request("C1", "U1")).toMatchObject({ status: "pending", requesterId: "U1" });
    expect(groups.request("C1", "U2").requesterId).toBe("U1");
  });

  test("request without a user ID records nothing; the next user becomes requester", () => {
    expect(groups.request("C1", undefined).requesterId).toBeNull();
    expect(groups.request("C1", "U3").requesterId).toBe("U3");
  });

  test("request on an allowed or denied group changes nothing", () => {
    const allowed = groups.request("C1", "U1");
    groups.approve(allowed.id);
    expect(groups.request("C1", "U2")).toMatchObject({ status: "allowed", requesterId: "U1", adminId: "U1" });
    const denied = groups.request("C2", "U1");
    groups.setStatus(denied.id, "denied");
    expect(groups.request("C2", "U2")).toMatchObject({ status: "denied", requesterId: "U1" });
  });

  test("leave hides the group; join again makes it pending with a new requester and keeps admin and id", () => {
    const { id } = groups.request("C1", "U1");
    groups.approve(id);
    groups.leave("C1");
    expect(groups.list()).toEqual([]);
    expect(groups.get("C1")?.status).toBe("left");
    expect(groups.join("C1")).toMatchObject({ id, status: "pending", requesterId: null, adminId: "U1" });
  });

  test("request on a left group makes it pending again", () => {
    groups.request("C1", "U1");
    groups.leave("C1");
    expect(groups.request("C1", "U2")).toMatchObject({ status: "pending", requesterId: "U2" });
  });

  test("join on a denied group keeps it denied", () => {
    const { id } = groups.join("C1");
    groups.setStatus(id, "denied");
    expect(groups.join("C1").status).toBe("denied");
  });

  test("join on an allowed group resets it to pending (a leave event was missed)", () => {
    const { id } = groups.request("C1", "U1");
    groups.approve(id);
    expect(groups.join("C1")).toMatchObject({ status: "pending", requesterId: null });
  });

  test("list is ordered pending, allowed, denied, then by id, and skips left groups", () => {
    const a = groups.request("A", "U1");
    const b = groups.request("B", "U1");
    groups.request("C", "U1");
    groups.request("D", "U1");
    groups.approve(a.id);
    groups.setStatus(b.id, "denied");
    groups.leave("D");
    expect(groups.list().map((group) => group.groupId)).toEqual(["C", "A", "B"]);
  });

  test("allowedCount counts only allowed groups of that admin", () => {
    const a = groups.request("A", "U1");
    const b = groups.request("B", "U1");
    groups.request("C", "U2");
    groups.approve(a.id);
    expect(groups.allowedCount("U1")).toBe(1);
    groups.approve(b.id);
    expect(groups.allowedCount("U1")).toBe(2);
    expect(groups.allowedCount("U2")).toBe(0);
  });

  test("claimNotice is true once per window per group", () => {
    groups.join("C1");
    groups.join("C2");
    expect(groups.claimNotice("C1", 600_000)).toBe(true);
    clock += 599_999;
    expect(groups.claimNotice("C1", 600_000)).toBe(false);
    expect(groups.claimNotice("C2", 600_000)).toBe(true);
    clock += 1;
    expect(groups.claimNotice("C1", 600_000)).toBe(true);
  });

  test("approve makes the group allowed with the requester as admin", () => {
    const { id } = groups.request("C1", "U1");
    groups.approve(id);
    expect(groups.byId(id)).toMatchObject({ status: "allowed", adminId: "U1" });
  });

  test("setAdmin sets requester and admin together; null clears both", () => {
    const { id } = groups.join("C1");
    groups.setAdmin(id, "U9");
    expect(groups.byId(id)).toMatchObject({ requesterId: "U9", adminId: "U9" });
    groups.setAdmin(id, null);
    expect(groups.byId(id)).toMatchObject({ requesterId: null, adminId: null });
  });

  test("claim allows a missing, pending or left group for the owner; allowed and denied groups are untouched", () => {
    groups.claim("NEW", "UO");
    expect(groups.get("NEW")).toMatchObject({ status: "allowed", requesterId: "UO", adminId: "UO" });
    groups.request("P", "U1");
    groups.claim("P", "UO");
    expect(groups.get("P")).toMatchObject({ status: "allowed", requesterId: "UO", adminId: "UO" });
    groups.request("L", "U1");
    groups.leave("L");
    groups.claim("L", "UO");
    expect(groups.get("L")?.status).toBe("allowed");
    const mine = groups.request("A", "U2");
    groups.approve(mine.id);
    groups.claim("A", "UO");
    expect(groups.get("A")).toMatchObject({ status: "allowed", adminId: "U2" });
    groups.setStatus(groups.request("D", "U3").id, "denied");
    groups.claim("D", "UO");
    expect(groups.get("D")).toMatchObject({ status: "denied", adminId: null });
  });

  test("byId and get return null for unknown groups", () => {
    expect(groups.byId(99)).toBeNull();
    expect(groups.get("nope")).toBeNull();
  });

  test("status persists across store instances on the same database", () => {
    const { id } = groups.request("C1", "U1");
    groups.approve(id);
    expect(createGroupStore(db).get("C1")).toMatchObject({ id, status: "allowed", adminId: "U1" });
  });
});
