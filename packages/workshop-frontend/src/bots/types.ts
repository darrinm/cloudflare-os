// Records exposed by the Bots Hub gadget's RPC (the "Bots" blueprint, output id "bots"). The hub is
// plain gadget code, so its API is untyped RPC; these mirror its return shapes.

export type Bot = {
  id: string
  name: string
  role: string
  instructions: string
  avatar: string
  color: string
  chatTitle: string
  created: number
  updated: number
  lastActivity: number | null
  agentReady: boolean
  spawnerBinding: string
  agentGeneration: number
}

export type BotMemory = {
  id: string
  botId: string
  kind: 'fact' | 'preference' | 'task' | 'contact' | 'note'
  text: string
  created: number
  source: string
}

export type BotRoutine = {
  id: string
  botId: string
  scheduleId: string | null
  title: string
  instructions: string
  schedule: string
  created: number
  lastRun: number | null
  lastRunId: string | null
  runCount: number
}

export type BotEvent = {
  id: number
  botId: string | null
  ts: number
  type: string
  text: string
  data: Record<string, unknown>
}

export type HubInfo = {
  version: number
  hasSpawner: boolean
  botCount: number
  hubBindingName: string
}

/** Live-update messages the hub sends to `subscribe()` callbacks. */
export type HubUpdate =
  | { type: 'bots' }
  | { type: 'event'; event: BotEvent }
  | { type: 'routines'; botId: string }

export type HubSubscriberApi = { update(u: HubUpdate): void }

/**
 * The hub gadget's RPC surface as the UI uses it (see packages/bots-hub/src/README.md in the
 * deployment for the full agent-facing API). Untyped on the wire; typed here for the frontend.
 */
export interface HubApi {
  getInfo(): Promise<HubInfo>
  listBots(): Promise<Bot[]>
  getBot(id: string): Promise<Bot | null>
  createBot(input: { name: string; role?: string; instructions?: string; avatar?: string; color?: string }): Promise<Bot>
  updateBot(id: string, patch: Partial<Pick<Bot, 'name' | 'role' | 'instructions' | 'avatar' | 'color'>>): Promise<Bot>
  deleteBot(id: string): Promise<boolean>
  respawnAgent(id: string, spawnerBinding: string): Promise<{ chatTitle: string; spawnerBinding: string; generation: number }>
  send(botId: string, text: string, from: { type: string; name?: string; botId?: string }): Promise<{ eventId: number; delivered: boolean }>
  listMemories(botId: string, options?: { limit?: number }): Promise<BotMemory[]>
  forget(memoryId: string): Promise<boolean>
  listRoutines(botId?: string): Promise<BotRoutine[]>
  runRoutine(routineId: string): Promise<{ eventId?: number; delivered?: boolean; runId: string; skipped?: boolean }>
  removeRoutine(routineId: string): Promise<boolean>
  activity(botId: string | null, options?: { sinceId?: number; limit?: number }): Promise<BotEvent[]>
  subscribe(callback: HubSubscriberApi): Promise<{ bots: Bot[]; info: HubInfo }>
}

/** The output id the Bots blueprint declares; how the hub workspace is found among outputs. */
export const BOTS_OUTPUT_ID = 'bots'
/** The bundled blueprint that creates a hub workspace. */
export const BOTS_BLUEPRINT_ID = 'iris.bots'
