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
    // The live glance polls the Browser gatekeeper app; null means "no browser granted", which is
    // what most of these tests want. `glance` is swapped in by the tests that care.
    actions: { actionsById: new Map<number, unknown>(), isReady: true },
    glance: vi.fn<(name: string) => Promise<unknown>>(async () => ({ live: false, url: null, takeover: false, takeoverReason: null, frame: null })),
    authenticatedApi: {
      listModels, listOutputs, newGadgetFromBlueprint: vi.fn<() => unknown>(),
      getGatekeeperApp: async () => ({ ui: { glance: (n: string) => testState.glance(n) } }),
    },
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
      reconnect: vi.fn<() => void>(),
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
vi.mock("../useActions", () => ({ useActions: () => testState.actions }));
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

  it("restores the tab you were on, so back from a Bot does not drop you on Activity", async () => {
    // The tab is component state, and opening a Bot navigates to a new route that remounts the page.
    // Without persistence the tab reset to Activity, so the back arrow always landed there instead
    // of the list you came from. It is remembered per browser now.
    localStorage.setItem("bots:view", "roster");
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.hub.bots = [];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 0, hubBindingName: "HUB" };

    await render(null);
    const tab = [...container!.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Bots");
    expect(tab?.getAttribute("aria-selected")).toBe("true");
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

  it("loads a Bot's conversation without a hooks-order crash once its chat resolves", async () => {
    // The chat is looked up asynchronously, so the first render has no chatId and returns early.
    // A hook placed after that return runs only on the second render, and React throws #310
    // (a different hook count between renders). It surfaces only when the chat is not found on the
    // first paint -- a slow connection -- which is why the smoke tests, whose stub never resolved a
    // chat, never hit it. Here the chat resolves, forcing the null -> set re-render.
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: {
      listChats: async () => [{ id: 7, title: "Bot: Scout [abc12345]" }],
      getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }),
    } };
    testState.hub.hub = { listMemories: async () => [], listRoutines: async () => [], activity: async () => [], costs: async () => ({ botId: "abc12345", totalUsd: 0, totalTokens: 0, turns: 0, chats: 0, todayUsd: 0, dailyCapUsd: null }) };
    testState.hub.bots = [{
      id: "abc12345", name: "Scout", role: "Reads the web", instructions: "", avatar: "", color: "",
      chatTitle: "Bot: Scout [abc12345]", created: 1, updated: 1, lastActivity: null,
      agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1,
    }];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 1, hubBindingName: "HUB", revision: 12 };

    await render("abc12345");
    // The mocked ChatInterface renders once the chat id lands; getting here without throwing is the
    // assertion -- the old code crashed the whole page on this exact transition.
    await vi.waitFor(() => expect(container!.querySelector('[data-testid="chat"]')).not.toBeNull());
  });


  it("shows the live browser as a header chip, not as an entry in the transcript", async () => {
    // The page a Bot has open is state, not an event: it has no timestamp, so it belongs beside the
    // Bot's name and not among the messages, where it read as something that had just happened and
    // competed with the Bot's own request for the same tap.
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: { getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }) } };
    testState.glance = vi.fn(async () => ({
      live: true, url: "https://www.amazon.com/ap/signin", takeover: true,
      takeoverReason: "Sign in to Amazon", frame: "data:image/jpeg;base64,x",
    }));
    const bot = {
      id: "abc12345", name: "Scout", role: "Reads the web", instructions: "", avatar: "", color: "",
      chatTitle: "Bot: Scout [abc12345]", created: 1, updated: 1, lastActivity: null,
      agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1,
    };
    testState.hub.hub = { listMemories: async () => [], listRoutines: async () => [], activity: async () => [], costs: async () => ({ botId: "abc12345", totalUsd: 0, totalTokens: 0, turns: 0, chats: 0, todayUsd: 0, dailyCapUsd: null }) };
    testState.hub.bots = [bot];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 1, hubBindingName: "HUB" };

    await render("abc12345");
    const chip = await vi.waitFor(() => {
      const el = container!.querySelector('[aria-label^="Take over"]');
      if (!el) throw new Error("no glance chip");
      return el;
    });
    // In the header, beside the Bot's name -- and the takeover reason is what it reports.
    expect(chip.closest("header")).not.toBeNull();
    expect(chip.textContent).toContain("Waiting for you");
    expect(chip.getAttribute("title")).toContain("Sign in to Amazon");
  });

  it("pins a Bot blocked on an approval to the feed, which sees no hub event for it", async () => {
    // A gatekeeper approval lives in the workspace's action log, not the hub's events, so the
    // landing screen -- whose whole job is "is anything waiting on me?" -- could not see the one
    // thing that hard-blocks a Bot.
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: { getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }) } };
    testState.actions = { isReady: true, actionsById: new Map<number, unknown>([[1, {
      id: 1, type: "action", state: "pending", resourceTitle: "Browser", createdAt: new Date(1),
      description: {
        title: "Take over the browser: Sign in to Amazon", description: "", implementsRevert: false,
        awaitDecision: true, open: { path: "/gatekeepers/browser?profile=scout-abc12345&takeover=1", label: "Take control" },
      },
    }]]) };
    testState.hub.hub = { listMemories: async () => [], listRoutines: async () => [], activity: async () => [], costs: async () => ({ botId: "abc12345", totalUsd: 0, totalTokens: 0, turns: 0, chats: 0, todayUsd: 0, dailyCapUsd: null }) };
    testState.hub.bots = [{
      id: "abc12345", name: "Scout", role: "Reads the web", instructions: "", avatar: "", color: "",
      chatTitle: "Bot: Scout [abc12345]", created: 1, updated: 1, lastActivity: null,
      agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1,
    }];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 1, hubBindingName: "HUB" };

    await render(null);
    // Named for the Bot it blocks, carrying the Bot's own reason, and flagged as waiting.
    await vi.waitFor(() => expect(container!.textContent).toContain("Scout needs you: Take over the browser: Sign in to Amazon"));
    expect(container!.textContent).toContain("Waiting for you");
  });

  it("stops the update spinner even when the hub never answers again", async () => {
    // Taking a new hub revision restarts the gadget, which kills the page's stub. A call on a dead
    // stub does not fail -- it never answers -- so refreshing through it left the toast on screen
    // and the spinner turning on "Reconnecting..." for ever. The page reconnects instead, and the
    // spinner is released in a finally so nothing above it can strand the button.
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.hub.refreshBots = vi.fn<() => Promise<void>>(() => new Promise(() => {}));
    testState.hub.reconnect = vi.fn<() => void>();
    const updateFromBlueprint = vi.fn(async () => ({ updated: ["server.js"], unchanged: [] }));
    testState.workspaceOpen.overseer = { stub: {
      bundledBlueprintRevision: async () => 12,
      getGadget: () => ({
        updateFromBlueprint,
        connectToGadget: async () => ({ getInfo: async () => ({ revision: 12 }), [Symbol.dispose]() {} }),
        listBindings: async () => [],
        [Symbol.dispose]() {},
      }),
    } };
    testState.hub.hub = { listSkills: async () => [], listMemories: async () => [], listRoutines: async () => [], activity: async () => [] };
    testState.hub.bots = [];
    // Behind the shipped revision, so the dialog offers the update at all.
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 0, hubBindingName: "HUB", revision: 8 };

    await render(null);

    const click = async (el: Element | null | undefined) => {
      if (!el) throw new Error("not found");
      await act(async () => { (el as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); });
    };
    await click(container!.querySelector('[aria-label="Skills"]'));
    const update = await vi.waitFor(() => {
      const el = [...document.querySelectorAll("button")].find((b) => /Update Bots/.test(b.textContent ?? ""));
      if (!el) throw new Error("no Update Bots button");
      return el;
    });
    await click(update);
    await act(async () => { await new Promise((r) => setTimeout(r, 1700)); });

    expect(updateFromBlueprint).toHaveBeenCalled();
    // Reconnected rather than refreshed through the dead stub...
    expect(testState.hub.reconnect).toHaveBeenCalled();
    expect(testState.hub.refreshBots).not.toHaveBeenCalled();
    // ...and nothing is left spinning.
    expect(document.body.textContent).not.toContain("Reconnecting");
  });

  it("settles a takeover card once the person has handed the page back", async () => {
    // Approving a takeover card IS the hand-back, but the natural place to finish is the Browser
    // app's Done, which can only release the page. Seeing the page back with the request still
    // open, the conversation records it -- otherwise the Bot waits forever on a hidden second step.
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    const approveAction = vi.fn(async () => {});
    testState.workspaceOpen.overseer = { stub: {
      approveAction,
      getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }),
    } };
    // The page is back in the Bot's hands: takeover is no longer active.
    testState.glance = vi.fn(async () => ({
      live: true, url: "https://www.amazon.com/", takeover: false, takeoverReason: null,
      frame: "data:image/jpeg;base64,x",
    }));
    const pending = (id: number, path?: string) => [id, {
      id, type: "action", state: "pending", resourceTitle: "Browser", createdAt: new Date(1),
      description: { title: "Take over the browser", description: "", implementsRevert: false, ...(path ? { open: { path, label: "Take control" } } : {}) },
    }] as [number, unknown];
    testState.actions = { isReady: true, actionsById: new Map<number, unknown>([
      pending(1, "/gatekeepers/browser?profile=scout-abc12345&takeover=1"),
      // Another profile's takeover, and a card that is not a takeover at all: neither is ours.
      pending(2, "/gatekeepers/browser?profile=other-profile&takeover=1"),
      pending(3),
    ]) };
    const bot = {
      id: "abc12345", name: "Scout", role: "Reads the web", instructions: "", avatar: "", color: "",
      chatTitle: "Bot: Scout [abc12345]", created: 1, updated: 1, lastActivity: null,
      agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1,
    };
    testState.hub.hub = { listMemories: async () => [], listRoutines: async () => [], activity: async () => [], costs: async () => ({ botId: "abc12345", totalUsd: 0, totalTokens: 0, turns: 0, chats: 0, todayUsd: 0, dailyCapUsd: null }) };
    testState.hub.bots = [bot];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 1, hubBindingName: "HUB" };

    await render("abc12345");
    await vi.waitFor(() => expect(approveAction).toHaveBeenCalled());
    // Only this profile's takeover card, and only once.
    expect(approveAction.mock.calls).toEqual([[1]]);
  });


  it("offers the takeover walk-through once, to a Bot with a browser, and starts it through the Bot", async () => {
    testState.listOutputs.mockResolvedValue({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    // Scout has a browser (the hub's BROWSER_SCOUT1 binding); that is what makes it the one to ask.
    testState.workspaceOpen.overseer = { stub: { getGadget: () => ({ listBindings: async () => [{ name: "BROWSER_SCOUT1", target: 7, resourceTitle: "Browser profile: household" }], [Symbol.dispose]() {} }) } };
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
    expect(card!.textContent).toContain("Scout opens it and asks for the page");

    const tryIt = [...card!.querySelectorAll("button")].find((b) => b.textContent === "Try it") as HTMLButtonElement;
    // Nothing to try until a site is named; a URL is fine, the host is what travels.
    expect(tryIt.disabled).toBe(true);
    const siteInput = card!.querySelector('input[aria-label="Site"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(siteInput, "https://github.com/login");
      siteInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(tryIt.disabled).toBe(false);
    await act(async () => { tryIt.click(); await new Promise((r) => setTimeout(r, 30)); });
    // The real loop: Scout is asked to open a site and request the takeover; the person lands in
    // its conversation; the hub remembers the offer was taken.
    expect(hub.send.mock.calls[0]?.[0]).toBe("scout1");
    expect(String(hub.send.mock.calls[0]?.[1])).toMatch(/^Let's try a takeover on github\.com\./);
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

  it("does not offer the takeover walk-through when no Bot has a browser", async () => {
    testState.listOutputs.mockResolvedValue({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: { getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }) } };
    const hub = { getMeta: vi.fn(async () => null), setMeta: vi.fn(), send: vi.fn(), activity: async () => [] };
    testState.hub.hub = hub;
    testState.hub.bots = [{ id: "fixer1", name: "Fixer", role: "Fixes", instructions: "", avatar: "", color: "", chatTitle: "Bot: Fixer", created: 1, updated: 1, lastActivity: null, agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1 }];

    await render(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(container!.querySelector('[aria-label="Try a takeover"]')).toBeNull();
    // Nothing was spent: the flag is untouched, so the card appears once a Bot gets a browser.
    expect(hub.setMeta).not.toHaveBeenCalled();
  });

  it("keeps a ticked grant ticked while the page re-renders", async () => {
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    const listBindings = vi.fn<() => Promise<Array<{ name: string; target: number; resourceTitle: string }>>>(async () => []);
    testState.workspaceOpen.overseer = { stub: { listModels: testState.listModels, getGadget: () => ({ listBindings, [Symbol.dispose]() {} }) } };
    const bot = {
      id: "abc12345", name: "Researcher", role: "Digs", instructions: "", avatar: "", color: "",
      chatTitle: "Bot: Researcher [abc12345]", created: 1, updated: 1, lastActivity: null,
      agentReady: true, spawnerBinding: "AGENT_SPAWNER", agentGeneration: 1,
    };
    testState.hub.hub = { listMemories: async () => [], listRoutines: async () => [], activity: async () => [], costs: async () => ({ botId: "abc12345", totalUsd: 0, totalTokens: 0, turns: 0, chats: 0, todayUsd: 0, dailyCapUsd: null }) };
    testState.hub.bots = [bot];
    testState.hub.info = { version: 1, hasSpawner: true, botCount: 1, hubBindingName: "HUB" };

    await render("abc12345");
    const openGrants = [...container!.querySelectorAll("button")].find((b) => b.textContent === "Change what it can use…")!;
    await act(async () => { openGrants.click(); });
    // The dialog renders in a portal, outside the test container.
    const findBrowserBox = () => [...document.querySelectorAll('input[type="checkbox"]')].find((i) => i.parentElement?.textContent?.includes("BROWSER")) as HTMLInputElement | undefined;
    await vi.waitFor(() => expect(findBrowserBox()).toBeDefined());
    const browserBox = findBrowserBox()!;
    expect(browserBox.checked).toBe(false);
    await act(async () => { browserBox.click(); });
    expect(browserBox.checked).toBe(true);
    // Anything that re-renders the page (a hub event, a toast) used to re-run the dialog's load
    // and put the boxes back the way they were.
    const loads = listBindings.mock.calls.length;
    await act(async () => { root!.render(<BotsPageContent botId="abc12345" />); await new Promise((r) => setTimeout(r, 30)); });
    expect(browserBox.checked).toBe(true);
    expect(listBindings).toHaveBeenCalledTimes(loads);
  });

  it("renders a group's shared transcript with a composer", async () => {
    testState.listOutputs.mockResolvedValueOnce({
      outputs: [{ workspaceId: "ws1", workpieceId: 0, output: { id: "bots" }, created: new Date(1) }] as never,
      catchingUp: false,
    });
    testState.workspaceOpen.overseer = { stub: { getGadget: () => ({ listBindings: async () => [], [Symbol.dispose]() {} }) } };
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

