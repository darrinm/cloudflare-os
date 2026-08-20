import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthenticatedApi } from '../AuthContext'
import { computerNameFor, HOUSEHOLD_PROFILE } from './computer'
import type { Bot } from './types'

/**
 * A glance at the Bot's browser, above its conversation: a small live thumbnail while its page is
 * open, nothing at all otherwise. The point is noticing -- a Bot stuck on a login wall is visible
 * without opening anything -- not watching; the full live view and takeover are one tap away.
 *
 * Costs are respected end to end: `glance()` on the gatekeeper never launches a browser session
 * and stamps no activity (so watching cannot keep a session alive the Bot has left), the poll
 * stops when the tab is hidden, and it asks about the Bot's own profile rather than fanning out
 * over every profile that exists.
 */

type Glance = { live: boolean; url: string | null; takeover: boolean; frame: string | null }
type BrowserUi = { glance(name: string): Promise<Glance>; [Symbol.dispose]?: () => void }

const FRAME_POLL_MS = 8_000
const PROFILE_POLL_MS = 15_000
/** No browser gatekeeper granted: look again rarely, in case one appears. */
const NO_APP_POLL_MS = 60_000

export function LiveGlance({ bot }: { bot: Bot }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [frame, setFrame] = useState<string | null>(null)
  const [state, setState] = useState<{ name: string; url: string | null; takeover: boolean } | null>(null)
  const uiRef = useRef<BrowserUi | null>(null)
  const failsRef = useRef(0)
  const delayRef = useRef(PROFILE_POLL_MS)

  const ownName = computerNameFor(bot)

  // The `ui` is an RPC stub holding a server-side capability; release it whenever it is dropped.
  const disposeUi = useCallback(() => {
    try { uiRef.current?.[Symbol.dispose]?.() } catch { /* already broken */ }
    uiRef.current = null
  }, [])

  const poll = useCallback(async () => {
    if (document.hidden) return
    try {
      if (!uiRef.current) {
        const app = await authenticatedApi.getGatekeeperApp('browser')
        if (!app) { delayRef.current = NO_APP_POLL_MS; return }
        uiRef.current = app.ui as unknown as BrowserUi
      }
      let name = ownName
      let g = await uiRef.current.glance(name)
      if (!g.live) { name = HOUSEHOLD_PROFILE; g = await uiRef.current.glance(name) }
      failsRef.current = 0
      if (!g.live || !g.frame) {
        setState(null); setFrame(null)
        delayRef.current = PROFILE_POLL_MS
        return
      }
      setState({ name, url: g.url, takeover: g.takeover })
      setFrame(g.frame)
      delayRef.current = FRAME_POLL_MS
    } catch {
      // A restart or a missing grant is not news here; the glance just stays absent. One failure
      // may be a blip (keep the last frame and the stub); a second in a row means the session is
      // gone, and a stale thumbnail with a pulsing "Browsing" dot would be a lie.
      if (++failsRef.current >= 2) { disposeUi(); setState(null); setFrame(null) }
      delayRef.current = PROFILE_POLL_MS
    }
  }, [authenticatedApi, ownName, disposeUi])

  // Dispose the held stub on unmount; the poll loop's lifetime is the component's.
  useEffect(() => disposeUi, [disposeUi])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (!alive) return
      await poll()
      if (!alive) return
      // poll() sets its own cadence: faster while a page is open, slower while checking for one.
      timer = setTimeout(tick, delayRef.current)
    }
    void tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [poll])

  if (!state || !frame) return null

  const host = state.url ? state.url.replace(/^https?:\/\//, '').split('/')[0] : ''
  return (
    <button
      type="button"
      onClick={() => navigate({ to: '/gatekeepers/$appId', params: { appId: 'browser' } })}
      className="mx-3 mt-2 flex flex-none items-center gap-3 rounded-lg border border-kumo-line bg-kumo-base p-1.5 text-left hover:bg-kumo-tint"
      aria-label={`Open the live view of ${state.name}`}
    >
      <img src={frame} alt="" className="h-14 w-24 flex-none rounded object-cover object-top bg-black" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] md:text-[12px] font-medium text-kumo-default">
          <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-kumo-brand" />
          {state.takeover ? 'You have control' : 'Browsing'}
        </span>
        {host && <span className="block truncate text-[12px] md:text-[11px] text-kumo-subtle">{host}</span>}
      </span>
    </button>
  )
}

export default LiveGlance
