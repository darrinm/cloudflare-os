// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickBotsOutput } from "./useBotsWorkspace";

const testState = vi.hoisted(() => {
  const listModels = vi.fn<() => Promise<Array<{ type: string; id: string; name: string }>>>(async () => [{ type: "agent", id: "m1", name: "Model One" }]);
  const listOutputs = vi.fn<() => Promise<{ outputs: unknown[]; catchingUp: boolean }>>(async () => ({ outputs: [], catchingUp: false }));
  return {
    addToast: vi.fn<(toast: unknown) => void>(),
    navigate: vi.fn<(options: unknown) => void>(),
    listModels,
    listOutputs,
    authenticatedApi: { listModels, listOutputs, newGadgetFromBlueprint: vi.fn<() => unknown>() },
    workspaceOpen: { overseer: null as null | { stub: unknown }, error: null, retry: vi.fn<() => void>() },
    liveHub: { setMeta: vi.fn<(k: string, v: string) => Promise<string>>(async (_k, v) => v), send: vi.fn<(botId: string, text: string) => Promise<{ eventId: number; delivered: boolean }>>(async () => ({ eventId: 1, delivered: true })) },
    seedExampleBots: vi.fn<(deps: { afterSeed?: (hub: unknown, bots: Array<{ id: string; name: string }>) => Promise<void> }) => Promise<Array<{ id: string; name: string }>>>(async (deps) => {
      const bots = [{ id: "scout1", name: "Scout" }, { id: "fixer1", name: "Fixer" }];
      // Like the real seeder: anything after the Bots exist runs on a stub known to be live.
      if (deps.afterSeed) await deps.afterSeed(testState.liveHub, bots);
      return bots;
    }),
    hub: {
      hub: null as unknown,
      bots: [] as unknown[],
      groups: [] as unknown[],
      info: null as unknown,
      error: null as string | null,
      version: 0,
      updates: [] as unknown[],
      refreshBots: vi.fn<() => Promise<void>>(async () => {}),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => testState.navigate,
}));
vi.mock("@cloudflare/kumo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cloudflare/kumo")>()),
  useKumoToastManager: () => ({ add: testState.addToast }),
}));
vi.mock("../AuthContext", () => ({
  useAuthenticatedApi: () => ({ authenticatedApi: testState.authenticatedApi, currentUser: { id: "u", name: "U" } }),
}));
vi.mock("../ChatInterface", () => ({ default: () => <div data-testid="chat" /> }));
vi.mock("../useWorkspaceOpen", () => ({ useWorkspaceOpen: () => testState.workspaceOpen }));
vi.mock("./useBotsHub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useBotsHub")>()),
  useBotsHub: () => testState.hub,
}));
vi.mock("../useActions", () => ({ useActions: () => ({ actionsById: new Map(), isReady: true }) }));
vi.mock("./examples", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./examples")>()),
  seedExampleBots: testState.seedExampleBots,
}));

import { BotsPageContent } from "./BotsPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  vi.clearAllMocks();
});
async function render(botId: string | null, groupId: string | null = null) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<BotsPageContent botId={botId} groupId={groupId} />));
  // Let the async workspace lookup settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

describe("pickBotsOutput", () => {
  it("chooses the user's oldest owned Bots output and ignores others", () => {
    const outputs = [
      { workspaceId: "shared", workpieceId: 0, output: { id: "bots" }, created: new Date(1), owner: { id: "x" } },
      { workspaceId: "doc", workpieceId: 0, output: { id: "document" }, created: new Date(2) },
      { workspaceId: "newer", workpieceId: 3, output: { id: "bots" }, created: new Date(3) },
      { workspaceId: "older", workpieceId: 2, output: { id: "bots" }, created: new Date(2) },
    ] as unknown as Parameters<typeof pickBotsOutput>[0];
    expect(pickBotsOutput(outputs)?.workspaceId).toBe("older");
    expect(pickBotsOutput([])).toBeNull();
    // With no owned hub, a shared one (e.g. seeded by an operator) is used so /bots is not empty.
    expect(pickBotsOutput(outputs.filter((o) => o.owner || o.output?.id !== "bots"))?.workspaceId).toBe("shared");
  });
});

