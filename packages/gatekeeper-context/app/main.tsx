// Entrypoint for the sandboxed Context Library iframe. All data flows through the host-injected
// ContextApi RPC capability.

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider, Toasty } from '@cloudflare/kumo'
import { RpcTarget, newMessagePortRpcSession } from 'capnweb'
import type { RpcStub } from 'capnweb'
import type { ContextApi } from '../src/context-types'
import type {
  GatekeeperAppTheme,
  GatekeeperAppThemeReceiver,
} from '@gadgets/workshop-shared/theme'
import type {
  GatekeeperAppHeaderAction,
  GatekeeperAppHeaderReceiver,
} from '@gadgets/workshop-shared/header-actions'
import ContextLibraryPage from './ContextLibraryPage'
import {
  ContextApiProvider,
  HeaderBarProvider,
  PresentationProvider,
  type HeaderActionSpec,
  type PresentAck,
} from './bridge'
import { applyAppTheme } from './theme'
import './styles.css'
import ErrorBoundary from './ErrorBoundary'
import { installErrorReporting, reportIssue } from './error-reporting'

installErrorReporting()

// The capability the iframe exposes back to the host: a receiver for theme pushes and phone
// app-bar callbacks. The bar hooks are mutable because the React tree that handles them mounts
// after the RPC session is up (HeaderBarBridge wires them in).
class AppIframe extends RpcTarget implements GatekeeperAppThemeReceiver, GatekeeperAppHeaderReceiver {
  onHeaderActionTap: (id: string) => void = () => {}
  onHeaderPresented: (presented: boolean) => void = () => {}

  setTheme(theme: GatekeeperAppTheme): void {
    applyAppTheme(theme)
  }

  onHeaderAction(id: string): void {
    this.onHeaderActionTap(id)
  }

  setHeaderPresented(presented: boolean): void {
    this.onHeaderPresented(presented)
  }
}

interface HostCapability extends RpcTarget {
  readonly ui: RpcStub<ContextApi>
  // Grow the iframe to a full-viewport overlay for app-level modals (`true`) or restore it (`false`).
  setPresenting(active: boolean): Promise<PresentAck>
  // Returns the current theme and calls back on `receiver` whenever it changes.
  subscribeTheme(receiver: GatekeeperAppThemeReceiver): Promise<GatekeeperAppTheme>
  // Registers the page's phone app-bar actions; resolves to whether the bar presents them now.
  setHeaderActions(
    actions: GatekeeperAppHeaderAction[],
    receiver: GatekeeperAppHeaderReceiver,
  ): Promise<boolean>
}

/** Carries the host's phone app bar into React: registration down, taps and presentation up. */
function HeaderBarBridge({ host, iframe, children }: {
  host: HostCapability
  iframe: AppIframe
  children: ReactNode
}) {
  const [presented, setPresented] = useState(false)
  const handlersRef = useRef<Map<string, () => void>>(new Map())
  iframe.onHeaderActionTap = (id) => handlersRef.current.get(id)?.()
  iframe.onHeaderPresented = setPresented
  const setActions = useCallback((specs: HeaderActionSpec[]) => {
    handlersRef.current = new Map(specs.map((spec) => [spec.id, spec.onAction]))
    // An older host without the method rejects: the page just keeps its inline header.
    host
      .setHeaderActions(specs.map(({ onAction: _, ...action }) => action), iframe)
      .then(setPresented)
      .catch(() => {})
  }, [host, iframe])
  const value = useMemo(() => ({ presented, setActions }), [presented, setActions])
  return <HeaderBarProvider value={value}>{children}</HeaderBarProvider>
}

function main() {
  const root = document.getElementById('root')
  if (!root) throw new Error('missing #root')

  const { port1, port2 } = new MessageChannel()
  // Opaque-origin iframes can't name their parent origin. The parent accepts this handshake only from
  // this frame + null origin; the message only transfers a private port.
  window.parent.postMessage({ type: 'handshake' }, '*', [port2])
  const iframe = new AppIframe()
  const host = newMessagePortRpcSession<HostCapability>(port1, iframe)
  // The initial theme comes back from the call; later changes arrive via iframe.setTheme().
  host.subscribeTheme(iframe).then(applyAppTheme).catch(() => {})

  createRoot(root, {
    onUncaughtError: (error) => reportIssue('context.react-root', error, {
      handled: false, severity: 'fatal', captureMechanism: 'react',
    }),
  }).render(
    <ErrorBoundary><ContextApiProvider value={host.ui}>
      <PresentationProvider setPresenting={(active) => host.setPresenting(active)}>
        <HeaderBarBridge host={host} iframe={iframe}>
          <TooltipProvider>
            <Toasty>
              <ContextLibraryPage />
            </Toasty>
          </TooltipProvider>
        </HeaderBarBridge>
      </PresentationProvider>
    </ContextApiProvider></ErrorBoundary>,
  )
}

main()
