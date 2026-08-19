import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatRelativeTime } from '../Activity'
import type { Bot, BotEvent, HubApi, HubUpdate } from './types'

/**
 * What every Bot has been doing, newest first, in sentences a person would say out loud.
 *
 * This is the landing view: the point is to learn what happened today without opening a single
 * conversation. So it shows outcomes, not machinery -- no tool calls, no "turns", no gadget names.
 * Housekeeping (a Bot being created, an agent re-attached, a message delivered) is deliberately
 * dropped: it is true, and nobody needs it.
 */

export type FeedLine = {
  id: number
  botId: string | null
  ts: number
  /** What to say. Written for someone glancing at a phone. */
  line: string
  /** needs: waiting on the reader. failed: went wrong. done: finished. quiet: context. */
  tone: 'needs' | 'failed' | 'done' | 'quiet'
}

const FEED_LIMIT = 120

const trim = (text: string, max = 240) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * One hub event as a sentence, or null when it is bookkeeping rather than news. Pure, so the
 * wording can be tested without a browser.
 */
export function summarise(event: BotEvent, botName: string | null): FeedLine | null {
  const who = botName ?? 'A Bot'
  const text = trim(event.text)
  const say = (tone: FeedLine['tone'], line: string): FeedLine => ({ id: event.id, botId: event.botId, ts: event.ts, tone, line })
  const data = (event.data ?? {}) as { state?: string; from?: { type?: string; name?: string } }
  switch (event.type) {
    case 'needsUser':
      return say('needs', text ? `${who} needs you: ${text}` : `${who} needs you.`)
    case 'completed':
      return say('done', text ? `${who}: ${text}` : `${who} finished.`)
    case 'failed':
      return say('failed', `${who} couldn’t finish: ${text || 'no reason given'}`)
    case 'capped':
      return say('failed', `${who} stopped for today — it reached the spending limit you set.`)
    case 'decision': {
      // Read the decision from the structured field the hub stored, not by parsing its own text;
      // older events predate the field, so fall back to the prefix.
      const approved = data.state ? data.state === 'approved' : /^approved/i.test(text)
      const what = text.replace(/^(approved|rejected):\s*/i, '')
      return say('quiet', `You said ${approved ? 'yes' : 'no'} to ${what || 'a request'} (${who}).`)
    }
    case 'message': {
      // Not every message is from a person. When an approval lands the hub sends the Bot a nudge
      // telling it to resume, and rendering that as "You asked ..." quotes our own plumbing back at
      // the reader as if they had typed it -- with an actionId in the middle of it. The decision
      // line already says what the reader did, so the nudge is dropped.
      const from = data.from ?? {}
      if (from.type === 'system') return null
      if (from.type === 'bot') return say('quiet', `${from.name || 'Another Bot'} asked ${who}: ${text}`)
      if (from.type === 'email') return say('quiet', `Email to ${who}${from.name ? ` from ${from.name}` : ''}: ${text}`)
      return say('quiet', `You asked ${who}: ${text}`)
    }
    case 'group':
      return say('quiet', text)
    default:
      // created / updated / deleted / agent / skill / delivered: true, but not news.
      return null
  }
}

const TONE: Record<FeedLine['tone'], string> = {
  needs: 'border-l-2 border-kumo-brand bg-kumo-brand/5',
  failed: 'border-l-2 border-kumo-danger/60',
  done: 'border-l-2 border-transparent',
  quiet: 'border-l-2 border-transparent text-kumo-subtle',
}

/**
 * The feed's data: one read on connect, then each live event merged in place. The hub broadcasts
 * the whole event row, so keeping up costs no RPC at all -- it used to re-read the newest 120 rows
 * on every update, from two mounted copies.
 */
export function useFeed(hub: HubApi | null, lastUpdate: HubUpdate | null) {
  const [events, setEvents] = useState<BotEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hub) return
    try {
      setEvents(await hub.activity(null, { limit: FEED_LIMIT }))
      setError(null)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }, [hub])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (lastUpdate?.type !== 'event') return
    const incoming = lastUpdate.event
    setEvents((prev) => {
      if (!prev) return prev
      if (prev.some((e) => e.id === incoming.id)) return prev
      return [...prev, incoming].slice(-FEED_LIMIT)
    })
  }, [lastUpdate])

  return { events, error }
}

export function Feed({ bots, events, error, onOpenBot }: {
  bots: Bot[]
  events: BotEvent[] | null
  error: string | null
  onOpenBot: (botId: string) => void
}) {
  const names = useMemo(() => new Map(bots.map((b) => [b.id, b.name])), [bots])

  const lines = useMemo(() => {
    const all = (events ?? [])
      .map((e) => summarise(e, e.botId ? names.get(e.botId) ?? null : null))
      .filter((l): l is FeedLine => l !== null)
    // Anything waiting on the reader goes first, however old: that is the whole job of this screen.
    return all.sort((a, b) => Number(b.tone === 'needs') - Number(a.tone === 'needs') || b.ts - a.ts)
  }, [events, names])

  if (error) return <div className="p-4 text-[13px] md:text-[12px] text-kumo-danger">Couldn’t load what your Bots have been doing: {error}</div>
  if (events === null) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading activity">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <span className="h-3 w-3/4 animate-pulse rounded bg-kumo-tint" />
            <span className="h-2.5 w-24 animate-pulse rounded bg-kumo-tint" />
          </div>
        ))}
      </div>
    )
  }
  if (!lines.length) {
    return (
      <div className="p-6 text-center text-[14px] md:text-[13px] text-kumo-subtle">
        Nothing yet. When your Bots do something, it shows up here.
      </div>
    )
  }

  return (
    <ul className="flex min-h-0 flex-col overflow-y-auto" aria-label="What your Bots have been doing">
      {lines.map((l) => (
        <li key={l.id}>
          <button
            type="button"
            onClick={() => l.botId && onOpenBot(l.botId)}
            disabled={!l.botId}
            className={`flex w-full flex-col items-start gap-1 border-b border-kumo-line px-4 py-3 text-left hover:bg-kumo-tint disabled:hover:bg-transparent ${TONE[l.tone]}`}
          >
            <span className="text-[15px] md:text-[14px] leading-snug text-kumo-default">{l.line}</span>
            <span className="text-[13px] md:text-[12px] text-kumo-subtle">
              {l.tone === 'needs' ? 'Waiting for you · ' : ''}{formatRelativeTime(new Date(l.ts))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default Feed