describe("BotsPageContent", () => {
  it("offers to set up the hub when the user has none", async () => {
    await render(null);
    expect(container!.textContent).toContain("Set up Bots");
    expect(testState.listOutputs).toHaveBeenCalled();
    const select = container!.querySelector("select");
    expect(select?.textContent).toContain("Model One");
  });

  it("welcomes a new hub with Bots and one real result, exactly once", async () => {
    testState.listOutputs.mockResolvedValue({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: { listModels: testState.listModels, getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }) } };
    // The page's own stub. Seeding binds resources, which restarts the gadget and breaks this very
    // stub, so the welcome must NOT use it: it asserts nothing was called on it after seeding.
    const staleSetMeta = vi.fn<(k: string, v: string) => Promise<string>>(async () => { throw new Error("Gadget restarted due to code update"); });
    const staleSend = vi.fn<(botId: string, text: string) => Promise<{ eventId: number; delivered: boolean }>>(async () => { throw new Error("Gadget restarted due to code update"); });
    testState.hub.hub = { getMeta: async () => null, setMeta: staleSetMeta, send: staleSend, activity: async () => [] };
    testState.hub.bots = [];

    await render(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

    expect(testState.seedExampleBots).toHaveBeenCalledTimes(1);
    // The welcome is recorded on the hub (not in this browser, so the same person's phone agrees),
    // and on the LIVE stub the seeder hands back -- the captured one is broken by then.
    expect(testState.liveHub.setMeta).toHaveBeenCalledWith("firstRun", expect.any(String));
    expect(staleSetMeta).not.toHaveBeenCalled();
    // Scout runs something real: reading the web needs no approval, so an answer lands unaided.
    expect(testState.liveHub.send.mock.calls[0]?.[0]).toBe("scout1");
    expect(String(testState.liveHub.send.mock.calls[0]?.[1])).toMatch(/news\.ycombinator\.com/);
    expect(staleSend).not.toHaveBeenCalled();
    // And no false "couldn't finish" toast: the Bots were created and the welcome went out.
    expect(testState.addToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("leaves a hub alone once it has been welcomed", async () => {
    testState.listOutputs.mockResolvedValue({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: { listModels: testState.listModels, getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }) } };
    // An emptied roster is a choice, not a fresh hub: the flag is what distinguishes them.
    testState.hub.hub = { getMeta: async () => "2026-08-19T00:00:00.000Z", setMeta: vi.fn(), send: vi.fn(), activity: async () => [] };
    testState.hub.bots = [];

    await render(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

    expect(testState.seedExampleBots).not.toHaveBeenCalled();
  });

  it("leaves a hub too old to have flags to the button", async () => {
    testState.listOutputs.mockResolvedValue({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: { listModels: testState.listModels, getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }) } };
    testState.hub.hub = { getMeta: async () => { throw new Error("getMeta is not a function"); }, setMeta: vi.fn(), send: vi.fn(), activity: async () => [] };
    testState.hub.bots = [];

    await render(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

    expect(testState.seedExampleBots).not.toHaveBeenCalled();
  });

  it("renders the roster and the selected Bot's conversation once the hub is found", async () => {
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    // The details panel asks the hub gadget for its bindings to find the Bot's computer.
    const listBindings = vi.fn<() => Promise<Array<{ name: string; target: number; resourceTitle: string }>>>(async () => [
      { name: "BROWSER_ABC12345", target: 7, resourceTitle: "Browser profile: inbox-manager-abc12345" },
    ]);
    testState.workspaceOpen.overseer = { stub: { getGadget: () => ({ listBindings, [Symbol.dispose]() {} }) } };
    const bot = {
      id: "abc12345", name: "Inbox Manager", role: "Triage", instructions: "", avatar: "", color: "",
      chatTitle: "Bot: Inbox Manager [abc12345]", created: 1, updated: 1, lastActivity: null,
      agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1,
    };
    testState.hub.hub = { listMemories: async () => [], listRoutines: async () => [], activity: async () => [], costs: async () => ({ botId: "abc12345", totalUsd: 1.234, totalTokens: 5000, turns: 3, chats: 1, todayUsd: 0.5, dailyCapUsd: null }) };
    testState.hub.bots = [bot];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 1, hubBindingName: "HUB" };

    await render("abc12345");
    expect(container!.textContent).toContain("Inbox Manager");
    expect(container!.querySelector('[aria-current="page"]')?.textContent).toContain("Inbox Manager");
    // Details panel shows persona fields and grants for the selected Bot.
    expect(container!.textContent).toContain("Grants");
    expect(container!.textContent).toContain("AGENT_SPAWNER");
    expect(localStorage.getItem("bots:workspace")).toContain("ws1");
    // The Computer section lists the Bot's browser profile (from the hub's BROWSER_<BOT> binding)
    // and reports no sandbox.
    await vi.waitFor(() => expect(container!.textContent).toContain("Browser profile: inbox-manager-abc12345"));
    expect(listBindings).toHaveBeenCalled();
    expect(container!.textContent).toContain("none yet — add one in Details");
    // Grants offer running a hub skill; the roster header offers the Skills manager.
    expect(container!.textContent).toContain("Run a skill…");
    await vi.waitFor(() => expect(container!.textContent).toContain("$0.50"));
    expect(container!.textContent).toContain("$1.23 lifetime over 3 turns");
    expect(container!.textContent).toContain("Export CSV");
    expect(container!.querySelector('[aria-label="Skills"]')).not.toBeNull();
  });
  it("offers the takeover walk-through once, and starts it through the Bot", async () => {
    testState.listOutputs.mockResolvedValue({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: {} };
    const scout = { id: "scout1", name: "Scout", role: "Reads the web", instructions: "", avatar: "", color: "", chatTitle: "Bot: Scout", created: 1, updated: 1, lastActivity: null, agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1 };
    const meta = new Map<string, string>();
    const hub = {
      getMeta: vi.fn(async (k: string) => meta.get(k) ?? null),
      setMeta: vi.fn(async (k: string, v: string) => { meta.set(k, v); return v; }),
      send: vi.fn<(botId: string, text: string, from: unknown) => Promise<{ eventId: number; delivered: boolean }>>(async () => ({ eventId: 9, delivered: true })),
      activity: async () => [],
    };
    testState.hub.hub = hub;
    testState.hub.bots = [scout];

    await render(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const card = container!.querySelector('[aria-label="Try a takeover"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Scout will open a site you sign in to");

    const tryIt = [...card!.querySelectorAll("button")].find((b) => b.textContent === "Try it")!;
    await act(async () => { tryIt.click(); await new Promise((r) => setTimeout(r, 30)); });
    // The real loop: Scout is asked to open a site and request the takeover; the person lands in
    // its conversation; the hub remembers the offer was taken.
    expect(hub.send.mock.calls[0]?.[0]).toBe("scout1");
    expect(String(hub.send.mock.calls[0]?.[1])).toMatch(/requestTakeover/);
    expect(testState.navigate).toHaveBeenCalledWith({ to: "/bots/$id", params: { id: "scout1" } });
    expect(meta.get("tryTakeover")).toMatch(/^tried /);
    expect(container!.querySelector('[aria-label="Try a takeover"]')).toBeNull();

    // Seen once is seen everywhere: a fresh page on the same hub does not offer it again.
    await act(async () => root!.unmount());
    root = null;
    await render(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(container!.querySelector('[aria-label="Try a takeover"]')).toBeNull();
    expect(hub.send).toHaveBeenCalledTimes(1);
  });

  it("renders a group's shared transcript with a composer", async () => {
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: {} };
    const groupTranscript = vi.fn<() => Promise<unknown[]>>(async () => [
      { id: 1, groupId: "g1", ts: 1, from: { type: "user", name: "Darrin", botId: null }, hops: 0, text: "Status please", deliveredTo: ["abc12345"] },
      { id: 2, groupId: "g1", ts: 2, from: { type: "bot", name: "Inbox Manager", botId: "abc12345" }, hops: 1, text: "All green", deliveredTo: [] },
    ]);
    testState.hub.hub = { groupTranscript };
    testState.hub.bots = [{ id: "abc12345", name: "Inbox Manager", role: "Triage", instructions: "", avatar: "", color: "", chatTitle: "t", created: 1, updated: 1, lastActivity: null, agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1 }];
    testState.hub.groups = [{ id: "g1", name: "Launch", purpose: "Ship v2", created: 1, updated: 1, members: [{ id: "abc12345", name: "Inbox Manager" }], postCount: 2, lastPost: 2 }];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 1, hubBindingName: "HUB" };

    await render(null, "g1");
    expect(container!.querySelector('[aria-current="page"]')?.textContent).toContain("Launch");
    await vi.waitFor(() => expect(container!.textContent).toContain("All green"));
    expect(container!.textContent).toContain("Status please");
    expect(groupTranscript).toHaveBeenCalledWith("g1", { limit: 200 });
    expect(container!.querySelector('textarea[placeholder="Message Launch…"]')).not.toBeNull();
  });
});

