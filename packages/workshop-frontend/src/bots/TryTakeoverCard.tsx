import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@cloudflare/kumo'
import { BotAvatar } from './BotsPage'
import { computerBindingNameFor } from './computer'
import type { Bot, HubApi } from './types'

/**
 * The one thing a new person has not seen yet: a Bot hitting a sign-in and handing the page to
 * them. The card does not explain the loop; it starts it, through the real path -- the Bot asks
 * which site, opens it, requests the takeover, and the usual card and Browser app do the rest.
 */

/**
 * Among the Bots that have a browser (the walk-through is pointless without one): Scout by
 * preference, as the example Bot set up for it, else whoever is first. Null means no card.
 */
export function pickTakeoverBot(bots: Bot[], hasBrowser: (botId: string) => boolean): Bot | null {
  const able = bots.filter((b) => hasBrowser(b.id))
  return able.find((b) => b.name === 'Scout') ?? able[0] ?? null
}

/** The one message the card sends: no round-trip, the site is already chosen. */
export const tryTakeoverTask = (site: string) =>
  `Let's try a takeover on ${site}. Open it, get to its sign-in page, then call requestTakeover with a one-line reason so I can sign in myself. ` +
  "Never type credentials. After I hand the browser back, take a snapshot and tell me in one line who I am signed in as."

/** A bare host, or null when the text is not one. */
export function normalizeSite(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) ? t : null
}

/** What the offer needs from the hub's gadget client: its bindings, once. */
type HubGadget = { getGadget(workpieceId: number): { listBindings(): Promise<Array<{ name: string }>>; [Symbol.dispose](): void } }

/**
 * The offer, once per hub: the flag lives on the hub (like firstRun) so a phone and a laptop
 * agree, and it is read before anything else -- the bindings, which say who has a browser, are
 * fetched only for a hub that has not been offered yet, and once per hub connection (binding a
 * resource restarts the gadget and reconnects, so seeding's grants arrive through a new `hub`).
 * Returns the card to render, or nothing.
 */
export function useTryTakeoverCard({ hub, overseer, workpieceId, bots, userName, onOpen, onError }: {
  hub: HubApi | null
  overseer: HubGadget | null
  workpieceId: number
  bots: Bot[]
  userName: string
  onOpen: (botId: string) => void
  onError: (title: string, description: string) => void
}): ReactNode {
  // Binding names while the offer stands; null once it is taken, dismissed, or not due.
  const [bindings, setBindings] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!hub || !overseer) return
    let cancelled = false
    void (async () => {
      // A hub older than the flags feature has no getMeta: no flag, no offer.
      let seen: string | null = 'unsupported'
      try { seen = await hub.getMeta('tryTakeover') } catch { /* pre-flags hub */ }
      if (seen || cancelled) return
      const client = overseer.getGadget(workpieceId)
      try {
        const list = await client.listBindings()
        if (!cancelled) setBindings(new Set(list.map((b) => b.name)))
      } catch { /* no bindings known, no card */ } finally { client[Symbol.dispose]() }
    })()
    return () => { cancelled = true }
  }, [hub, overseer, workpieceId])

  const bot = useMemo(
    () => (bindings ? pickTakeoverBot(bots, (id) => bindings.has(computerBindingNameFor(id, 'browser'))) : null),
    [bots, bindings],
  )
  const settle = useCallback(async (tried: boolean) => {
    setBindings(null)
    try { await hub?.setMeta('tryTakeover', `${tried ? 'tried' : 'dismissed'} ${new Date().toISOString()}`) } catch { /* pre-flags hub */ }
  }, [hub])
  const tryIt = useCallback(async (site: string) => {
    if (!hub || !bot) return
    try {
      // The offer is spent only once the Bot has the task: an undelivered send (no agent yet) keeps it.
      const sent = await hub.send(bot.id, tryTakeoverTask(site), { type: 'user', name: userName })
      if (!sent.delivered) throw new Error(`${bot.name} isn’t running yet; try again in a moment.`)
      void settle(true)
      onOpen(bot.id)
    } catch (err) {
      onError(`Couldn’t reach ${bot.name}`, String(err instanceof Error ? err.message : err))
    }
  }, [hub, bot, userName, settle, onOpen, onError])

  return bot ? <TryTakeoverCard bot={bot} onTry={(site) => { void tryIt(site) }} onDismiss={() => { void settle(false) }} /> : undefined
}

export function TryTakeoverCard({ bot, onTry, onDismiss }: { bot: Bot; onTry: (site: string) => void; onDismiss: () => void }) {
  const [site, setSite] = useState('')
  const host = normalizeSite(site)
  return (
    <form
      className="m-3 flex flex-col gap-2 rounded-lg border border-kumo-line bg-kumo-tint/40 px-3 py-2.5"
      role="note" aria-label="Try a takeover"
      onSubmit={(e) => { e.preventDefault(); if (host) onTry(host) }}
    >
      <div className="text-[14px] md:text-[13px] font-medium text-kumo-default">Try a takeover</div>
      {/* The card is an introduction to a specific teammate, so it shows the one it is about. */}
      <div className="flex items-start gap-2.5">
        <BotAvatar bot={bot} size={28} />
        <div className="text-[14px] md:text-[13px] leading-snug text-kumo-subtle">
          Name a site you sign in to. {bot.name} opens it and asks for the page; take control, sign in, hand it back — it keeps the session.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-[16px] md:text-[13px] text-kumo-default"
          value={site} onChange={(e) => setSite(e.target.value)} placeholder="github.com" aria-label="Site"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url"
        />
        <Button size="sm" type="submit" disabled={!host}>Try it</Button>
        <Button size="sm" variant="secondary" type="button" onClick={onDismiss}>Not now</Button>
      </div>
    </form>
  )
}

export default TryTakeoverCard
