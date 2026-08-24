import { useCallback, useEffect, useRef, useState } from 'react'
import { RpcStub, RpcTarget } from 'capnweb'
import type { GadgetClient, Overseer } from '@gadgets/workshop-shared/api'
import type { Bot, BotGroup, HubApi, HubInfo, HubUpdate } from './types'

/** RPC to the Bots Hub gadget's Durable Object (see packages/bots-hub in the deployment). */
export type HubStub = RpcStub<HubApi>

/** One hub update with a monotonic sequence number, so consumers can drain exactly the new ones. */
export type SeqUpdate = { seq: number; update: HubUpdate }

/** How many recent updates to keep buffered for consumers; enough to ride out any render burst. */
const UPDATE_BUFFER = 100

export type BotsHubState = {
  hub: HubStub | null
  bots: Bot[]
  groups: BotGroup[]
  info: HubInfo | null
  error: string | null
  /** Bumped on every hub update; consumers re-fetch details they show. */
  version: number
  /**
   * Recent hub updates in arrival order. A single "latest update" slot loses events: two updates
   * landing in one render batch overwrite each other before any consumer's effect runs. Consumers
   * track the last `seq` they handled and fold in everything newer.
   */
  updates: SeqUpdate[]
}

/**
 * Every update newer than the last one this consumer handled, mapped through `pick` (return null
 * to skip). The seq protocol -- monotonic, replay-tolerant -- lives here once; a consumer keeps
 * only a ref and a picker.
 */
export function drainNew<T>(updates: SeqUpdate[], seenSeqRef: { current: number }, pick: (u: HubUpdate) => T | null): T[] {
  const out: T[] = []
  for (const { seq, update } of updates) {
    if (seq <= seenSeqRef.current) continue
    seenSeqRef.current = seq
    const v = pick(update)
    if (v !== null) out.push(v)
  }
  return out
}

class HubSubscriber extends RpcTarget {
  constructor(private readonly onUpdate: (u: HubUpdate) => void) { super() }
  update(u: HubUpdate) { this.onUpdate(u) }
}

/**
 * Connects to the hub gadget of an open Bots workspace and keeps its roster live. The gadget stub
 * is the same capability the gadget's own iframe UI gets (`connectToGadget()`), so everything the
 * hub exposes to its UI is available here.
 */
export function useBotsHub(overseer: RpcStub<Overseer> | null, workpieceId: number | null): BotsHubState & {
  refreshBots: () => Promise<void>
  /** Drop the current stub and connect again — for a caller that just restarted the gadget. */
  reconnect: () => void
} {
  const [state, setState] = useState<BotsHubState>({
    hub: null, bots: [], groups: [], info: null, error: null, version: 0, updates: [],
  })
  const hubRef = useRef<HubStub | null>(null)
  // Monotonic across reconnects, so consumers' "last seq handled" refs stay valid.
  const seqRef = useRef(0)
  // Bumped when the hub stub breaks (the gadget restarts whenever something is bound to it, e.g.
  // a Bot's new spawner or computer), so the effect below reconnects instead of leaving the page
  // on a dead stub.
  const [attempt, setAttempt] = useState(0)

  const refreshBots = useCallback(async () => {
    const hub = hubRef.current
    if (!hub) return
    const [bots, info, groups] = await Promise.all([hub.listBots(), hub.getInfo(), hub.listGroups().catch(() => [] as BotGroup[])])
    setState((s) => ({ ...s, bots, info, groups, version: s.version + 1 }))
  }, [])

  useEffect(() => {
    if (!overseer || workpieceId === null) return
    let cancelled = false
    let hub: HubStub | null = null
    let gadgetClient: RpcStub<GadgetClient> | null = null
    let subscriber: HubSubscriber | null = null
    ;(async () => {
      try {
        gadgetClient = overseer.getGadget(workpieceId)
        // connectToGadget() is untyped on the wire (any gadget); the hub's surface is HubApi.
        const connected = (await gadgetClient.connectToGadget()) as unknown as HubStub
        if (cancelled) { connected[Symbol.dispose](); return }
        hub = connected
        hubRef.current = connected
        connected.onRpcBroken?.(() => { if (!cancelled) setAttempt((a) => a + 1) })
        subscriber = new HubSubscriber((u) => {
          if (cancelled) return
          if (u.type === 'bots' || u.type === 'groups') {
            refreshBots().catch(() => {})
          }
          const item = { seq: ++seqRef.current, update: u }
          setState((s) => ({ ...s, version: s.version + 1, updates: [...s.updates, item].slice(-UPDATE_BUFFER) }))
        })
        const snapshot = await connected.subscribe(subscriber)
        if (cancelled) return
        setState((s) => ({ ...s, hub: connected, bots: snapshot.bots, groups: snapshot.groups ?? [], info: snapshot.info, error: null, version: s.version + 1 }))
      } catch (err) {
        if (cancelled) return
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
      }
    })()
    return () => {
      cancelled = true
      hubRef.current = null
      try { hub?.[Symbol.dispose]() } catch { /* ignore */ }
      try { gadgetClient?.[Symbol.dispose]() } catch { /* ignore */ }
      setState({ hub: null, bots: [], groups: [], info: null, error: null, version: 0, updates: [] })
    }
  }, [overseer, workpieceId, refreshBots, attempt])

  // Rebuild the connection from scratch. `onRpcBroken` covers a stub that *reports* it died, but a
  // call on a stub whose gadget restarted underneath it can simply never settle -- so a caller that
  // knows it just restarted the gadget (taking a new hub revision) asks for a reconnect rather than
  // awaiting a reply that is not coming.
  const reconnect = useCallback(() => setAttempt((a) => a + 1), [])

  return { ...state, refreshBots, reconnect }
}
