import { Button } from '@cloudflare/kumo'
import { useAuthenticatedApi } from '../AuthContext'
import { usePushNotifications } from '../usePushNotifications'

/**
 * Profile → Notifications: opt this browser in to Web Push for Bots (a Bot finished a turn or is
 * waiting on you while you weren't looking). Renders nothing when the deployment has no VAPID keys
 * or the browser cannot push, so most deployments never see it.
 */
export default function NotificationSettings() {
  const { authenticatedApi } = useAuthenticatedApi()
  const { state, enable, disable } = usePushNotifications(authenticatedApi)
  if (state.status === 'unavailable' || state.status === 'unsupported' || state.status === 'loading') return null
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-[12px] font-medium uppercase tracking-[0.08em] text-kumo-inactive">Notifications</h2>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-kumo-line bg-kumo-base px-5 py-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-kumo-default">Push notifications on this device</div>
          <div className="text-[12px] text-kumo-subtle">
            {state.status === 'on' && 'On. Bots will notify you here when they finish work or need you.'}
            {state.status === 'off' && 'Off. Turn on to hear from your Bots while you are away.'}
            {state.status === 'denied' && 'Blocked by the browser. Allow notifications for this site in the browser settings, then reload.'}
          </div>
        </div>
        {state.status === 'on' && <Button variant="secondary" onClick={() => disable().catch(() => {})}>Turn off</Button>}
        {state.status === 'off' && <Button variant="primary" onClick={() => enable().catch(() => {})}>Turn on</Button>}
      </div>
    </section>
  )
}
