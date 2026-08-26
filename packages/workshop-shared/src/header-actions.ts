import type { RpcTarget } from "capnweb";

/**
 * One action a sandboxed gatekeeper app offers for the phone app bar. Below `md` the Workshop
 * shell's top bar is the app bar; an app registers its few surviving header controls here so the
 * bar carries them and the app can collapse its own header row instead of spending a strip of
 * phone chrome on one or two buttons.
 */
export interface GatekeeperAppHeaderAction {
  /** App-chosen identifier, echoed back through `onHeaderAction`. */
  id: string;
  /** Accessible name (tooltip/aria-label); also the visible text when `kind` is absent. */
  label: string;
  /** A known icon. Omitted renders the label as a text button. */
  kind?: "refresh" | "more" | "add";
}

/** The app-side capability the host calls back with bar taps and presentation changes. */
export interface GatekeeperAppHeaderReceiver extends RpcTarget {
  /** A bar button was tapped. */
  onHeaderAction(id: string): void;
  /**
   * Whether the host bar is currently presenting the actions (phone widths). While true the app
   * should hide its own header controls; the host pushes changes as the viewport crosses the
   * breakpoint.
   */
  setHeaderPresented(presented: boolean): void;
}

/** Upper bounds on one registration; the frame is untrusted. */
export const MAX_HEADER_ACTIONS = 4;
export const MAX_HEADER_ACTION_ID = 64;
export const MAX_HEADER_ACTION_LABEL = 40;

const HEADER_ACTION_KINDS = new Set(["refresh", "more", "add"]);

/**
 * Validates an untrusted registration, returning a defensive copy. Throws on anything out of
 * shape rather than silently dropping entries, so a misbehaving app fails loudly in development.
 */
export function parseHeaderActions(actions: unknown): GatekeeperAppHeaderAction[] {
  if (!Array.isArray(actions) || actions.length > MAX_HEADER_ACTIONS) {
    throw new TypeError("Invalid header actions.");
  }
  return actions.map((action) => {
    const { id, label, kind } = action as GatekeeperAppHeaderAction;
    if (
      typeof id !== "string" || !id || id.length > MAX_HEADER_ACTION_ID ||
      typeof label !== "string" || !label || label.length > MAX_HEADER_ACTION_LABEL ||
      (kind !== undefined && !HEADER_ACTION_KINDS.has(kind))
    ) {
      throw new TypeError("Invalid header action.");
    }
    return kind === undefined ? { id, label } : { id, label, kind };
  });
}
