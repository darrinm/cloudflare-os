import { describe, expect, it } from "vitest";
import { summarise } from "./Feed";
import type { BotEvent } from "./types";

const event = (type: string, text = "", id = 1): BotEvent => ({ id, botId: "b1", ts: 1000, type, text, data: {} });

describe("summarise", () => {
  it("says what happened, in words a person would use", () => {
    expect(summarise(event("completed", "Found 3 flights under £200"), "Scout")?.line)
      .toBe("Scout: Found 3 flights under £200");
    expect(summarise(event("failed", "the site timed out"), "Scout")?.line)
      .toBe("Scout couldn’t finish: the site timed out");
    expect(summarise(event("needsUser", "sign in to the bank"), "Ledger")?.line)
      .toBe("Ledger needs you: sign in to the bank");
    expect(summarise(event("message", "book the tickets"), "Scout")?.line)
      .toBe("You asked Scout: book the tickets");
  });

  it("reads a decision as the reader's own action, not the system's", () => {
    expect(summarise({ ...event("decision", "Approved: Run: npm test"), data: { state: "approved" } }, "Fixer")?.line)
      .toBe("You said yes to Run: npm test (Fixer).");
    expect(summarise({ ...event("decision", "Rejected: Delete /data"), data: { state: "rejected" } }, "Fixer")?.line)
      .toBe("You said no to Delete /data (Fixer).");
    // Events older than the structured field fall back to the prefix the hub wrote.
    expect(summarise(event("decision", "Rejected: Delete /data"), "Fixer")?.line)
      .toBe("You said no to Delete /data (Fixer).");
  });

  it("explains a spending stop without naming a field", () => {
    const line = summarise(event("capped", "cap reached"), "Ledger");
    expect(line?.line).toBe("Ledger stopped for today — it reached the spending limit you set.");
    expect(line?.tone).toBe("failed");
  });

  it("does not quote our own plumbing back as something the reader said", () => {
    // When an approval lands, the hub nudges the Bot to resume. That is not the reader talking.
    const nudge: BotEvent = {
      id: 9, botId: "b1", ts: 1000, type: "message",
      text: 'Your human approved "Run: npm test" and it has been applied. Continue the job now: call getActionResult(1)...',
      data: { from: { type: "system", name: "approvals" } },
    };
    expect(summarise(nudge, "Fixer")).toBeNull();
  });

  it("names who was actually asking", () => {
    const fromBot: BotEvent = { id: 10, botId: "b1", ts: 1, type: "message", text: "check the logs", data: { from: { type: "bot", name: "Concierge" } } };
    expect(summarise(fromBot, "Fixer")?.line).toBe("Concierge asked Fixer: check the logs");
    const fromPerson: BotEvent = { id: 11, botId: "b1", ts: 1, type: "message", text: "hi", data: { from: { type: "user" } } };
    expect(summarise(fromPerson, "Fixer")?.line).toBe("You asked Fixer: hi");
    // No `from` at all (older events) still reads as the reader, which is what it was.
    expect(summarise(event("message", "hi"), "Fixer")?.line).toBe("You asked Fixer: hi");
  });

  it("shows a group post once, not its fan-out to every member", () => {
    // The post itself is news.
    const post: BotEvent = { id: 20, botId: "b1", ts: 1, type: "groupPost", text: "Scout in Team: Found the AI story", data: { groupName: "Team", fromType: "bot", fromName: "Scout" } };
    expect(summarise(post, "Scout")?.line).toBe("Scout in Team: Found the AI story");
    const mine: BotEvent = { id: 21, botId: null, ts: 1, type: "groupPost", text: "me in Team: status please", data: { groupName: "Team", fromType: "user", fromName: "me" } };
    expect(summarise(mine, null)?.line).toBe("You in Team: status please");
    // The per-member delivery carries the hub's whole envelope -- plumbing, already represented.
    const fanout: BotEvent = { id: 22, botId: "b2", ts: 1, type: "message", text: 'Group "Team" (Concierge coordinates...): new post from Scout (a Bot).\n\nFound the AI story\n\n--- recent transcript ---', data: { from: { type: "bot", name: "Scout", groupId: "g1" } } };
    expect(summarise(fanout, "Ledger")).toBeNull();
  });

  it("drops a member's quiet one-line reply to a group, keeps a real answer", () => {
    const trigger: BotEvent = { id: 30, botId: "b2", ts: 1, type: "message", text: "envelope", data: { from: { type: "bot", groupId: "g1" }, extra: { group: { name: "Team" } } } };
    const byId = new Map([[30, trigger]]);
    // "Nothing to add" is the hub's own instruction being followed; five of these in a row were
    // most of the feed.
    const quiet: BotEvent = { id: 31, botId: "b2", ts: 2, type: "completed", text: "No addition needed; Concierge's status noted, nothing for Ledger to add.", data: { eventId: 30 } };
    expect(summarise(quiet, "Ledger", byId)).toBeNull();
    // A long completion in a group is an answer, and stays.
    const answer: BotEvent = { id: 32, botId: "b2", ts: 3, type: "completed", text: "x".repeat(200), data: { eventId: 30 } };
    expect(summarise(answer, "Ledger", byId)?.tone).toBe("done");
    // The same short completion outside a group is a real result.
    const solo: BotEvent = { id: 33, botId: "b2", ts: 4, type: "completed", text: "Done: 3 files.", data: {} };
    expect(summarise(solo, "Ledger", byId)?.line).toBe("Ledger: Done: 3 files.");
  });

  it("drops bookkeeping nobody needs to read", () => {
    for (const type of ["created", "updated", "deleted", "agent", "skill", "delivered"]) {
      expect(summarise(event(type, "something"), "Scout")).toBeNull();
    }
  });

  it("marks what is waiting on the reader, so it can be pinned", () => {
    expect(summarise(event("needsUser", "2FA code"), "Scout")?.tone).toBe("needs");
    expect(summarise(event("completed", "done"), "Scout")?.tone).toBe("done");
  });

  it("copes with an event from no particular Bot, and with empty text", () => {
    const orphan = summarise({ id: 2, botId: null, ts: 1, type: "completed", text: "", data: {} }, null);
    expect(orphan?.line).toBe("A Bot finished.");
    expect(summarise(event("needsUser", ""), "Scout")?.line).toBe("Scout needs you.");
  });

  it("keeps a long line short enough to read at a glance", () => {
    const long = summarise(event("completed", "x".repeat(400)), "Scout")!;
    expect(long.line.length).toBeLessThan(260);
    expect(long.line.endsWith("…")).toBe(true);
  });
});
