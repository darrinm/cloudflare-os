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
