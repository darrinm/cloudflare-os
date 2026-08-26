import { createRoot } from "react-dom/client";
import { RpcTarget, newMessagePortRpcSession, type RpcStub } from "capnweb";
import type {
  GatekeeperAppTheme,
  GatekeeperAppThemeReceiver,
} from "@gadgets/workshop-shared/theme";
import type {
  GatekeeperAppHeaderAction,
  GatekeeperAppHeaderReceiver,
} from "@gadgets/workshop-shared/header-actions";
import SchedulerPage, {
  CREATE_SCHEDULE_PROMPT,
  type ScheduleManagementClient,
} from "./SchedulerPage";
import ErrorBoundary from "./ErrorBoundary";
import { installErrorReporting, reportIssue } from "./error-reporting";
import { applyAppTheme } from "./theme";
import { setHeaderPresented } from "./headerBar";
import "./styles.css";

installErrorReporting();

class AppIframe
  extends RpcTarget
  implements GatekeeperAppThemeReceiver, GatekeeperAppHeaderReceiver
{
  constructor(private readonly onHeaderActionTap: (id: string) => void) {
    super();
  }

  setTheme(theme: GatekeeperAppTheme): void {
    applyAppTheme(theme);
  }

  onHeaderAction(id: string): void {
    this.onHeaderActionTap(id);
  }

  setHeaderPresented(presented: boolean): void {
    setHeaderPresented(presented);
  }
}

interface HostCapability extends RpcTarget {
  readonly ui: RpcStub<ScheduleManagementClient>;
  subscribeTheme(receiver: GatekeeperAppThemeReceiver): Promise<GatekeeperAppTheme>;
  setHeaderActions(
    actions: GatekeeperAppHeaderAction[],
    receiver: GatekeeperAppHeaderReceiver,
  ): Promise<boolean>;
  openWorkspace(workspaceId: string, gadgetId?: number): Promise<void>;
  resolveWorkspaceTitles(ids: string[]): Promise<(string | null)[]>;
  openPrompt(prompt: string): Promise<void>;
}

function main() {
  const element = document.getElementById("root");
  if (!element) throw new Error("Missing Scheduler app root.");

  const { port1, port2 } = new MessageChannel();
  window.parent.postMessage({ type: "handshake" }, "*", [port2]);
  const iframe = new AppIframe((id) => {
    if (id === "create") void host.openPrompt(CREATE_SCHEDULE_PROMPT).catch(() => {});
  });
  const host = newMessagePortRpcSession<HostCapability>(port1, iframe);
  host
    .subscribeTheme(iframe)
    .then(applyAppTheme)
    .catch(() => {});
  // On phone widths the shell app bar carries the page's one action; the page hides its own
  // header block while the bar presents it. An older host without the method rejects: ignored.
  host
    .setHeaderActions([{ id: "create", label: "Create schedule", kind: "add" }], iframe)
    .then(setHeaderPresented)
    .catch(() => {});

  createRoot(element, {
    onUncaughtError: (error) =>
      reportIssue("scheduler.react-root", error, {
        handled: false,
        severity: "fatal",
        captureMechanism: "react",
      }),
  }).render(
    <ErrorBoundary>
      <SchedulerPage
        api={host.ui}
        openWorkspace={(workspaceId, gadgetId) => host.openWorkspace(workspaceId, gadgetId)}
        resolveWorkspaceTitles={(ids) => host.resolveWorkspaceTitles(ids)}
        openPrompt={(prompt) => host.openPrompt(prompt)}
      />
    </ErrorBoundary>,
  );
}

main();
