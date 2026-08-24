import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatRelativeTime } from '../Activity'
import BotAvatar from './BotAvatar'
import { drainNew, type SeqUpdate } from './useBotsHub'
import type { Bot, BotEvent, HubApi } from './types'

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
  const data = (event.data ?? {}) as { state?: string; quiet?: boolean; from?: { type?: string; name?: string; groupId?: string }; extra?: { group?: { name?: string } } }
  switch (event.type) {
    case 'needsUser':
      return say('needs', text ? `${who} needs you: ${text}` : `${who} needs you.`)
    case 'completed':
      // Work nobody was waiting on that came to nothing -- a routine that saw no change, a group
      // post a member had nothing to add to. The Bot said so itself and the hub stamped it; the
      // audit log keeps it, the reader is spared it. This is the whole point of the feed: a monitor
      // that runs hourly and finds nothing should cost the reader no attention at all.
      //
      // Only the Bot's own word counts. Nothing here infers silence from the shape of the summary.
      if (data.quiet) return null
      return say('done', text ? `${who}: ${text}` : `${who} finished.`)
    case 'failed':
      return say('failed', `${who} couldn’t finish: ${text || 'no reason given'}`)
    case 'capped':
      return say('failed', `${who} stopped for today — it reached the spending limit you set.`)
    case 'away':
      // The hub held autonomous work because nobody had been by. Reading this line is itself the
      // thing that releases it, so it is written as news rather than as a demand, and it pins to
      // the top like anything else waiting on the reader.
      //
      // Hub-level, so botId is dropped: the stored event names whichever Bot's delivery tripped
      // the brake, which is right for the audit log and wrong for the reader -- it would put an
      // arbitrary Bot's face on the line and open that Bot on tap. Dropping it also keeps the line
      // out of the movedOn demotion below, so the one notice explaining why everything stopped
      // cannot be pushed down by that Bot finishing something unrelated.
      return { ...say('needs', text), botId: null }
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
      // A routine coming due is the schedule firing, not the reader asking -- and it used to fall
      // through to "You asked ...", which put the hub's own "Routine X is due" prose in their mouth.
      // What the routine did is the news, and that arrives as the completion (or not at all, if the
      // Bot resolved it quiet).
      if (from.type === 'routine') return null
      // A group fan-out delivers the hub's own envelope -- group name, purpose, transcript, and
      // instructions on how to reply -- to every member. That is plumbing; the post itself is the
      // news, and it appears once as a group event.
      if (from.groupId || data.extra?.group) return null
      // A Bot handing work to another Bot is the delegation actually happening -- the thing the
      // team exists for -- not background context. Named like a hand-off, weighted like news.
      if (from.type === 'bot') return say('done', `${from.name || 'A Bot'} → ${who}: ${text}`)
      if (from.type === 'email') return say('quiet', `Email to ${who}${from.name ? ` from ${from.name}` : ''}: ${text}`)
      return say('quiet', `You asked ${who}: ${text}`)
    }
    case 'groupPost': {
      // A post to a group, by a person or a Bot: the one line the fan-out machinery exists to carry.
      const d = data as { fromType?: string; fromName?: string; groupName?: string; text?: string }
      const poster = d.fromType === 'user' ? 'You' : (d.fromName || who)
      // The hub carries the raw post in the data (rev 10+); the prefix-strip serves older hubs.
      const body = d.text ?? text.replace(/^[^:]{1,60}: /, '')
      return say(d.fromType === 'user' ? 'quiet' : 'done', `${poster} in ${d.groupName || 'the group'}: ${body}`)
    }
    case 'group':
      // Group bookkeeping (created, updated, deleted) is housekeeping like a Bot being created; a
      // post that was held back is the one thing here worth a glance. The hub marks it in the data
      // (rev 10+); the prose match serves older hubs, whose wording this must not depend on.
      return ((data as { held?: string }).held || /not delivered/i.test(text)) ? say('failed', text) : null
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
export function useFeed(hub: HubApi | null, updates: SeqUpdate[], limit = FEED_LIMIT, botId: string | null = null) {
  const [events, setEvents] = useState<BotEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pendingRef = useRef<BotEvent[]>([])
  const seenSeqRef = useRef(0)
  const load = useCallback(async () => {
    // No hub means the view is closed (or not yet connected): drop what it held rather than keep
    // a window nobody is reading up to date.
    if (!hub) { setEvents(null); pendingRef.current = []; return }
    try {
      const snapshot = await hub.activity(botId, { limit })
      // Fold in anything that arrived while the snapshot was in flight, dropping what it already has.
      const held = pendingRef.current.splice(0)
      const seen = new Set(snapshot.map((e) => e.id))
      setEvents([...snapshot, ...held.filter((e) => !seen.has(e.id))].slice(-limit))
      setError(null)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }, [hub, limit, botId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!hub) return
    const incoming = drainNew(updates, seenSeqRef, (u) => (u.type === 'event' ? u.event : null))
    if (!incoming.length) return
    setEvents((prev) => {
      // Before the first snapshot lands, events are held rather than dropped: the snapshot may
      // have been computed before these were stored, and a dropped event never comes back.
      if (!prev) { pendingRef.current.push(...incoming); return prev }
      const seen = new Set(prev.map((e) => e.id))
      const fresh = incoming.filter((e) => !seen.has(e.id))
      if (!fresh.length) return prev
      return [...prev, ...fresh].slice(-limit)
    })
  }, [hub, updates, limit])

  return { events, error }
}

