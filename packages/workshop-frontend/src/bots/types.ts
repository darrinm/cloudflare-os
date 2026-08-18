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
  /** Daily spending cap in dollars; null = no cap. */
  dailyCapUsd?: number | null
}

export type BotCosts = {
  botId: string
  totalUsd: number
  totalTokens: number
  turns: number
  chats: number
  todayUsd: number
  dailyCapUsd: number | null
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
  /** Blueprint revision this hub's code came from; absent on hubs older than the revision report. */
  revision?: number
  hasSpawner: boolean
  botCount: number
  groupCount?: number
  skillCount?: number
  hubBindingName: string
}

export type BotGroup = {
  id: string
  name: string
  purpose: string
  created: number
  updated: number
  members: Array<{ id: string; name: string }>
  postCount: number
  lastPost: number | null
}

export type GroupPost = {
  id: number
  groupId: string
  ts: number
  from: { type: string; name: string; botId: string | null }
  hops: number
  text: string
  deliveredTo: string[]
  held?: string | null
}

export type HubSkill = {
  name: string
  description: string
  body?: string
  created: number
  updated: number
}

/** Live-update messages the hub sends to `subscribe()` callbacks. */
export type HubUpdate =
  | { type: 'bots' }
  | { type: 'event'; event: BotEvent }
  | { type: 'routines'; botId: string }
  | { type: 'groups' }
  | { type: 'groupPost'; groupId: string; post: GroupPost }
  | { type: 'skills' }
  | { type: 'costs'; botId: string }

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
  updateBot(id: string, patch: Partial<Pick<Bot, 'name' | 'role' | 'instructions' | 'avatar' | 'color' | 'dailyCapUsd'>>): Promise<Bot>
  costs(botId: string): Promise<BotCosts>
  allCosts(): Promise<BotCosts[]>
  deleteBot(id: string): Promise<boolean>
  respawnAgent(id: string, spawnerBinding: string): Promise<{ chatTitle: string; spawnerBinding: string; generation: number }>
  send(botId: string, message: string | { skill?: string; skillId?: string; args?: string }, from: { type: string; name?: string; botId?: string }): Promise<{ eventId: number; delivered: boolean }>
  defineSkill(input: { name: string; description?: string; body: string }): Promise<HubSkill>
  listSkills(): Promise<HubSkill[]>
  getSkill(name: string): Promise<HubSkill | null>
  removeSkill(name: string): Promise<boolean>
  createGroup(input: { name: string; purpose?: string; members?: string[] }): Promise<BotGroup>
  updateGroup(id: string, patch: { name?: string; purpose?: string; members?: string[] }): Promise<BotGroup>
  deleteGroup(id: string): Promise<boolean>
  listGroups(): Promise<BotGroup[]>
  getGroup(id: string): Promise<BotGroup | null>
  groupTranscript(groupId: string, options?: { limit?: number; sinceId?: number }): Promise<GroupPost[]>
  groupPost(groupId: string, text: string, from: { type: string; name?: string; botId?: string; hops?: number }): Promise<{ postId: number; deliveredTo: string[]; held: string | null }>
  listMemories(botId: string, options?: { limit?: number }): Promise<BotMemory[]>
  forget(memoryId: string): Promise<boolean>
  newRoutine(botId: string, input: { title: string; instructions: string; schedule?: string }): Promise<{ id: string }>
  listRoutines(botId?: string): Promise<BotRoutine[]>
  runRoutine(routineId: string): Promise<{ eventId?: number; delivered?: boolean; runId: string; skipped?: boolean }>
  removeRoutine(routineId: string): Promise<boolean>
  activity(botId: string | null, options?: { sinceId?: number; limit?: number }): Promise<BotEvent[]>
  subscribe(callback: HubSubscriberApi): Promise<{ bots: Bot[]; info: HubInfo; groups?: BotGroup[] }>
}

/** The output id the Bots blueprint declares; how the hub workspace is found among outputs. */
export const BOTS_OUTPUT_ID = 'bots'
/** The bundled blueprint that creates a hub workspace. */
export const BOTS_BLUEPRINT_ID = 'iris.bots'
