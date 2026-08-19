import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { RpcStub } from 'capnweb'
import { Button, Dialog, Input, Loader, useKumoToastManager } from '@cloudflare/kumo'
import { CaretLeft, Info, Lightning, Plus, Robot, UsersThree, Wrench, X } from '@phosphor-icons/react'
import type {
  AiChatAuthorInfo,
  AiChatMetadata,
  GadgetBindingInfo,
  GadgetClient,
  GatekeeperClient,
  Overseer,
} from '@gadgets/workshop-shared/api'
import ChatInterface from '../ChatInterface'
import Feed, { useFeed } from './Feed'
import { useAuthenticatedApi } from '../AuthContext'
import { useWorkspaceOpen } from '../useWorkspaceOpen'
import { useDocumentTitle } from '../useDocumentTitle'
import WorkspaceOpenErrorPage from '../components/WorkspaceOpenErrorPage'
import { WorkshopIconButton } from '../components/WorkshopControls'
import { useActions } from '../useActions'
import { getStoredSelectedModel } from '../modelSelection'
import { useBotsHub, type HubStub } from './useBotsHub'
import { useBotsWorkspace } from './useBotsWorkspace'
import type { Bot, BotCosts, BotEvent, BotMemory, BotRoutine } from './types'
import { GroupDialog, GroupView } from './GroupView'
import { RunSkillDialog, SkillsDialog } from './SkillsDialog'
import { seedExampleBots } from './examples'
import { BOTS_BLUEPRINT_ID } from './types'
import {
  COMPUTER_VENDORS, HOUSEHOLD_PROFILE, browserResourceUrl, computerBindingNameFor, computerNameFor, isPerBotBinding,
  parseSites, provisionComputer, sandboxResourceUrl, type ComputerKind,
} from './computer'

const AVATAR_COLORS = ['#5b4bc4', '#1f7a5c', '#b23a48', '#9a6300', '#2f6fb0', '#7a3fa0', '#0f766e']