export function Feed({ bots, events, error, onOpenBot, header, extraLines }: {
  bots: Bot[]
  events: BotEvent[] | null
  error: string | null
  onOpenBot: (botId: string) => void
  /** Shown above the lines, inside the same scroll: a first-run card, for instance. */
  header?: ReactNode
  /**
   * Lines from outside the hub's event log, merged and sorted with the rest. A Bot blocked on a
   * gatekeeper approval is the case this exists for: it is the strongest "waiting for you" there
   * is, and it produces no hub event at all, so this screen would otherwise be blind to it.
   */
  extraLines?: FeedLine[]
}) {
  const byBot = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots])

  const lines = useMemo(() => {
    // The last time each Bot moved on -- the reader answered or decided, or the Bot finished or
    // failed. An ask older than that is no longer waiting on anyone, and pinning it forever would
    // fill the top of the feed with stale demands.
    const movedOn = new Map<string, number>()
    for (const e of events ?? []) {
      if (!e.botId) continue
      const from = ((e.data ?? {}) as { from?: { type?: string } }).from
      const resolves = e.type === 'completed' || e.type === 'failed' || e.type === 'capped'
        || e.type === 'decision' || (e.type === 'message' && (!from?.type || from.type === 'user'))
      if (resolves) movedOn.set(e.botId, Math.max(movedOn.get(e.botId) ?? 0, e.ts))
    }
    const all = (events ?? [])
      // A Bot that no longer exists cannot need anything, and its line would otherwise sit pinned
      // at the top as "A Bot needs you" with a tap that opens nothing -- the audit log keeps the
      // event, but the feed is for what is live.
      .filter((e) => !e.botId || byBot.has(e.botId) || e.type !== 'needsUser')
      .map((e) => summarise(e, e.botId ? byBot.get(e.botId)?.name ?? null : null))
      .filter((l): l is FeedLine => l !== null)
      // An answered ask stays in the story, but as context, not as a demand.
      .map((l) => (l.tone === 'needs' && l.botId && (movedOn.get(l.botId) ?? 0) > l.ts
        ? { ...l, tone: 'quiet' as const } : l))
    // Anything waiting on the reader goes first, however old: that is the whole job of this screen.
    return [...all, ...(extraLines ?? [])]
      .sort((a, b) => Number(b.tone === 'needs') - Number(a.tone === 'needs') || b.ts - a.ts)
  }, [events, byBot, extraLines])

  // The header is part of the screen whatever the lines are doing: a first-run card must not
  // vanish because the snapshot is slow or failed.
  const notice = error ? (
    <div className="p-4 text-[13px] md:text-[12px] text-kumo-danger">Couldn’t load what your Bots have been doing: {error}</div>
  ) : events === null ? (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading activity">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <span className="h-3 w-3/4 animate-pulse rounded bg-kumo-tint" />
          <span className="h-2.5 w-24 animate-pulse rounded bg-kumo-tint" />
        </div>
      ))}
    </div>
  ) : !lines.length ? (
    <div className="p-6 text-center text-[14px] md:text-[13px] text-kumo-subtle">Nothing yet.</div>
  ) : null

  return (
    <ul className="flex min-h-0 flex-col overflow-y-auto" aria-label="What your Bots have been doing">
      {header && <li>{header}</li>}
      {notice && <li>{notice}</li>}
      {!notice && lines.map((l) => {
        const bot = l.botId ? byBot.get(l.botId) : undefined
        return (
        <li key={l.id}>
          <button
            type="button"
            onClick={() => l.botId && onOpenBot(l.botId)}
            disabled={!l.botId}
            className={`flex w-full items-start gap-3 border-b border-kumo-line px-4 py-3 text-left hover:bg-kumo-tint disabled:hover:bg-transparent ${TONE[l.tone]}`}
          >
            {/* Whose line this is, before you read a word of it. Lines with no Bot behind them keep
                the same indent so the column of text stays straight. */}
            {bot ? <BotAvatar bot={bot} size={28} /> : <span className="h-7 w-7 flex-none" aria-hidden />}
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="text-[15px] md:text-[14px] leading-snug text-kumo-default">{l.line}</span>
              <span className="text-[13px] md:text-[12px] text-kumo-subtle">
                {l.tone === 'needs' ? 'Waiting for you · ' : ''}{formatRelativeTime(new Date(l.ts))}
              </span>
            </span>
          </button>
        </li>
        )
      })}
    </ul>
  )
}

export default Feed
