import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, Overseer, OutputSummary } from '@gadgets/workshop-shared/api'
import { restartingHub } from './hubRetry'
import type { HubStub } from './useBotsHub'

/**
 * Moves the Bots of a stray hub into the person's hub, then removes the stray. A person keeps one
 * hub; a second one appears when an agent elsewhere was asked to "create a Bot" and set up its own
 * (now refused at creation -- this is the one-time repair for hubs that already split).
 *
 * What moves: each Bot's persona (name, role, instructions, look, daily cap) and its memories; the
 * hub's skills and groups (members mapped to the moved Bots). What stays behind: the Bots' agent
 * chats, cost history and activity (history of the old hub), routines' schedules (a Scheduled
 * Tasks hook lives in its own workspace) and grants (per-Bot computers are workspace workpieces;
 * re-grant from Details). A moved Bot gets a fresh agent in the new hub.
 */
export async function bringBotsHere({ api, overseer, workpieceId, stray, strayIsSoleOutput, onProgress }: {
  api: Pick<RpcStub<AuthenticatedApi>, 'openGadget'>
  /** The person's hub workspace. */
  overseer: Pick<RpcStub<Overseer>, 'getGadget'>
  workpieceId: number
  stray: Pick<OutputSummary, 'workspaceId' | 'workpieceId'>
  /** True when the stray hub is the only output of its workspace, so the workspace can go with it. */
  strayIsSoleOutput: boolean
  onProgress?: (message: string) => void
}): Promise<{ moved: number }> {
  const retry = (m: string) => onProgress?.(`hub busy, retrying… (${m.slice(0, 50)})`)
  const strayOverseer = await api.openGadget(stray.workspaceId)
  try {
    const strayClient = strayOverseer.getGadget(stray.workpieceId)
    const from = (await strayClient.connectToGadget()) as unknown as HubStub
    const client = overseer.getGadget(workpieceId)
    // Every createBot binds a new agent to the hub, which restarts it; the destination stub is
    // taken fresh whenever that happens.
    const to = restartingHub(async () => (await client.connectToGadget()) as unknown as HubStub, retry)
    try {
      const bots = await from.listBots()
      const taken = new Set((await to.call((h) => h.listBots())).map((b) => b.name))
      const moved = new Map<string, string>()
      for (const bot of bots) {
        onProgress?.(`Moving ${bot.name}…`)
        const name = taken.has(bot.name) ? `${bot.name} (moved)` : bot.name
        const made = await to.call((h) => h.createBot({ name, role: bot.role, instructions: bot.instructions, avatar: bot.avatar, color: bot.color }))
        taken.add(name)
        moved.set(bot.id, made.id)
        if (bot.dailyCapUsd !== null && bot.dailyCapUsd !== undefined) {
          await to.call((h) => h.updateBot(made.id, { dailyCapUsd: bot.dailyCapUsd }))
        }
        for (const m of await from.listMemories(bot.id, { limit: 500 })) {
          await to.call((h) => h.remember(made.id, m.kind, m.text, m.source || 'moved from another hub'))
        }
      }
      const have = new Set((await to.call((h) => h.listSkills())).map((s) => s.name))
      for (const s of await from.listSkills()) {
        if (have.has(s.name)) continue
        const full = await from.getSkill(s.name)
        if (full?.body) await to.call((h) => h.defineSkill({ name: s.name, description: s.description, body: full.body! }))
      }
      for (const g of await from.listGroups()) {
        const members = g.members.map((m) => moved.get(m.id)).filter((id): id is string => !!id)
        await to.call((h) => h.createGroup({ name: g.name, purpose: g.purpose, members }))
      }
      await to.call((h) => h.setMeta(`mergedFrom:${stray.workspaceId}`, new Date().toISOString())).catch(() => {})
      onProgress?.('Removing the other hub…')
      // The stray goes: the whole workspace when the hub was all it held (a hub made from /bots),
      // else just the gadget (an agent made it inside a workspace that has other work in it).
      const meta = await strayOverseer.getMetadata()
      if (strayIsSoleOutput && meta.defaultGadgetId === stray.workpieceId) await strayOverseer.deleteSelf()
      else await strayClient.remove()
      return { moved: bots.length }
    } finally {
      to.dispose()
      try { from[Symbol.dispose]() } catch { /* gone with the gadget */ }
      try { strayClient[Symbol.dispose]() } catch { /* gone with the gadget */ }
    }
  } finally {
    try { strayOverseer[Symbol.dispose]() } catch { /* ignore */ }
  }
}
