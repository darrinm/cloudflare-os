import { describe, expect, it, vi } from 'vitest'
import { EXAMPLE_BOTS, seedExampleBots, senderResourceUrl } from './examples'

// Fakes just rich enough for the seeding flow: a hub with in-memory tables, an overseer whose gadget
// client records bindings, an accounts subscription that already knows the three ambient vendors.
function fakes() {
  const bindings: Array<{ name: string; target: number }> = []
  let nextId = 100
  const bots: Array<{ id: string; name: string; role: string; instructions: string; chatTitle: string; agentReady: boolean; spawnerBinding: string; agentGeneration: number; avatar: string; color: string; created: number; updated: number; lastActivity: null }> = []
  const skills: string[] = []
  const groups: Array<{ name: string; members: string[] }> = []
  const routines: Array<{ botId: string; title: string }> = []
  const respawns: Array<{ id: string; binding: string }> = []
  const hub = {
    listBots: async () => bots,
    createBot: async (input: { name: string; role?: string; instructions?: string }) => {
      const bot = { id: `id-${bots.length + 1}`, name: input.name, role: input.role ?? '', instructions: input.instructions ?? '', chatTitle: `Bot: ${input.name}`, agentReady: true, spawnerBinding: 'AGENT_SPAWNER', agentGeneration: 1, avatar: '', color: '', created: 1, updated: 1, lastActivity: null }
      bots.push(bot); return bot
    },
    respawnAgent: async (id: string, binding: string) => { respawns.push({ id, binding }); return { chatTitle: 't', spawnerBinding: binding, generation: 2 } },
    defineSkill: async (s: { name: string }) => { if (!skills.includes(s.name)) skills.push(s.name); return s },
    listGroups: async () => groups,
    createGroup: async (g: { name: string; members: string[] }) => { groups.push(g); return g },
    listRoutines: async (botId: string) => routines.filter((r) => r.botId === botId),
    newRoutine: async (botId: string, r: { title: string }) => { routines.push({ botId, title: r.title }); return { id: 'r1' } },
  }
  const client = {
    listBindings: async () => bindings.map((b) => ({ ...b, resourceTitle: b.name })),
    bind: async (name: string, target: number) => { bindings.push({ name, target }) },
    connectToGadget: async () => hub,
    [Symbol.dispose]() {},
  }
  const gatekeepers: string[] = []
  const spawners: Array<{ displayName: string; env: Record<string, number> }> = []
  const overseer = {
    getGadget: () => client,
    newGatekeeper: async (_account: number, url: string) => { gatekeepers.push(url); const id = ++nextId; return { getId: async () => id, [Symbol.dispose]() {} } },
    newAgentSpawnerGatekeeper: async (config: { displayName: string; env: Record<string, number> }) => { spawners.push(config); const id = ++nextId; return { getId: async () => id, [Symbol.dispose]() {} } },
  }
  const api = {
    subscribeConnectedAccounts: async (sub: { add: (...a: unknown[]) => void; ready: () => void }) => {
      let id = 1
      for (const vendorId of ['browser', 'sandbox', 'email_send']) sub.add(id++, { displayName: vendorId }, {}, [], true, vendorId)
      sub.ready()
      return { [Symbol.dispose]() {} }
    },
    provisionAmbientAccount: vi.fn<() => Promise<void>>(async () => {}),
  }
  return { hub, overseer, api, bindings, gatekeepers, spawners, respawns, skills, groups, routines, bots }
}

describe('example Bots', () => {
  it('seeds four Bots with per-Bot spawners, computer/email grants, skills, a group and a routine', async () => {
    const f = fakes()
    const progress: string[] = []
    const bots = await seedExampleBots({ api: f.api as never, overseer: f.overseer as never, hub: f.hub as never, hubWorkpieceId: 7, modelId: 'm1', onProgress: (l) => progress.push(l) })
    expect(bots.map((b) => b.name)).toEqual(['Scout', 'Fixer', 'Ledger', 'Concierge'])
    // Resources: Scout browser, Fixer sandbox (approve), Ledger sandbox (write) + sender.
    expect(f.gatekeepers.some((u) => u.startsWith('https://browser.iris2.local/profile/scout-') && u.includes('browse=any'))).toBe(true)
    expect(f.gatekeepers.filter((u) => u.startsWith('https://sandbox.iris2.local/box/')).map((u) => new URL(u).searchParams.get('mode'))).toEqual(['approve', 'write'])
    expect(f.gatekeepers.some((u) => u === senderResourceUrl({ local: 'ledger', mode: 'approve', displayName: 'Ledger (Iris2 Bot)' }))).toBe(true)
    // Each Bot got its own spawner with HUB plus its grants, bound and respawned.
    expect(f.spawners.map((s) => Object.keys(s.env).toSorted().join(','))).toEqual(['BROWSER,HUB', 'HUB,SANDBOX', 'EMAIL_SEND,HUB,SANDBOX', 'HUB'])
    expect(f.bindings.filter((b) => b.name.startsWith('SPAWNER_'))).toHaveLength(4)
    expect(f.respawns).toHaveLength(4)
    expect(f.skills).toEqual(['weekly-report', 'summarize-url'])
    expect(f.groups[0]).toMatchObject({ name: 'Team', members: bots.map((b) => b.id) })
    expect(f.routines).toEqual([{ botId: bots[0].id, title: 'Morning brief' }])
    expect(f.api.provisionAmbientAccount).not.toHaveBeenCalled()
    expect(progress.at(-1)).toBe('skills, group and routine ready')

    // Idempotent: a second run creates nothing new.
    await seedExampleBots({ api: f.api as never, overseer: f.overseer as never, hub: f.hub as never, hubWorkpieceId: 7, modelId: 'm1' })
    expect(f.bots).toHaveLength(4)
    expect(f.spawners).toHaveLength(4)
    expect(f.groups).toHaveLength(1)
    expect(f.routines).toHaveLength(1)
    expect(EXAMPLE_BOTS).toHaveLength(4)
  })
})
