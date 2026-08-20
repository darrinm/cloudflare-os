import { createFileRoute } from '@tanstack/react-router'
import GatekeeperAppPage from '../GatekeeperAppPage'
import { useDocumentTitle } from '../useDocumentTitle'
import { useGatekeeperApps } from '../useGatekeeperApps'

/**
 * Generic host for any gatekeeper-served management app (VendorDescription.providesUi). The set of
 * apps and their nav entries come from the backend (useGatekeeperApps); nothing about a specific
 * gatekeeper is hardcoded here. GatekeeperAppPage renders "not available" if the id isn't bound.
 *
 * The file is `gatekeepers_.$appId` (trailing underscore) so the URL is /gatekeepers/$appId without
 * nesting inside the /gatekeepers connectors page's component.
 *
 * Search params are handed to the app untouched (AppUiContext.params), so a link can name a place
 * in it -- `/gatekeepers/browser?profile=x&takeover=1` opens the Browser app on that profile.
 */
export const Route = createFileRoute('/gatekeepers_/$appId')({
  component: GatekeeperApp,
  validateSearch: (search: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(Object.entries(search).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .map(([k, v]) => [k, String(v)])),
})

function GatekeeperApp() {
  const { appId } = Route.useParams()
  const params = Route.useSearch()
  const app = useGatekeeperApps().find((a) => a.id === appId)
  useDocumentTitle(app?.title ?? 'App')
  return <GatekeeperAppPage appId={appId} params={params} />
}
