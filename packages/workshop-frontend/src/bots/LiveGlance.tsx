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
 * Costs are respected: nothing is fetched unless the profile is already live (a sleeping session is
 * never woken for a thumbnail), the poll stops when the tab is hidden, and one screenshot every few
 * seconds is a glance, not a stream.
 */

type ProfileRow = { name: string; live: boolean; url: string | null; takeover: boolean }
type BrowserUi = {
  listProfiles(): Promise<ProfileRow[]>
  screenshot(name: string): Promise<{ dataUrl?: string; data?: string } | string>
  [Symbol.dispose]?: () => void
}

const PROFILE_POLL_MS = 15_000
const FRAME_POLL_MS = 8_000

export function LiveGlance({ bot }: { bot: Bot }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [frame, setFrame] = useState<string | null>(null)
  const [state, setState] = useState<{ name: string; url: string | null; takeover: boolean } | null>(null)
  const uiRef = useRef<BrowserUi | null>(null)
  const failsRef = useRef(0)

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
        if (!app) return
        uiRef.current = app.ui as unknown as BrowserUi
      }
      const profiles = await uiRef.current.listProfiles()
      failsRef.current = 0
      const mine = profiles.find((p) => p.name === ownName) ?? profiles.find((p) => p.name === HOUSEHOLD_PROFILE)
      if (!mine || !mine.live) { setState(null); setFrame(null); return }
      setState({ name: mine.name, url: mine.url, takeover: mine.takeover })
      const shot = await uiRef.current.screenshot(mine.name)
      const dataUrl = typeof shot === 'string' ? `data:image/jpeg;base64,${shot}`
        : shot?.dataUrl ?? (shot?.data ? `data:image/jpeg;base64,${shot.data}` : null)
      if (dataUrl) setFrame(dataUrl)
    } catch {
      // A restart or a missing grant is not news here; the glance just stays absent. One failure
      // may be a blip (keep the last frame); a second in a row means the session is gone, and a
      // stale thumbnail with a pulsing "Browsing" dot would be a lie.
      disposeUi()
      if (++failsRef.current >= 2) { setState(null); setFrame(null) }
    }
  }, [authenticatedApi, ownName, disposeUi])

  // Dispose the held stub on unmount (the polling effect below re-runs to change cadence, so the
  // stub's lifetime is the component's, not the effect's).
  useEffect(() => disposeUi, [disposeUi])

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      if (!alive) return
      await poll()
      if (!alive) return
      // Poll faster while a page is actually open, slower while just checking for one.
      timer = setTimeout(tick, state ? FRAME_POLL_MS : PROFILE_POLL_MS)
    }
    void tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
    // `state` flips the cadence; poll identity changes with the bot.
  }, [poll, state !== null])  // eslint-disable-line react-hooks/exhaustive-deps

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
