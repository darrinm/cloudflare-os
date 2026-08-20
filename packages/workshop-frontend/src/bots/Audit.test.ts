import { describe, expect, it } from "vitest";
import { auditRows, eventsCsv, filterRows } from "./Audit";
import type { BotEvent } from "./types";

const names = new Map([["b1", "Scout"], ["b2", "Fixer"]]);
const ev = (id: number, type: string, text: string, botId: string | null = "b1", data: Record<string, unknown> = {}): BotEvent =>
  ({ id, botId, ts: 1_000 * id, type, text, data });

describe("auditRows", () => {
  it("keeps every event, newest first, naming the Bot and reading decisions from the data", () => {
    const rows = auditRows([
      ev(1, "delivered", "to agent"),
      ev(2, "decision", "Approved: Run: ls", "b2", { state: "approved", autoApproved: true }),
      ev(3, "decision", "Rejected: Delete /data", "b2"),
      ev(4, "created", "Bot created", "gone"),
      ev(5, "agent", "attached", null),
    ], names);
    expect(rows.map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
    expect(rows[4]).toMatchObject({ botId: "b1", bot: "Scout", type: "delivered", text: "to agent" });
    expect(rows[3]).toMatchObject({ bot: "Fixer", decision: { approved: true, auto: true } });
    // Older decisions predate the structured field; the prefix still says what happened.
    expect(rows[2].decision).toEqual({ approved: false, auto: false });
    expect(rows[1].bot).toBe("Deleted Bot");
    expect(rows[0].bot).toBe("");
  });
});

describe("filterRows", () => {
  const rows = auditRows([ev(1, "message", "book the tickets"), ev(2, "completed", "Booked two seats", "b2"), ev(3, "failed", "site down", "b2")], names);
  it("narrows by Bot, kind and text, each optional", () => {
    expect(filterRows(rows, { bot: "", type: "", q: "" })).toHaveLength(3);
    expect(filterRows(rows, { bot: "b2", type: "", q: "" }).map((r) => r.id)).toEqual([3, 2]);
    expect(filterRows(rows, { bot: "", type: "failed", q: "" }).map((r) => r.id)).toEqual([3]);
    expect(filterRows(rows, { bot: "", type: "", q: "BOOK" }).map((r) => r.id)).toEqual([2, 1]);
    expect(filterRows(rows, { bot: "b2", type: "completed", q: "seats" }).map((r) => r.id)).toEqual([2]);
    expect(filterRows(rows, { bot: "b1", type: "failed", q: "" })).toEqual([]);
    // Two Bots may share a name; the filter is by id, so it never merges them.
    expect(filterRows(auditRows([ev(1, "message", "a", "b1"), ev(2, "message", "b", "b2")], new Map([["b1", "Twin"], ["b2", "Twin"]])), { bot: "b2", type: "", q: "" }).map((r) => r.id)).toEqual([2]);
  });
});

describe("eventsCsv", () => {
  it("writes one row per event with the Bot's name and quoted fields", () => {
    const csv = eventsCsv([ev(1, "message", 'say "hi"', "b1", { from: { type: "user" } })], names);
    expect(csv.split("\n")[0]).toBe("id,time,bot,type,text,data");
    expect(csv.split("\n")[1]).toBe('"1","1970-01-01T00:00:01.000Z","Scout","message","say ""hi""","{""from"":{""type"":""user""}}"');
  });
});
