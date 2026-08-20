import { describe, expect, it, vi } from "vitest";
import { bringBotsHere } from "./bringHere";

// Two fake hubs: the stray one is read, the person's one is written. Stubs are plain objects with
// the methods the move touches; a dispose symbol so the helpers can let go of them.
function fakeStrayHub() {
  return {
    listBots: async () => [
      { id: "r1", name: "Research", role: "Digs", instructions: "Read widely.", avatar: "", color: "#123", dailyCapUsd: 2 },
      { id: "s1", name: "Scout", role: "Dup name", instructions: "", avatar: "", color: "", dailyCapUsd: null },
    ],
    listMemories: async (botId: string) => (botId === "r1" ? [{ id: "m1", botId, kind: "fact", text: "Darrin likes teal", created: 1, source: "" }] : []),
    listSkills: async () => [{ name: "shout", description: "Caps", created: 1, updated: 1 }, { name: "greet", description: "", created: 1, updated: 1 }],
    getSkill: async (name: string) => ({ name, description: "Caps", body: `BODY ${name}`, created: 1, updated: 1 }),
    listGroups: async () => [{ id: "g1", name: "Team", purpose: "All", created: 1, updated: 1, members: [{ id: "r1", name: "Research" }, { id: "zz", name: "Gone" }], postCount: 0, lastPost: null }],
    [Symbol.dispose]() {},
  };
}

function fakeMainHub() {
  let n = 0;
  const hub = {
    createBot: vi.fn(async (input: { name: string }) => ({ id: `new${++n}`, ...input })),
    updateBot: vi.fn(async () => ({})),
    remember: vi.fn(async () => ({})),
    listBots: async () => [{ id: "s0", name: "Scout" }],
    listSkills: async () => [{ name: "greet" }],
    defineSkill: vi.fn(async () => ({})),
    createGroup: vi.fn(async () => ({})),
    setMeta: vi.fn(async () => null),
    [Symbol.dispose]() {},
  };
  return hub;
}

function harness(opts: { defaultGadgetId: number }) {
  const stray = fakeStrayHub();
  const main = fakeMainHub();
  const strayClient = { connectToGadget: async () => stray, remove: vi.fn(async () => {}), [Symbol.dispose]() {} };
  const strayOverseer = { getGadget: () => strayClient, getMetadata: async () => ({ id: "ws-stray", defaultGadgetId: opts.defaultGadgetId }), deleteSelf: vi.fn(async () => {}), [Symbol.dispose]() {} };
  const api = { openGadget: vi.fn(async () => strayOverseer) };
  const overseer = { getGadget: () => ({ connectToGadget: async () => main, [Symbol.dispose]() {} }) };
  return { stray, main, strayClient, strayOverseer, api, overseer };
}

describe("bringBotsHere", () => {
  it("copies persona, cap, memories, skills and groups, then removes a hub-only workspace", async () => {
    const h = harness({ defaultGadgetId: 0 });
    const result = await bringBotsHere({
      api: h.api as never, overseer: h.overseer as never, workpieceId: 0,
      stray: { workspaceId: "ws-stray", workpieceId: 0 }, strayIsSoleOutput: true,
    });
    expect(result).toEqual({ moved: 2 });
    // Personas, with a name that would collide given a suffix.
    expect(h.main.createBot.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["Research", "Scout (moved)"]);
    expect(h.main.createBot.mock.calls[0][0]).toMatchObject({ role: "Digs", instructions: "Read widely.", color: "#123" });
    expect(h.main.updateBot).toHaveBeenCalledWith("new1", { dailyCapUsd: 2 });
    expect(h.main.updateBot).toHaveBeenCalledTimes(1);
    expect(h.main.remember).toHaveBeenCalledWith("new1", "fact", "Darrin likes teal", "moved from another hub");
    // Only the skill the destination lacks; the group keeps the members that moved.
    expect(h.main.defineSkill).toHaveBeenCalledTimes(1);
    expect(h.main.defineSkill).toHaveBeenCalledWith({ name: "shout", description: "Caps", body: "BODY shout" });
    expect(h.main.createGroup).toHaveBeenCalledWith({ name: "Team", purpose: "All", members: ["new1"] });
    expect(h.main.setMeta).toHaveBeenCalledWith("mergedFrom:ws-stray", expect.any(String));
    expect(h.strayOverseer.deleteSelf).toHaveBeenCalled();
    expect(h.strayClient.remove).not.toHaveBeenCalled();
  });

  it("removes only the gadget when the stray hub lives inside a workspace with other work", async () => {
    const h = harness({ defaultGadgetId: 3 });
    await bringBotsHere({
      api: h.api as never, overseer: h.overseer as never, workpieceId: 0,
      stray: { workspaceId: "ws-stray", workpieceId: 7 }, strayIsSoleOutput: false,
    });
    expect(h.strayClient.remove).toHaveBeenCalled();
    expect(h.strayOverseer.deleteSelf).not.toHaveBeenCalled();
  });
});
