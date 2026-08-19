import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Bot, HubApi, HubUpdate } from './types'

/**
 * What every Bot has been doing, newest first, in sentences a person would say out loud.
 *
 * This is the landing view: the point is to learn what happened today without opening a single
 * conversation. So it shows outcomes, not machinery -- no tool calls, no "turns", no gadget names.
 * Housekeeping (a Bot being created, an agent re-attached, a message delivered) is deliberately
 * dropped: it is true, and nobody needs it.
 */

export type FeedEvent = {
  id: number
  botId: string | null
  ts: number
  type: string
  text: string
  data?: Record<string, unknown>
}

export type FeedLine = {
  id: number
  botId: string | null
  ts: number
  /** What to say. Written for someone glancing at a phone. */
  line: string
  /** needs: waiting on the reader. failed: went wrong. done: finished. quiet: context. */
  tone: 'needs' | 'failed' | 'done' | 'quiet'
}

const trim = (text: string, max = 240) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * One hub event as a sentence, or null when it is bookkeeping rather than news. Pure, so the
 * wording can be tested without a browser.
 */
export function summarise(event: FeedEvent, botName: string | null): FeedLine | null {
  const who = botName ?? 'A Bot'
  const text = trim(event.text)
  switch (event.type) {
    case 'needsUser':
      return { id: event.id, botId: event.botId, ts: event.ts, tone: 'needs', line: text ? `${who} needs you: ${text}` : `${who} needs you.` }
    case 'completed':
      return { id: event.id, botId: event.botId, ts: event.ts, tone: 'done', line: text ? `${who}: ${text}` : `${who} finished.` }
    case 'failed':
      return { id: event.id, botId: event.botId, ts: event.ts, tone: 'failed', line: `${who} couldn’t finish: ${text || 'no reason given'}` }
    case 'capped':
      return { id: event.id, botId: event.botId, ts: event.ts, tone: 'failed', line: `${who} stopped for today — it reached the spending limit you set.` }
    case 'decision': {
      // "Approved: Run: npm test" / "Rejected: Delete /data" -- say it as the reader's own action.
      const approved = /^approved/i.test(text)
      const what = text.replace(/^(approved|rejected):\s*/i, '')
      return {
        id: event.id, botId: event.botId, ts: event.ts, tone: 'quiet',
        line: `${approved ? 'You said yes to' : 'You said no to'} ${what || 'a request'}${approved ? '' : ''} (${who}).`,
      }
    }
    case 'message': {
      // Not every message is from a person. When an approval lands the hub sends the Bot a nudge
      // telling it to resume, and rendering that as "You asked ..." quotes our own plumbing back at
      // the reader as if they had typed it -- with an actionId in the middle of it. The decision
      // line already says what the reader did, so the nudge is dropped.
      const from = (event.data?.from ?? {}) as { type?: string; name?: string }
      if (from.type === 'system') return null
      if (from.type === 'bot') {
        return { id: event.id, botId: event.botId, ts: event.ts, tone: 'quiet', line: `${from.name || 'Another Bot'} asked ${who}: ${text}` }
      }
      if (from.type === 'email') {
        return { id: event.id, botId: event.botId, ts: event.ts, tone: 'quiet', line: `Email to ${who}${from.name ? ` from ${from.name}` : ''}: ${text}` }
      }
      return { id: event.id, botId: event.botId, ts: event.ts, tone: 'quiet', line: `You asked ${who}: ${text}` }
    }
    case 'group':
      return { id: event.id, botId: event.botId, ts: event.ts, tone: 'quiet', line: text }
    default:
      // created / updated / deleted / agent / skill / delivered: true, but not news.
      return null
  }
}

/** "just now", "12 min ago", "3 h ago", "Tue" -- a glance, not a timestamp. */
export function when(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const TONE: Record<FeedLine['tone'], string> = {
  needs: 'border-l-2 border-kumo-brand bg-kumo-brand/5',
  failed: 'border-l-2 border-kumo-danger/60',
  done: 'border-l-2 border-transparent',
  quiet: 'border-l-2 border-transparent text-kumo-subtle',
}

export function Feed({ hub, bots, version, lastUpdate, onOpenBot }: {
  hub: HubApi | null
  bots: Bot[]
  /** Bumped by the hub hook on every change, including new events. */
  version: number
  lastUpdate: HubUpdate | null
  onOpenBot: (botId: string) => void
}) {
  const [events, setEvents] = useState<FeedEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hub) return
    try {
      const rows = (await hub.activity(null, { limit: 120 })) as unknown as FeedEvent[]
      setEvents(rows)
      setError(null)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }, [hub])

  useEffect(() => { void load() }, [load])
  // Events arrive live over the hub subscription; re-read rather than trying to merge by hand.
  useEffect(() => {
    if (lastUpdate?.type === 'event') void load()
  }, [lastUpdate, version, load])

  const nameOf = useMemo(() => {
    const byId = new Map(bots.map((b) => [b.id, b.name]))
    return (id: string | null) => (id ? byId.get(id) ?? null : null)
  }, [bots])

  const lines = useMemo(() => {
    const all = (events ?? []).map((e) => summarise(e, nameOf(e.botId))).filter((l): l is FeedLine => l !== null)
    all.sort((a, b) => b.ts - a.ts)
    // Anything waiting on the reader goes first, however old: that is the whole job of this screen.
    const needs = all.filter((l) => l.tone === 'needs')
    const rest = all.filter((l) => l.tone !== 'needs')
    return [...needs, ...rest]
  }, [events, nameOf])

  if (!hub) return null
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
              {l.tone === 'needs' ? 'Waiting for you · ' : ''}{when(l.ts)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default Feed
