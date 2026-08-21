import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthenticatedApi } from '../AuthContext'
import { computerNameFor, HOUSEHOLD_PROFILE } from './computer'
import type { Bot } from './types'

/**
 * A glance at the Bot's browser, as a chip in its conversation header: a small live thumbnail while
 * its page is open, nothing at all otherwise. The point is noticing -- a Bot stuck on a login wall
 * is visible without opening anything -- not watching; the live view and takeover are one tap away.
 *
 * It lives in the header rather than the transcript because it is state, not an event: it has no
 * timestamp, and sat among the messages it read as something that had just happened, duplicating the
 * Bot's own request for the page and splitting one ask into two things to tap.
 *
 * Costs are respected end to end: `glance()` on the gatekeeper never launches a browser session
 * and stamps no activity (so watching cannot keep a session alive the Bot has left), the poll
 * stops when the tab is hidden, and it asks about the Bot's own profile rather than fanning out
 * over every profile that exists.
 */

type GlanceReport = { live: boolean; url: string | null; takeover: boolean; takeoverReason: string | null; frame: string | null }
type BrowserUi = { glance(name: string): Promise<GlanceReport>; [Symbol.dispose]?: () => void }

const FRAME_POLL_MS = 8_000
const PROFILE_POLL_MS = 15_000
/** No browser gatekeeper granted: look again rarely, in case one appears. */
const NO_APP_POLL_MS = 60_000

/**
 * The glance's data and the one navigation it offers, polled once per Bot. Two surfaces read it --
 * the header chip and the preview on the Bot's own request card -- and they must not each poll.
 */
export function useGlance(bot: Bot | null) {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [frame, setFrame] = useState<string | null>(null)
  const [state, setState] = useState<{ name: string; url: string | null; takeover: boolean; takeoverReason: string | null } | null>(null)
  const uiRef = useRef<BrowserUi | null>(null)
  const failsRef = useRef(0)
  const delayRef = useRef(PROFILE_POLL_MS)

  // Null while no Bot is open: the hook still runs (hooks cannot be conditional) but polls nothing.
  const ownName = bot ? computerNameFor(bot) : null

  // The `ui` is an RPC stub holding a server-side capability; release it whenever it is dropped.
  const disposeUi = useCallback(() => {
    try { uiRef.current?.[Symbol.dispose]?.() } catch { /* already broken */ }
    uiRef.current = null
  }, [])

  const poll = useCallback(async () => {
    if (document.hidden || !ownName) return
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
      setState({ name, url: g.url, takeover: g.takeover, takeoverReason: g.takeoverReason })
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

  const host = state?.url ? state.url.replace(/^https?:\/\//, '').split('/')[0] : ''
  // In takeover the session is already yours, so the label is not "take control" -- it says the
  // ball is in your court, and the Bot's own reason (why it handed off) is the subtitle so you know
  // what to do. Tapping deep-links straight to that profile's live view with the control sheet up,
  // where you can actually drive the page; otherwise it just opens the live view to watch.
  // "Waiting for you" is a claim about the Bot, so it needs the Bot's reason behind it. Control the
  // person took themselves (from the Browser app) stores none, and labelling that as the Bot waiting
  // would invent a request nobody made -- it reads as "You have control", which is all it is.
  const asked = !!state?.takeover && !!state.takeoverReason
  const label = asked ? 'Waiting for you' : state?.takeover ? 'You have control' : 'Browsing'
  const open = useCallback(() => {
    if (!state) return
    navigate({
      to: '/gatekeepers/$appId',
      params: { appId: 'browser' },
      search: state.takeover ? { profile: state.name, takeover: '1' } : { profile: state.name },
    })
  }, [navigate, state])

  return { live: state && frame ? { ...state, frame, host, asked, label } : null, open }
}

export type Glance = NonNullable<ReturnType<typeof useGlance>['live']>

/**
 * The header chip. Which page is open and who is driving it is a *state*: it has no timestamp, so
 * it does not belong in a transcript of things that happened, where it reads as an event that just
 * occurred and competes with the Bot's own request for the same tap.
 */
export function GlanceChip({ live, onOpen }: { live: Glance | null; onOpen: () => void }) {
  if (!live) return null
  const { frame, asked, label, host, name, takeover, takeoverReason } = live
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex flex-none items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-left ${
        asked ? 'border-kumo-brand/50 bg-kumo-brand/10 hover:bg-kumo-brand/15' : 'border-kumo-line hover:bg-kumo-tint'
      }`}
      aria-label={takeover ? `Take over ${name}'s browser` : `Open the live view of ${name}`}
      title={asked ? `${label}: ${takeoverReason}` : `${label}${host ? ` · ${host}` : ''}`}
    >
      <img src={frame} alt="" className="h-5 w-8 flex-none rounded-sm object-cover object-top bg-black" />
      <span className={`flex items-center gap-1 text-[12px] md:text-[11px] font-medium ${asked ? 'text-kumo-brand' : 'text-kumo-subtle'}`}>
        <span className={`h-1.5 w-1.5 flex-none animate-pulse rounded-full ${asked ? 'bg-kumo-brand' : 'bg-kumo-subtle'}`} />
        <span className="hidden sm:inline">{label}</span>
      </span>
    </button>
  )
}

/**
 * The page as it looks right now, on the Bot's own request card. The card asks you to drive a page,
 * so the page belongs on it: a preview on one row and the button on another splits one request into
 * two things to look at, and the row carrying the picture is the one that cannot be acted on.
 */
export function GlancePreview({ live }: { live: Glance | null }) {
  if (!live) return null
  return (
    <div className="mt-2 flex items-center gap-2">
      <img src={live.frame} alt="" className="h-10 w-16 flex-none rounded border border-kumo-line object-cover object-top bg-black" />
      <span className="min-w-0 text-[13px] md:text-[12px] text-kumo-subtle">
        <span className="block truncate font-medium text-kumo-default">{live.host}</span>
        <span className="block truncate">The page waiting for you</span>
      </span>
    </div>
  )
}

export default GlanceChip
