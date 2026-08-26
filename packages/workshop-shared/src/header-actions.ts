import type { RpcTarget } from "capnweb";

/** The icon vocabulary of the phone app bar. */
export const HEADER_ACTION_KINDS = ["refresh", "more", "add"] as const;

/**
 * One action a sandboxed gatekeeper app offers for the phone app bar. Below `md` the Workshop
 * shell's top bar is the app bar; an app registers its few surviving header controls here so the
 * bar carries them and the app can collapse its own header row instead of spending a strip of
 * phone chrome on one or two buttons.
 */
export interface GatekeeperAppHeaderAction {
  /** App-chosen identifier, echoed back through `onHeaderAction`. */
  id: string;
  /** Accessible name (tooltip/aria-label). */
  label: string;
  /** The bar icon. */
  kind: (typeof HEADER_ACTION_KINDS)[number];
}

/** The app-side capability the host calls back with bar taps and presentation changes. */
export interface GatekeeperAppHeaderReceiver extends RpcTarget {
  /** A bar button was tapped. */
  onHeaderAction(id: string): void;
  /**
   * Whether the host bar is currently presenting the actions (phone widths). While true the app
   * should hide its own header controls; the host pushes it once on registration and again as
   * the viewport crosses the breakpoint.
   */
  setHeaderPresented(presented: boolean): void;
}

// Upper bounds on one registration; the frame is untrusted.
const MAX_HEADER_ACTIONS = 4;
const MAX_HEADER_ACTION_ID = 64;
const MAX_HEADER_ACTION_LABEL = 40;

/**
 * Validates an untrusted registration, returning a defensive copy. Throws on anything out of
 * shape rather than silently dropping entries, so a misbehaving app fails loudly in development.
 */
export function parseHeaderActions(actions: unknown): GatekeeperAppHeaderAction[] {
  if (!Array.isArray(actions) || actions.length > MAX_HEADER_ACTIONS) {
    throw new TypeError("Invalid header actions.");
  }
  // The id is the bar button's React key and the only handle a tap is dispatched under, so a
  // repeat would render duplicate keys and leave which control a tap reaches undefined.
  const seen = new Set<string>();
  return actions.map((action) => {
    const { id, label, kind } = (action ?? {}) as GatekeeperAppHeaderAction;
    if (
      typeof id !== "string" || !id || id.length > MAX_HEADER_ACTION_ID || seen.has(id) ||
      typeof label !== "string" || !label || label.length > MAX_HEADER_ACTION_LABEL ||
      !(HEADER_ACTION_KINDS as readonly string[]).includes(kind)
    ) {
      throw new TypeError("Invalid header action.");
    }
    seen.add(id);
    return { id, label, kind };
  });
}

// ---------------------------------------------------------------------------
// App-side client. An app bundle has exactly one bar, so this is a module-level singleton: the
// entrypoint forwards the receiver callbacks here and wires the host registrar; pages register
// their actions and subscribe to whether the bar is presenting them.
// ---------------------------------------------------------------------------

/** One bar action plus its in-app handler; the id/label/kind half crosses the RPC boundary. */
export type GatekeeperAppHeaderActionSpec = GatekeeperAppHeaderAction & { onAction: () => void };

let presented = false;
const listeners = new Set<() => void>();

/** Receiver callback: the host bar started or stopped presenting the registered actions. */
export function setHeaderPresented(next: boolean): void {
  if (presented === next) return;
  presented = next;
  listeners.forEach((listener) => listener());
}

export function getHeaderPresented(): boolean {
  return presented;
}

export function subscribeHeaderPresented(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let handlers = new Map<string, () => void>();
let registrar: ((actions: GatekeeperAppHeaderAction[]) => void) | null = null;
let registered: GatekeeperAppHeaderAction[] | null = null;

/** Receiver callback: a bar button was tapped. */
export function dispatchHeaderAction(id: string): void {
  handlers.get(id)?.();
}

/**
 * Wires the host registrar (the entrypoint's setHeaderActions RPC call). Actions registered
 * before wiring are flushed through it.
 */
export function wireHeaderBarRegistrar(
  register: (actions: GatekeeperAppHeaderAction[]) => void,
): void {
  registrar = register;
  if (registered) register(registered);
}

/** Replace the registered action set; register `[]` for screen states with no bar actions. */
export function setHeaderBarActions(specs: GatekeeperAppHeaderActionSpec[]): void {
  // The handlers always follow the latest call: the closures change even when the ids don't.
  handlers = new Map(specs.map((spec) => [spec.id, spec.onAction]));
  const actions = specs.map(({ onAction: _, ...action }) => action);
  if (
    registered?.length === actions.length &&
    registered.every((prev, i) =>
      prev.id === actions[i].id && prev.label === actions[i].label && prev.kind === actions[i].kind,
    )
  ) {
    return;
  }
  registered = actions;
  registrar?.(actions);
}