function botColor(bot: Bot): string {
  if (bot.color) return bot.color
  let h = 0
  for (const c of bot.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function botInitials(bot: Bot): string {
  if (bot.avatar) return bot.avatar
  return bot.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}
function fmtTime(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString() : ''
}
/** The hub gadget binding name for a Bot's own agent spawner. */
export function spawnerBindingNameFor(botId: string): string {
  return `SPAWNER_${botId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`
}

export function BotAvatar({ bot, size = 32 }: { bot: Bot; size?: number }) {
  return (
    <span
      className="inline-grid flex-none place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: botColor(bot), fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {botInitials(bot)}
    </span>
  )
}

// -------------------------------------------------------------------------------------------------

/** Page body for /bots and /bots/$id. Exported separately from the route so tests can render it. */
// What Scout does the moment a new hub is set up: something real that needs no approval.
const FIRST_TASK = "Introduce yourself in one line, then do this now: read https://news.ycombinator.com and tell me the single most interesting story right now -- title, link, and one line on why it matters."

export function BotsPageContent({ botId, groupId = null }: { botId: string | null; groupId?: string | null }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const { state, create } = useBotsWorkspace(authenticatedApi)
  useDocumentTitle('Bots')

  if (state.status === 'loading') {
    return <CenteredNote><Loader /></CenteredNote>
  }
  if (state.status === 'error') {
    return <CenteredNote>Couldn’t look up your Bots: {state.message}</CenteredNote>
  }
  if (state.status === 'missing') {
    return <CreateHubPanel authenticatedApi={authenticatedApi} onCreate={create} />
  }
  return <BotsWorkspace workspaceId={state.ref.workspaceId} workpieceId={state.ref.workpieceId} botId={botId} groupId={groupId} />
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-[14px] md:text-[13px] text-kumo-subtle">
      {children}
    </div>
  )
}

function CreateHubPanel({
  authenticatedApi, onCreate,
}: {
  authenticatedApi: RpcStub<import('@gadgets/workshop-shared/api').AuthenticatedApi>
  onCreate: (modelId: string | null) => Promise<unknown>
}) {
  const [models, setModels] = useState<AiChatAuthorInfo[] | null>(null)
  const [modelId, setModelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toasts = useKumoToastManager()
  useEffect(() => {
    let cancelled = false
    authenticatedApi.listModels().then((list) => {
      if (cancelled) return
      setModels(list)
      setModelId(getStoredSelectedModel(list))
    }).catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [authenticatedApi])
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-4 p-8 text-center">
      <Robot size={40} weight="duotone" className="text-kumo-brand" />
      <h1 className="text-[20px] font-medium tracking-[-0.4px] text-kumo-default">Bots</h1>
      <p className="text-[14px] md:text-[13px] leading-[18px] text-kumo-subtle">
        Bots are AI teammates that keep working between conversations — reading the web, running code,
        sending email — and ask you when they need you.
      </p>
      {models === null ? <Loader /> : (
        <label className="flex w-full flex-col gap-1 text-left text-[13px] md:text-[12px] text-kumo-subtle">
          Model your Bots think with
          <select
            className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-[14px] md:text-[13px] text-kumo-default"
            value={modelId ?? ''}
            onChange={(e) => setModelId(e.target.value || null)}
          >
            {models.length === 0 && <option value="">No models configured — add one under Providers</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}
      <Button
        variant="primary"
        disabled={busy || models === null || !modelId}
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try { await onCreate(modelId) }
          catch (err) { toasts.add({ title: 'Couldn’t set up your Bots', description: String(err instanceof Error ? err.message : err), variant: 'error' }) }
          finally { setBusy(false) }
        }}
      >
        Set up Bots
      </Button>
    </div>
  )
}

// -------------------------------------------------------------------------------------------------

function BotsWorkspace({ workspaceId, workpieceId, botId, groupId }: { workspaceId: string; workpieceId: number; botId: string | null; groupId: string | null }) {
  const { authenticatedApi, currentUser } = useAuthenticatedApi()
  const navigate = useNavigate()
  const toasts = useKumoToastManager()
  const { overseer, error, retry } = useWorkspaceOpen({
    id: workspaceId,
    authenticatedApi,
    onMetadata: () => {},
    onShareKeyConsumed: () => {},
    onInvalidShareKey: () => {},
  })
  const hubState = useBotsHub(overseer?.stub ?? null, workpieceId)
  const [showNew, setShowNew] = useState(false)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [seeding, setSeeding] = useState<string | null>(null)
  // What you see with nothing selected. The feed answers "what happened?", which is the daily
  // question; the roster answers "who have I got?", which you ask far less often.
  const [view, setView] = useState<'feed' | 'roster'>('feed')
  // One subscription to the feed's data, shared by the phone tab and the desktop pane: mounting
  // the component twice used to fetch twice, on every event.
  const feedData = useFeed(hubState.hub, hubState.lastUpdate)
  const feed = hubState.hub
    ? <Feed bots={hubState.bots} events={feedData.events} error={feedData.error} onOpenBot={(id) => navigate({ to: '/bots/$id', params: { id } })} />
    : null
  // "Show work": the conversation is a teammate view by default (what the Bot says, approvals,
  // errors); the code runs / callbacks / gadget calls are one tap away, remembered per browser.
  const [showWork, setShowWork] = useState<boolean>(() => { try { return localStorage.getItem('bots:showWork') === '1' } catch { return false } })
  const toggleShowWork = useCallback(() => setShowWork((v) => { try { localStorage.setItem('bots:showWork', v ? '0' : '1') } catch { /* ignore */ } return !v }), [])

  // A hub is a gadget created by copying the "Bots" blueprint, so a deployment that ships a newer
  // hub never reaches hubs that already exist. This takes the update in place: storage (Bots,
  // memory, routines, groups, costs), bindings and the workpiece id are kept.
  const updateHub = useCallback(async () => {
    if (!overseer) return
    setSeeding('Updating your Bots…')
    const client = overseer.stub.getGadget(workpieceId)
    let changed: string[] | null = null
    try {
      changed = (await client.updateFromBlueprint(BOTS_BLUEPRINT_ID)).updated
    } catch (err) {
      // Writing the code restarts the gadget, which kills this very call: that is the update
      // succeeding, not failing. Anything else is a real error.
      const msg = String(err instanceof Error ? err.message : err)
      if (!/restart|disposed|broken|reset|code update/i.test(msg)) {
        toasts.add({ title: 'Couldn’t update your Bots', description: msg, variant: 'error' })
        client[Symbol.dispose]()
        setSeeding(null)
        return
      }
    } finally {
      client[Symbol.dispose]()
    }
    // Read the revision back from the restarted hub, so the toast states what actually happened.
    setSeeding('Reconnecting…')
    let revision: number | undefined
    try {
      const fresh = overseer.stub.getGadget(workpieceId)
      try {
        await new Promise((r) => setTimeout(r, 1500))
        const hub = (await fresh.connectToGadget()) as unknown as HubStub
        try { revision = (await hub.getInfo()).revision } finally { hub[Symbol.dispose]() }
      } finally { fresh[Symbol.dispose]() }
    } catch { /* the toast just omits the revision */ }
    toasts.add({
      title: changed?.length === 0 ? 'Already up to date' : 'Hub updated',
      description: `${revision ? `Now running revision ${revision}. ` : ''}Your Bots, memory, routines and costs are untouched.`,
      variant: 'success',
    })
    await hubState.refreshBots()
    setSeeding(null)
  }, [overseer, workpieceId, hubState, toasts])

  // The seeding core: pick the model, create and grant the example Bots, refresh the roster. Both
  // the "Add example Bots" button and the first run go through here, so how examples are made is
  // decided once.
  // One seed at a time in this page: the button and the first run share this, and seedExampleBots
  // checks for existing Bots once at its start, so two runs overlapping in one tab would each see
  // an empty roster and make every Bot twice. (Two tabs remain possible; the hub's firstRun flag
  // and the button's loading state make that a deliberate double-press, not an accident.)
  const seedInFlight = useRef<Promise<Bot[]> | null>(null)
  const seedExamples = useCallback(async (afterSeed?: (hub: HubStub, bots: Bot[]) => Promise<void>): Promise<Bot[]> => {
    if (seedInFlight.current) return seedInFlight.current
    const hub = hubState.hub
    if (!hub || !overseer) return []
    const run = (async () => {
      const models = await overseer.stub.listModels()
      const modelId = getStoredSelectedModel(models)
      const bots = await seedExampleBots({ api: authenticatedApi, overseer: overseer.stub, hub, hubWorkpieceId: workpieceId, modelId, onProgress: setSeeding, afterSeed })
      await hubState.refreshBots()
      return bots
    })()
    seedInFlight.current = run
    try { return await run } finally { seedInFlight.current = null }
  }, [hubState, overseer, authenticatedApi, workpieceId])

  const addExamples = useCallback(async () => {
    if (!hubState.hub) return
    setSeeding('Starting…')
    try {
      const bots = await seedExamples()
      toasts.add({ title: `${bots.length} example Bots ready`, description: 'Scout reads the web, Fixer runs code, Ledger reports (and emails), Concierge coordinates.', variant: 'success' })
      if (bots[0]) navigate({ to: '/bots/$id', params: { id: bots[0].id } })
    } catch (err) {
      toasts.add({ title: 'Couldn’t add the examples', description: String(err instanceof Error ? err.message : err), variant: 'error' })
    } finally { setSeeding(null) }
  }, [hubState.hub, seedExamples, toasts, navigate])

  // First run. A new hub used to greet someone with an empty list and a button to press, so the
  // first minute was spent learning our nouns rather than seeing a Bot do anything. Now the Bots
  // exist, are granted, and one of them has already done a real piece of work before you look.
  //
  // Scout is the one that runs: it reads the web, which needs no approval, so its answer lands
  // without anyone deciding anything. The others hold their first task until asked -- their tools
  // (a sandbox, sending email) are deliberately approval-gated, and an approval prompt is a poor
  // way to say hello. One short turn, well inside any daily cap.
  const firstRunStarted = useRef(false)
  const hub = hubState.hub
  const hubIsEmpty = hubState.bots.length === 0
  // Only what the guard reads is a dependency. The effect still no-ops on re-runs via the ref, but
  // it no longer re-runs on every hub event or on its own progress messages.
  const latest = useRef({ seedExamples, navigate, toasts })
  latest.current = { seedExamples, navigate, toasts }
  useEffect(() => {
    if (!hub || !overseer || !hubIsEmpty || firstRunStarted.current) return
    firstRunStarted.current = true
    void (async () => {
      // A hub older than this feature has no flags; leave it to the button rather than risk
      // seeding a roster someone deliberately emptied.
      let welcomed: string | null = null
      try { welcomed = await hub.getMeta('firstRun') } catch { return }
      if (welcomed) return
      const { seedExamples: seed, navigate: go, toasts: t } = latest.current
      try {
        setSeeding('Setting up your Bots…')
        let scoutId: string | null = null
        // Everything after the Bots exist runs on a stub the seeder knows is live: every bind during
        // seeding restarts the gadget, so the `hub` captured above is broken by the time seeding
        // returns, and using it here failed the welcome every time -- the Bots were created, then a
        // "couldn't finish" toast and no task for Scout.
        await seed(async (live, bots) => {
          await live.setMeta('firstRun', new Date().toISOString())
          const scout = bots.find((b) => b.name === 'Scout') ?? bots[0]
          if (!scout) return
          setSeeding('Asking Scout for something to look at…')
          await live.send(scout.id, FIRST_TASK, { type: 'user', name: 'Welcome' })
          scoutId = scout.id
        })
        if (scoutId) go({ to: '/bots/$id', params: { id: scoutId } })
      } catch (err) {
        // A failed welcome must not wedge the page: the roster and the button still work.
        t.add({ title: 'Couldn\u2019t finish setting up', description: String(err instanceof Error ? err.message : err), variant: 'error' })
      } finally { setSeeding(null) }
    })()
  }, [hub, overseer, hubIsEmpty])

  const selected = useMemo(() => hubState.bots.find((b) => b.id === botId) ?? null, [hubState.bots, botId])
  const selectedGroup = useMemo(() => hubState.groups.find((g) => g.id === groupId) ?? null, [hubState.groups, groupId])
  const anySelected = selected !== null || selectedGroup !== null

  if (error) {
    return error.kind === 'open'
      ? <WorkspaceOpenErrorPage kind={error.failure} onGoToWorkspaces={() => navigate({ to: '/workspaces' })} onRetry={retry} />
      : <CenteredNote>{error.message}</CenteredNote>
  }
  if (!overseer) return <CenteredNote><Loader /></CenteredNote>

  const roster = (
    <aside className={`${anySelected ? 'hidden md:flex' : 'flex'} h-full w-full flex-col border-r border-kumo-line bg-kumo-base md:w-64 md:flex-none`}>
      <div className="flex h-12 flex-none items-center justify-between border-b border-kumo-line px-3">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="hidden md:block text-[14px] md:text-[13px] font-medium tracking-[-0.25px] text-kumo-default">Bots</h1>
          <div className="flex md:hidden items-center gap-1" role="tablist" aria-label="View">
            {(['feed', 'roster'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-2 py-1 text-[14px] ${view === v ? 'bg-kumo-brand/10 text-kumo-default' : 'text-kumo-subtle'}`}
              >
                {v === 'feed' ? 'Activity' : 'Bots'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <WorkshopIconButton onClick={() => setShowSkills(true)} title="Skills" aria-label="Skills" className="!h-8 !w-8" disabled={!hubState.hub}>
            <Lightning size={14} />
          </WorkshopIconButton>
          <WorkshopIconButton onClick={() => setShowNew(true)} title="New Bot" aria-label="New Bot" className="!h-8 !w-8">
            <Plus size={14} />
          </WorkshopIconButton>
        </div>
      </div>
      {hubState.info && !hubState.info.hasSpawner && (
        <div className="m-2 rounded-md bg-kumo-brand/10 px-2 py-1.5 text-[13px] md:text-[12px] text-kumo-default">
          No agent spawner is bound to the hub yet, so Bots can’t run. Give a Bot grants (Details → Grants) or assign AGENT_SPAWNER in the workspace’s Connections.
        </div>
      )}
      {view === 'feed' && <div className="min-h-0 flex-1 overflow-y-auto md:hidden flex flex-col">{feed}</div>}
      <nav className={`min-h-0 flex-1 overflow-y-auto ${view === 'feed' ? 'hidden md:block' : ''}`} aria-label="Bots">
        {hubState.error && <div className="p-3 text-[13px] md:text-[12px] text-kumo-danger">{hubState.error}</div>}
        {!hubState.hub && !hubState.error && (
          // Connecting to the hub: a quiet placeholder, not the empty state (which would flash on
          // every load before the roster arrives).
          <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="Loading Bots">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2.5 py-1.5">
                <span className="h-8 w-8 flex-none animate-pulse rounded-full bg-kumo-tint" />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5"><span className="h-3 w-24 animate-pulse rounded bg-kumo-tint" /><span className="h-2.5 w-40 animate-pulse rounded bg-kumo-tint" /></span>
              </div>
            ))}
          </div>
        )}
        {hubState.hub && hubState.bots.length === 0 && !hubState.error && (
          <div className="flex flex-col gap-2 p-4 text-[13px] md:text-[12px] text-kumo-subtle">
            <div>No Bots yet.</div>
            <Button variant="secondary" size="sm" onClick={addExamples} loading={seeding !== null} disabled={!hubState.hub}>Add example Bots</Button>
            {seeding && <div className="text-[12px] md:text-[11px]">{seeding}</div>}
          </div>
        )}
        {hubState.bots.map((bot) => (
          <button
            key={bot.id}
            type="button"
            onClick={() => navigate({ to: '/bots/$id', params: { id: bot.id } })}
            className={`flex w-full items-center gap-2.5 border-b border-kumo-line px-3 py-2.5 text-left hover:bg-kumo-tint ${bot.id === botId ? 'bg-kumo-brand/10' : ''}`}
            aria-current={bot.id === botId ? 'page' : undefined}
          >
            <BotAvatar bot={bot} />
            <span className="min-w-0">
              <span className="block truncate text-[14px] md:text-[13px] font-medium text-kumo-default">{bot.name}</span>
              <span className="block truncate text-[13px] md:text-[12px] text-kumo-subtle">{bot.role || 'Bot'}</span>
            </span>
          </button>
        ))}
        {(hubState.groups.length > 0 || hubState.bots.length > 1) && (
          <div className="flex items-center justify-between border-b border-kumo-line px-3 py-1.5">
            <span className="text-[12px] md:text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">Groups</span>
            <WorkshopIconButton onClick={() => setShowNewGroup(true)} title="New group" aria-label="New group" className="!h-6 !w-6"><Plus size={12} /></WorkshopIconButton>
          </div>
        )}
        {hubState.groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => navigate({ to: '/bots/group/$groupId', params: { groupId: g.id } })}
            className={`flex w-full items-center gap-2.5 border-b border-kumo-line px-3 py-2.5 text-left hover:bg-kumo-tint ${g.id === groupId ? 'bg-kumo-brand/10' : ''}`}
            aria-current={g.id === groupId ? 'page' : undefined}
          >
            <span className="inline-grid h-8 w-8 flex-none place-items-center rounded-full bg-kumo-tint text-kumo-default" aria-hidden><UsersThree size={16} /></span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] md:text-[13px] font-medium text-kumo-default">{g.name}</span>
              <span className="block truncate text-[13px] md:text-[12px] text-kumo-subtle">{g.members.length ? g.members.map((m) => m.name).join(', ') : 'No members'}</span>
            </span>
          </button>
        ))}
      </nav>
    </aside>
  )

  return (
    <div className="flex h-full min-h-0 w-full">
      {roster}
      {selected && hubState.hub ? (
        <>
          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 flex-none items-center gap-2 border-b border-kumo-line px-3">
              <WorkshopIconButton onClick={() => navigate({ to: '/bots' })} className="!h-8 !w-8 md:hidden" aria-label="Back to Bots" title="Back to Bots">
                <CaretLeft size={14} />
              </WorkshopIconButton>
              <BotAvatar bot={selected} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] md:text-[13px] font-medium text-kumo-default">{selected.name}</div>
                <div className="truncate text-[12px] md:text-[11px] text-kumo-subtle">{selected.role || 'Bot'}</div>
              </div>
              <WorkshopIconButton onClick={toggleShowWork} className={`!h-8 !w-8 ${showWork ? 'text-kumo-brand' : ''}`} aria-label={showWork ? 'Hide the Bot’s work' : 'Show the Bot’s work'} title={showWork ? 'Hide work (code runs, callbacks)' : 'Show work (code runs, callbacks)'} aria-pressed={showWork}>
                <Wrench size={14} />
              </WorkshopIconButton>
              <WorkshopIconButton onClick={() => setDetailsOpen((o) => !o)} className="!h-8 !w-8 lg:hidden" aria-label="Bot details" title="Bot details">
                <Info size={14} />
              </WorkshopIconButton>
            </header>
            <BotTranscript key={selected.id + selected.chatTitle} overseer={overseer.stub} bot={selected} workspaceId={workspaceId} showWork={showWork} />
          </section>
          <BotDetails
            key={selected.id}
            bot={selected}
            hub={hubState.hub}
            hubVersion={hubState.version}
            overseer={overseer.stub}
            hubWorkpieceId={workpieceId}
            open={detailsOpen}
            onClose={() => setDetailsOpen(false)}
            onDeleted={() => navigate({ to: '/bots' })}
          />
        </>
      ) : selectedGroup && hubState.hub ? (
        <GroupView
          key={selectedGroup.id}
          group={selectedGroup}
          bots={hubState.bots}
          hub={hubState.hub}
          userName={currentUser?.name || 'you'}
          lastUpdate={hubState.lastUpdate}
          onBack={() => navigate({ to: '/bots' })}
          onOpenBot={(id) => navigate({ to: '/bots/$id', params: { id } })}
          onDeleted={() => navigate({ to: '/bots' })}
        />
      ) : (
        <section className="hidden min-w-0 flex-1 flex-col md:flex" aria-label="Activity">
          <div className="flex h-12 flex-none items-center border-b border-kumo-line px-4 text-[14px] md:text-[13px] font-medium text-kumo-default">
            What your Bots have been doing
          </div>
          {feed}
        </section>
      )}
      <NewBotDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreate={async (input) => {
          const hub = hubState.hub
          if (!hub) throw new Error('Not connected yet.')
          const bot: Bot = await hub.createBot(input)
          await hubState.refreshBots()
          setShowNew(false)
          navigate({ to: '/bots/$id', params: { id: bot.id } })
          toasts.add({ title: `${bot.name} is ready`, variant: 'success' })
        }}
      />
      <GroupDialog
        open={showNewGroup}
        onClose={() => setShowNewGroup(false)}
        bots={hubState.bots}
        group={null}
        onSave={async (input) => {
          const hub = hubState.hub
          if (!hub) throw new Error('Not connected yet.')
          const g = await hub.createGroup(input)
          await hubState.refreshBots()
          setShowNewGroup(false)
          navigate({ to: '/bots/group/$groupId', params: { groupId: g.id } })
        }}
      />
      {hubState.hub && <SkillsDialog open={showSkills} onClose={() => setShowSkills(false)} hub={hubState.hub} onAddExamples={addExamples} addingExamples={seeding} onUpdateHub={updateHub} hubRevision={hubState.info?.revision} />}
    </div>
  )
}

// -------------------------------------------------------------------------------------------------

/**
 * The Bot's conversation is an ordinary workspace chat (the one its agent spawner created), found
 * by its unique title. Rendered with the full ChatInterface, so approvals, streaming and slash
 * commands behave exactly as elsewhere. Human messages typed here go straight into that chat.
 */
function BotTranscript({ overseer, bot, workspaceId, showWork }: { overseer: RpcStub<Overseer>; bot: Bot; workspaceId: string; showWork: boolean }) {
  const [chatId, setChatId] = useState<number | null>(null)
  const [looked, setLooked] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const find = async (attempt: number) => {
      try {
        const chats: AiChatMetadata[] = await overseer.listChats()
        if (cancelled) return
        const match = chats.filter((c) => c.title === bot.chatTitle).toSorted((a, b) => b.id - a.id)[0]
        if (match) { setChatId(match.id); setLooked(true); return }
      } catch { /* retry below */ }
      if (cancelled) return
      setLooked(true)
      // The chat is created asynchronously when the Bot is; keep looking for a little while.
      if (attempt < 10) timer = setTimeout(() => find(attempt + 1), 1000)
    }
    find(0)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [overseer, bot.chatTitle])

  if (chatId === null) {
    return (
      <CenteredNote>
        {looked && !bot.agentReady
          ? 'This Bot can’t run yet — open Details and give it something to work with.'
          : <Loader />}
      </CenteredNote>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatInterface
        workspaceId={workspaceId}
        overseer={overseer}
        selectedChatId={chatId}
        onNavigateToChat={() => {}}
        hideChatHeader
        conversationView
        showWork={showWork}
        constrainChatWidth
        pendingConsoleLogCount={0}
        consoleLogPreview=""
        consoleLogSeverity="info"
        onConsumeConsoleLogs={() => ''}
        onDiscardConsoleLogs={() => {}}
        onOpenGadget={() => {}}
        outputOfWorkpiece={() => undefined}
      />
    </div>
  )
}

// -------------------------------------------------------------------------------------------------

function NewBotDialog({ open, onClose, onCreate }: {
  open: boolean
  onClose: () => void
  onCreate: (input: { name: string; role: string; instructions: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setName(''); setRole(''); setInstructions(''); setError('') } }, [open])
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="base" className="!w-[min(560px,calc(100vw-32px))] bg-kumo-base p-0">
        <form
          className="flex flex-col gap-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true); setError('')
            try { await onCreate({ name, role, instructions }) }
            catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            finally { setBusy(false) }
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-[18px] font-medium tracking-[-0.4px] text-kumo-default">New Bot</Dialog.Title>
              <Dialog.Description className="mt-1 text-[14px] md:text-[13px] text-kumo-subtle">A teammate with a name, a role and standing instructions.</Dialog.Description>
            </div>
            <Dialog.Close render={(props) => <WorkshopIconButton {...props} aria-label="Close"><X size={16} /></WorkshopIconButton>} />
          </div>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Inbox Manager" autoFocus required />
          <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Triages email and drafts replies" />
          <label className="flex flex-col gap-1 text-[13px] md:text-[12px] text-kumo-subtle">
            Instructions
            <textarea
              className="min-h-[120px] rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-[14px] md:text-[13px] text-kumo-default"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="What to do, how to decide, when to ask you."
            />
          </label>
          {error && <div className="text-[13px] md:text-[12px] text-kumo-danger">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>Create Bot</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  )
}

// -------------------------------------------------------------------------------------------------

function BotDetails({ bot, hub, hubVersion, overseer, hubWorkpieceId, open, onClose, onDeleted }: {
  bot: Bot
  hub: HubStub
  hubVersion: number
  overseer: RpcStub<Overseer>
  hubWorkpieceId: number
  open: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const toasts = useKumoToastManager()
  const [name, setName] = useState(bot.name)
  const [role, setRole] = useState(bot.role)
  const [instructions, setInstructions] = useState(bot.instructions)
  const [memories, setMemories] = useState<BotMemory[]>([])
  const [routines, setRoutines] = useState<BotRoutine[]>([])
  const [events, setEvents] = useState<BotEvent[]>([])
  const [saving, setSaving] = useState(false)
  const [armDelete, setArmDelete] = useState(false)
  const [grantsOpen, setGrantsOpen] = useState(false)
  const [runSkillOpen, setRunSkillOpen] = useState(false)
  const [costs, setCosts] = useState<BotCosts | null>(null)
  const [capDraft, setCapDraft] = useState('')
  const [computer, setComputer] = useState<Partial<Record<ComputerKind, GadgetBindingInfo>>>({})
  const actions = useActions(overseer)
  const pendingCount = useMemo(() => {
    let n = 0
    for (const entry of actions.actionsById.values()) if ((entry as { state?: string }).state === 'pending') n++
    return n
  }, [actions.actionsById])

  useEffect(() => { setName(bot.name); setRole(bot.role); setInstructions(bot.instructions) }, [bot.id, bot.name, bot.role, bot.instructions])
  useEffect(() => { setCapDraft(bot.dailyCapUsd === null || bot.dailyCapUsd === undefined ? '' : String(bot.dailyCapUsd)) }, [bot.id, bot.dailyCapUsd])
  useEffect(() => {
    let cancelled = false
    hub.costs(bot.id).then((c) => { if (!cancelled) setCosts(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [hub, bot.id, hubVersion])

  useEffect(() => {
    let cancelled = false
    Promise.all([hub.listMemories(bot.id, { limit: 100 }), hub.listRoutines(bot.id), hub.activity(bot.id, { limit: 60 })])
      .then(([m, r, e]) => { if (!cancelled) { setMemories(m); setRoutines(r); setEvents(e) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [hub, bot.id, hubVersion])

  // The Bot's computer (browser profile / sandbox) lives in hub bindings named after the Bot.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const client = overseer.getGadget(hubWorkpieceId)
      try {
        const list = await client.listBindings()
        if (cancelled) return
        const next: Partial<Record<ComputerKind, GadgetBindingInfo>> = {}
        for (const kind of ['browser', 'sandbox'] as const) {
          const b = list.find((x) => x.name === computerBindingNameFor(bot.id, kind))
          if (b) next[kind] = b
        }
        setComputer(next)
      } finally {
        client[Symbol.dispose]()
      }
    })().catch(() => {})
    return () => { cancelled = true }
  }, [overseer, hubWorkpieceId, bot.id, bot.agentGeneration, grantsOpen])

  const dirty = name !== bot.name || role !== bot.role || instructions !== bot.instructions

  const body = (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex h-12 flex-none items-center justify-between border-b border-kumo-line px-3">
        <span className="text-[14px] md:text-[13px] font-medium text-kumo-default">Details</span>
        <span className="text-[12px] md:text-[11px] text-kumo-subtle">{bot.id}</span>
        <WorkshopIconButton onClick={onClose} className="!h-8 !w-8 lg:hidden" aria-label="Close details"><X size={14} /></WorkshopIconButton>
      </div>

      <Section title="Persona">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} />
        <label className="flex flex-col gap-1 text-[13px] md:text-[12px] text-kumo-subtle">
          Instructions
          <textarea className="min-h-[140px] rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-[14px] md:text-[13px] text-kumo-default" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              if (!armDelete) { setArmDelete(true); setTimeout(() => setArmDelete(false), 4000); return }
              try { await hub.deleteBot(bot.id); toasts.add({ title: `${bot.name} deleted`, variant: 'success' }); onDeleted() }
              catch (err) { toasts.add({ title: 'Couldn’t delete', description: String(err instanceof Error ? err.message : err), variant: 'error' }) }
            }}
          >
            {armDelete ? 'Confirm delete' : 'Delete'}
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || saving}
            loading={saving}
            onClick={async () => {
              setSaving(true)
              try { await hub.updateBot(bot.id, { name, role, instructions }); toasts.add({ title: 'Saved', variant: 'success' }) }
              catch (err) { toasts.add({ title: 'Couldn’t save', description: String(err instanceof Error ? err.message : err), variant: 'error' }) }
              finally { setSaving(false) }
            }}
          >
            Save
          </Button>
        </div>
      </Section>

      <Section title="Grants">
        <p className="text-[13px] md:text-[12px] text-kumo-subtle">
          What this Bot may use. Currently through <code className="text-kumo-default">{bot.spawnerBinding}</code>
          {bot.agentGeneration > 1 ? ` (agent #${bot.agentGeneration})` : ''}.
          {pendingCount > 0 && <> {pendingCount} action{pendingCount === 1 ? '' : 's'} awaiting approval in the conversation.</>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setGrantsOpen(true)}>Change what it can use…</Button>
          <Button variant="secondary" onClick={() => setRunSkillOpen(true)}>Run a skill…</Button>
        </div>
      </Section>

      <Section title="Cost">
        {costs ? (
          <p className="text-[13px] md:text-[12px] text-kumo-subtle">
            <span className="text-kumo-default">${costs.todayUsd.toFixed(2)}</span> in the last 24 h · ${costs.totalUsd.toFixed(2)} lifetime over {costs.turns} turn{costs.turns === 1 ? '' : 's'}
            {costs.totalTokens ? ` · ${Intl.NumberFormat().format(costs.totalTokens)} tokens` : ''}
            {costs.dailyCapUsd !== null && costs.todayUsd >= costs.dailyCapUsd && <span className="text-kumo-danger"> · at cap: new work is held</span>}
          </p>
        ) : <p className="text-[13px] md:text-[12px] text-kumo-subtle">Cost is recorded after each turn.</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              const cap = capDraft.trim() === '' ? null : Number(capDraft)
              await hub.updateBot(bot.id, { dailyCapUsd: cap })
              toasts.add({ title: cap === null ? 'Daily cap removed' : `Daily cap set to $${cap.toFixed(2)}`, variant: 'success' })
            } catch (err) { toasts.add({ title: 'Couldn’t set the cap', description: String(err instanceof Error ? err.message : err), variant: 'error' }) }
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-[13px] md:text-[12px] text-kumo-subtle">
            Daily cap (USD, blank = none)
            <input className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-[14px] md:text-[13px] text-kumo-default" inputMode="decimal" value={capDraft} onChange={(e) => setCapDraft(e.target.value)} placeholder="e.g. 5" />
          </label>
          <Button variant="secondary" size="sm" type="submit">Set</Button>
        </form>
      </Section>

      <Section title="Computer">
        {(['browser', 'sandbox'] as const).map((kind) => {
          const b = computer[kind]
          return (
            <div key={kind} className="flex items-start justify-between gap-2 text-[13px] md:text-[12px]">
              <span className="min-w-0">
                <span className="block text-kumo-default">{COMPUTER_VENDORS[kind].title}</span>
                <span className="block truncate text-kumo-subtle" title={b?.resourceTitle}>{b ? b.resourceTitle : 'none yet — add one in Details'}</span>
              </span>
              {b && <a className="flex-none text-kumo-brand underline-offset-2 hover:underline" href={COMPUTER_VENDORS[kind].appPath} target="_blank" rel="noreferrer">Open</a>}
            </div>
          )
        })}
      </Section>

      <Section title={`Memory (${memories.length})`}>
        {memories.length === 0 && <div className="text-[13px] md:text-[12px] text-kumo-subtle">Nothing remembered yet.</div>}
        <ul className="flex flex-col gap-1.5">
          {memories.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-2 text-[13px] md:text-[12px]">
              <span className="min-w-0">
                <span className="block text-[12px] md:text-[11px] text-kumo-subtle">{m.kind} · {fmtTime(m.created)}</span>
                <span className="block text-kumo-default">{m.text}</span>
              </span>
              <WorkshopIconButton onClick={() => hub.forget(m.id).catch(() => {})} className="!h-6 !w-6" aria-label="Forget"><X size={11} /></WorkshopIconButton>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Routines (${routines.length})`}>
        {routines.length === 0 && (
          <div className="text-[13px] md:text-[12px] text-kumo-subtle">None. Ask the Bot (or the project agent) to schedule one; hooks are enabled in Connections.</div>
        )}
        <ul className="flex flex-col gap-2">
          {routines.map((r) => (
            <li key={r.id} className="text-[13px] md:text-[12px]">
              <div className="font-medium text-kumo-default">{r.title}</div>
              <div className="text-kumo-subtle">{r.schedule || 'no schedule text'} · {r.scheduleId ? 'scheduled' : 'not scheduled yet'} · runs: {r.runCount}</div>
              <div className="mt-1 flex gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => hub.runRoutine(r.id).catch(() => {})}>Run now</Button>
                <Button variant="secondary" size="sm" onClick={() => hub.removeRoutine(r.id).catch(() => {})}>Remove</Button>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Activity">
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportActivity(hub, bot, 'json')}>Export JSON</Button>
          <Button variant="secondary" size="sm" onClick={() => exportActivity(hub, bot, 'csv')}>Export CSV</Button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {events.filter((e) => e.type !== 'delivered').slice(-30).toReversed().map((e) => (
            <li key={e.id} className="text-[13px] md:text-[12px]">
              <span className="text-[12px] md:text-[11px] uppercase tracking-wide text-kumo-subtle">{e.type} · {fmtTime(e.ts)}</span>
              {e.text && <div className="whitespace-pre-wrap text-kumo-default">{e.text.slice(0, 400)}</div>}
            </li>
          ))}
        </ul>
      </Section>

      <RunSkillDialog open={runSkillOpen} onClose={() => setRunSkillOpen(false)} hub={hub} botId={bot.id} botName={bot.name} />
      <GrantsDialog
        open={grantsOpen}
        onClose={() => setGrantsOpen(false)}
        bot={bot}
        hub={hub}
        overseer={overseer}
        hubWorkpieceId={hubWorkpieceId}
      />
    </div>
  )

  return (
    <>
      <aside className="hidden h-full w-80 flex-none border-l border-kumo-line bg-kumo-base lg:block">{body}</aside>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30 lg:hidden" onClick={onClose}>
          <div className="h-full w-[min(360px,100vw)] bg-kumo-base shadow-xl" onClick={(e) => e.stopPropagation()}>{body}</div>
        </div>
      )}
    </>
  )
}

/** Audit export: the Bot's full hub activity (messages, deliveries, outcomes, memory, approvals) as a file. */
async function exportActivity(hub: HubStub, bot: Bot, format: 'json' | 'csv') {
  const events = await hub.activity(bot.id, { limit: 500 })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  let blob: Blob
  if (format === 'json') {
    blob = new Blob([JSON.stringify({ bot: { id: bot.id, name: bot.name, role: bot.role }, exported: new Date().toISOString(), events }, null, 2)], { type: 'application/json' })
  } else {
    const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
    const rows = [['id', 'time', 'type', 'text', 'data'].join(','), ...events.map((e) => [e.id, new Date(e.ts).toISOString(), e.type, e.text, JSON.stringify(e.data)].map(esc).join(','))]
    blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bot-${bot.id}-activity-${stamp}.${format}`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-kumo-line px-3 py-3">
      <h2 className="text-[13px] md:text-[12px] font-medium uppercase tracking-wide text-kumo-subtle">{title}</h2>
      {children}
    </section>
  )
}

// -------------------------------------------------------------------------------------------------

/**
 * Per-Bot grants: an agent spawner of its own whose env holds just HUB plus the chosen connections
 * of the hub gadget. Creating it re-creates the Bot's agent (memory carries over; the conversation
 * starts fresh under a new generation title).
 */
function GrantsDialog({ open, onClose, bot, hub, overseer, hubWorkpieceId }: {
  open: boolean
  onClose: () => void
  bot: Bot
  hub: HubStub
  overseer: RpcStub<Overseer>
  hubWorkpieceId: number
}) {
  const toasts = useKumoToastManager()
  const [bindings, setBindings] = useState<GadgetBindingInfo[] | null>(null)
  const [models, setModels] = useState<AiChatAuthorInfo[]>([])
  const [modelId, setModelId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // Computer: existing per-Bot browser/sandbox bindings, whether to grant them, and (when new or
  // replaced) the policy to create them with.
  const [existingComputer, setExistingComputer] = useState<Partial<Record<ComputerKind, GadgetBindingInfo>>>({})
  const [wantBrowser, setWantBrowser] = useState(false)
  const [wantSandbox, setWantSandbox] = useState(false)
  const [replaceComputer, setReplaceComputer] = useState<Set<ComputerKind>>(new Set())
  const [sites, setSites] = useState('')
  const [browseAnywhere, setBrowseAnywhere] = useState(true)
  // Whose cookies: this Bot's own profile, or the shared household one every granted Bot shares.
  const [sharedBrowser, setSharedBrowser] = useState(false)
  const [sandboxMode, setSandboxMode] = useState<'read-only' | 'approve' | 'write'>('approve')
  const { authenticatedApi } = useAuthenticatedApi()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let client: RpcStub<GadgetClient> | null = null
    ;(async () => {
      try {
        client = overseer.getGadget(hubWorkpieceId)
        const [list, modelList] = await Promise.all([client.listBindings(), overseer.listModels()])
        if (cancelled) return
        // Spawner / browser / sandbox bindings belong to individual Bots and are not general grants.
        const grantable = list.filter((b) => !isPerBotBinding(b.name))
        setBindings(grantable)
        setModels(modelList)
        setModelId(getStoredSelectedModel(modelList))
        setChosen(new Set(grantable.map((b) => b.name)))
        const mine: Partial<Record<ComputerKind, GadgetBindingInfo>> = {}
        for (const kind of ['browser', 'sandbox'] as const) {
          const b = list.find((x) => x.name === computerBindingNameFor(bot.id, kind))
          if (b) mine[kind] = b
        }
        setExistingComputer(mine)
        setWantBrowser(!!mine.browser)
        setWantSandbox(!!mine.sandbox)
        setReplaceComputer(new Set())
      } catch (err) {
        if (!cancelled) toasts.add({ title: 'Couldn’t load connections', description: String(err instanceof Error ? err.message : err), variant: 'error' })
      } finally {
        client?.[Symbol.dispose]()
      }
    })()
    return () => { cancelled = true }
  }, [open, overseer, hubWorkpieceId, toasts, bot.id])

  const apply = useCallback(async () => {
    if (!bindings) return
    setBusy(true)
    let client: RpcStub<GadgetClient> | null = null
    let spawner: RpcStub<GatekeeperClient<any>> | null = null
    try {
      const env: Record<string, number> = { HUB: hubWorkpieceId }
      for (const b of bindings) if (chosen.has(b.name)) env[b.name] = b.target
      // The Bot's computer: reuse the existing profile/sandbox unless replaced; create when new.
      const wants: Record<ComputerKind, boolean> = { browser: wantBrowser, sandbox: wantSandbox }
      for (const kind of ['browser', 'sandbox'] as const) {
        if (!wants[kind]) continue
        const existing = existingComputer[kind]
        if (existing && !replaceComputer.has(kind)) { env[COMPUTER_VENDORS[kind].envName] = existing.target; continue }
        const name = computerNameFor(bot)
        const resourceUrl = kind === 'browser'
          ? browserResourceUrl({ name: sharedBrowser ? HOUSEHOLD_PROFILE : name, allowedSites: parseSites(sites), browseAnywhere })
          : sandboxResourceUrl({ name, mode: sandboxMode })
        env[COMPUTER_VENDORS[kind].envName] = await provisionComputer(authenticatedApi, overseer, hubWorkpieceId, bot.id, kind, resourceUrl)
      }
      const created = await overseer.newAgentSpawnerGatekeeper({ displayName: `${bot.name} agent`, modelId, env })
      spawner = created
      const spawnerId = await created.getId()
      const bindingName = spawnerBindingNameFor(bot.id)
      client = overseer.getGadget(hubWorkpieceId)
      const existing = (await client.listBindings()).find((b) => b.name === bindingName)
      if (existing) await client.unbind(bindingName)
      await client.bind(bindingName, spawnerId)
      // Binding restarts the hub gadget and breaks the page's stub; use a fresh one for the respawn.
      const fresh = (await client.connectToGadget()) as unknown as HubStub
      try { await fresh.respawnAgent(bot.id, bindingName) } finally { fresh[Symbol.dispose]() }
      toasts.add({ title: 'Saved', description: `${bot.name} is ready to work.`, variant: 'success' })
      onClose()
    } catch (err) {
      toasts.add({ title: 'Couldn’t save that', description: String(err instanceof Error ? err.message : err), variant: 'error' })
    } finally {
      client?.[Symbol.dispose]()
      spawner?.[Symbol.dispose]()
      setBusy(false)
    }
  }, [bindings, chosen, modelId, overseer, hub, bot, hubWorkpieceId, toasts, onClose, wantBrowser, wantSandbox, existingComputer, replaceComputer, sites, browseAnywhere, sandboxMode, sharedBrowser, authenticatedApi])

  const computerRow = (kind: ComputerKind, want: boolean, setWant: (v: boolean) => void, config: React.ReactNode) => {
    const existing = existingComputer[kind]
    const replacing = replaceComputer.has(kind)
    return (
      <li className="flex flex-col gap-1.5 rounded-md border border-kumo-line p-2">
        <label className="flex items-center gap-2 text-[14px] md:text-[13px] text-kumo-default">
          <input type="checkbox" checked={want} onChange={(e) => setWant(e.target.checked)} />
          <span className="font-mono text-[13px] md:text-[12px]">{COMPUTER_VENDORS[kind].envName}</span>
          <span className="truncate text-kumo-subtle">{COMPUTER_VENDORS[kind].title}</span>
        </label>
        {want && existing && !replacing && (
          <div className="flex items-center justify-between gap-2 pl-6 text-[13px] md:text-[12px] text-kumo-subtle">
            <span className="truncate" title={existing.resourceTitle}>{existing.resourceTitle}</span>
            <button type="button" className="flex-none text-kumo-brand hover:underline" onClick={() => setReplaceComputer((prev) => new Set(prev).add(kind))}>Replace…</button>
          </div>
        )}
        {want && (!existing || replacing) && <div className="flex flex-col gap-1.5 pl-6">{config}</div>}
      </li>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="base" className="!w-[min(560px,calc(100vw-32px))] bg-kumo-base p-0">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-[18px] font-medium tracking-[-0.4px] text-kumo-default">What {bot.name} can use</Dialog.Title>
              <Dialog.Description className="mt-1 text-[14px] md:text-[13px] text-kumo-subtle">
                Pick which of the hub’s connections this Bot may use, and its model. Applying re-creates the Bot’s agent; its memory carries over.
              </Dialog.Description>
            </div>
            <Dialog.Close render={(props) => <WorkshopIconButton {...props} aria-label="Close"><X size={16} /></WorkshopIconButton>} />
          </div>
          {bindings === null ? <Loader /> : (
            <>
              <label className="flex flex-col gap-1 text-[13px] md:text-[12px] text-kumo-subtle">
                Model
                <select className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-[14px] md:text-[13px] text-kumo-default" value={modelId ?? ''} onChange={(e) => setModelId(e.target.value || null)}>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <div className="text-[13px] md:text-[12px] text-kumo-subtle">Anything else it can use</div>
              {bindings.length === 0 && <div className="text-[13px] md:text-[12px] text-kumo-subtle">Nothing else is connected yet, so this Bot has only its own memory.</div>}
              <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                {bindings.map((b) => (
                  <li key={b.name}>
                    <label className="flex items-center gap-2 text-[14px] md:text-[13px] text-kumo-default">
                      <input
                        type="checkbox"
                        checked={chosen.has(b.name)}
                        onChange={(e) => setChosen((prev) => { const next = new Set(prev); if (e.target.checked) next.add(b.name); else next.delete(b.name); return next })}
                      />
                      <span className="font-mono text-[13px] md:text-[12px]">{b.name}</span>
                      <span className="truncate text-kumo-subtle">{b.resourceTitle}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="text-[13px] md:text-[12px] text-kumo-subtle">Computer (a private browser profile and a Linux sandbox of its own)</div>
              <ul className="flex flex-col gap-1.5">
                {computerRow('browser', wantBrowser, setWantBrowser, (
                  <>
                    <label className="flex flex-col gap-1 text-[13px] md:text-[12px] text-kumo-subtle">
                      Sites it may act on (comma-separated; interactions elsewhere ask you first)
                      <input className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-[14px] md:text-[13px] text-kumo-default" placeholder="github.com, docs.google.com" value={sites} onChange={(e) => setSites(e.target.value)} />
                    </label>
                    <label className="flex items-center gap-2 text-[13px] md:text-[12px] text-kumo-default">
                      <input type="checkbox" checked={browseAnywhere} onChange={(e) => setBrowseAnywhere(e.target.checked)} />
                      May read pages on any site
                    </label>
                    <label className="flex items-start gap-2 text-[13px] md:text-[12px] text-kumo-default">
                      <input type="checkbox" className="mt-0.5" checked={sharedBrowser} onChange={(e) => setSharedBrowser(e.target.checked)} />
                      <span>
                        Use the shared household profile
                        <span className="block text-[12px] md:text-[11px] text-kumo-subtle">
                          One set of logins every Bot you tick this for shares — sign in once instead of per Bot. Leave it off to keep this Bot’s cookies to itself.
                        </span>
                      </span>
                    </label>
                  </>
                ))}
                {computerRow('sandbox', wantSandbox, setWantSandbox, (
                  <label className="flex flex-col gap-1 text-[13px] md:text-[12px] text-kumo-subtle">
                    What it may do
                    <select className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-[14px] md:text-[13px] text-kumo-default" value={sandboxMode} onChange={(e) => setSandboxMode(e.target.value as typeof sandboxMode)}>
                      <option value="read-only">Read only</option>
                      <option value="approve">Ask before running commands or writing files</option>
                      <option value="write">Act freely</option>
                    </select>
                  </label>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="primary" onClick={apply} loading={busy} disabled={!modelId}>Save</Button>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
