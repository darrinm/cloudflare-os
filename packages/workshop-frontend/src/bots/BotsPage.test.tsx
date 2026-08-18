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
    hub: {
      hub: null as unknown,
      bots: [] as unknown[],
      groups: [] as unknown[],
      info: null as unknown,
      error: null as string | null,
      version: 0,
      lastUpdate: null,
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
vi.mock("./useBotsHub", () => ({ useBotsHub: () => testState.hub }));
vi.mock("../useActions", () => ({ useActions: () => ({ actionsById: new Map(), isReady: true }) }));

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
    testState.hub.hub = { listMemories: async () => [], listRoutines: async () => [], activity: async () => [] };
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
    expect(container!.textContent).toContain("none — give one in Grants");
    // Grants offer running a hub skill; the roster header offers the Skills manager.
    expect(container!.textContent).toContain("Run a skill…");
    expect(container!.querySelector('[aria-label="Skills"]')).not.toBeNull();
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

