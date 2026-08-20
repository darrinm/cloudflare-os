import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, Input, Loader, useKumoToastManager } from '@cloudflare/kumo'
import { CaretLeft, PaperPlaneRight, PencilSimple, X } from '@phosphor-icons/react'
import { WorkshopIconButton } from '../components/WorkshopControls'
import type { HubStub, SeqUpdate } from './useBotsHub'
import type { Bot, BotGroup, GroupPost } from './types'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * A group: several Bots sharing one transcript kept by the hub. Posting here fans out to every
 * member as work; their replies come back as posts. Not a kernel chat — each Bot's own reasoning
 * stays in its own conversation.
 */
export function GroupView({ group, bots, hub, userName, updates, onBack, onOpenBot, onDeleted }: {
  group: BotGroup
  bots: Bot[]
  hub: HubStub
  userName: string
  updates: SeqUpdate[]
  onBack: () => void
  onOpenBot: (botId: string) => void
  onDeleted: () => void
}) {
  const toasts = useKumoToastManager()
  const toastsRef = useRef(toasts)
  toastsRef.current = toasts
  const [posts, setPosts] = useState<GroupPost[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots])

  useEffect(() => {
    let cancelled = false
    setPosts(null)
    hub.groupTranscript(group.id, { limit: 200 })
      .then((list) => { if (!cancelled) setPosts(list) })
      .catch((err) => { if (!cancelled) toastsRef.current.add({ title: 'Couldn’t load the group', description: String(err instanceof Error ? err.message : err), variant: 'error' }) })
    return () => { cancelled = true }
  }, [hub, group.id])

  // Live posts arrive through the hub subscription the page already holds. Drain everything newer
  // than the last update handled -- a single "latest" slot would drop one of two posts landing in
  // the same render batch. The id-dedupe makes replaying older buffered updates harmless.
  const seenSeqRef = useRef(0)
  useEffect(() => {
    const fresh: GroupPost[] = []
    for (const { seq, update } of updates) {
      if (seq <= seenSeqRef.current) continue
      seenSeqRef.current = seq
      if (update.type === 'groupPost' && update.groupId === group.id) fresh.push(update.post)
    }
    if (!fresh.length) return
    setPosts((prev) => {
      if (!prev) return prev
      const add = fresh.filter((p) => !prev.some((q) => q.id === p.id))
      return add.length ? [...prev, ...add] : prev
    })
  }, [updates, group.id])

  useEffect(() => { bottomRef.current?.scrollIntoView?.({ block: 'end' }) }, [posts?.length])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const r = await hub.groupPost(group.id, text, { type: 'user', name: userName })
      setDraft('')
      if (r.deliveredTo.length === 0) toasts.add({ title: 'Posted, but no Bot was reached', description: group.members.length ? String(r.held ?? '') : 'Add members to the group first.', variant: 'error' })
    } catch (err) {
      toasts.add({ title: 'Couldn’t post', description: String(err instanceof Error ? err.message : err), variant: 'error' })
    } finally { setBusy(false) }
  }, [draft, busy, hub, group.id, group.members.length, userName, toasts])

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 flex-none items-center gap-2 border-b border-kumo-line px-3">
        <WorkshopIconButton onClick={onBack} className="!h-8 !w-8 md:hidden" aria-label="Back to Bots" title="Back to Bots"><CaretLeft size={14} /></WorkshopIconButton>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] md:text-[13px] font-medium text-kumo-default">{group.name}</div>
          <div className="truncate text-[12px] md:text-[11px] text-kumo-subtle">
            {group.members.length ? group.members.map((m) => m.name).join(', ') : 'No members yet'}{group.purpose ? ` · ${group.purpose}` : ''}
          </div>
        </div>
        <WorkshopIconButton onClick={() => setEditOpen(true)} className="!h-8 !w-8" aria-label="Edit group" title="Edit group"><PencilSimple size={14} /></WorkshopIconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {posts === null && <div className="flex justify-center py-8"><Loader /></div>}
        {posts?.length === 0 && (
          <div className="py-8 text-center text-[14px] md:text-[13px] text-kumo-subtle">
            Nothing here yet. Post below and every member Bot gets it as work; their replies show up here.
          </div>
        )}
        <ol className="mx-auto flex max-w-[720px] flex-col gap-3">
          {posts?.map((p) => {
            const bot = p.from.botId ? botsById.get(p.from.botId) : null
            const mine = p.from.type === 'user'
            return (
              <li key={p.id} className={`flex flex-col gap-0.5 ${mine ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-1.5 text-[12px] md:text-[11px] text-kumo-subtle">
                  {bot ? (
                    <button type="button" className="font-medium text-kumo-default hover:underline" onClick={() => onOpenBot(bot.id)}>{p.from.name}</button>
                  ) : <span className="font-medium text-kumo-default">{p.from.name}</span>}
                  {p.from.type === 'bot' && <span>· bot</span>}
                  <span>· {fmtTime(p.ts)}</span>
                  {p.held && <span className="text-kumo-danger">· not delivered ({p.held})</span>}
                </div>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[14px] md:text-[13px] ${mine ? 'bg-kumo-brand/10 text-kumo-default' : 'border border-kumo-line bg-kumo-base text-kumo-default'}`}>{p.text}</div>
              </li>
            )
          })}
        </ol>
        <div ref={bottomRef} />
      </div>

      <form className="flex flex-none items-end gap-2 border-t border-kumo-line p-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <textarea
          className="min-h-[40px] flex-1 resize-none rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-[14px] md:text-[13px] text-kumo-default"
          placeholder={`Message ${group.name}…`}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
        />
        <Button variant="primary" type="submit" loading={busy} disabled={!draft.trim()} aria-label="Post"><PaperPlaneRight size={14} /></Button>
      </form>

      <GroupDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        bots={bots}
        group={group}
        onSave={async (input) => { await hub.updateGroup(group.id, input); setEditOpen(false) }}
        onDelete={async () => { await hub.deleteGroup(group.id); setEditOpen(false); onDeleted() }}
      />
    </section>
  )
}

/** Create or edit a group: name, purpose, members. */
export function GroupDialog({ open, onClose, bots, group, onSave, onDelete }: {
  open: boolean
  onClose: () => void
  bots: Bot[]
  group: BotGroup | null
  onSave: (input: { name: string; purpose: string; members: string[] }) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [armDelete, setArmDelete] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(group?.name ?? '')
    setPurpose(group?.purpose ?? '')
    setMembers(new Set(group?.members.map((m) => m.id) ?? []))
    setError(''); setArmDelete(false)
  }, [open, group])
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="base" className="!w-[min(560px,calc(100vw-32px))] bg-kumo-base p-0">
        <form
          className="flex flex-col gap-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setError('')
            try { await onSave({ name, purpose, members: [...members] }) }
            catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            finally { setBusy(false) }
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-[18px] font-medium tracking-[-0.4px] text-kumo-default">{group ? 'Edit group' : 'New group'}</Dialog.Title>
              <Dialog.Description className="mt-1 text-[14px] md:text-[13px] text-kumo-subtle">A shared transcript for several Bots. Posts fan out to every member; a member replies only when it has something to add.</Dialog.Description>
            </div>
            <Dialog.Close render={(props) => <WorkshopIconButton {...props} aria-label="Close"><X size={16} /></WorkshopIconButton>} />
          </div>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch team" autoFocus required />
          <Input label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What this group is for (sent with every post)" />
          <div className="text-[13px] md:text-[12px] text-kumo-subtle">Members</div>
          {bots.length === 0 && <div className="text-[13px] md:text-[12px] text-kumo-subtle">Create some Bots first.</div>}
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {bots.map((b) => (
              <li key={b.id}>
                <label className="flex items-center gap-2 text-[14px] md:text-[13px] text-kumo-default">
                  <input type="checkbox" checked={members.has(b.id)} onChange={(e) => setMembers((prev) => { const next = new Set(prev); if (e.target.checked) next.add(b.id); else next.delete(b.id); return next })} />
                  <span className="font-medium">{b.name}</span>
                  <span className="truncate text-kumo-subtle">{b.role}</span>
                </label>
              </li>
            ))}
          </ul>
          {error && <div className="text-[13px] md:text-[12px] text-kumo-danger">{error}</div>}
          <div className="flex items-center justify-between gap-2">
            <div>
              {group && onDelete && (
                <Button variant="secondary" type="button" disabled={busy} onClick={async () => {
                  if (!armDelete) { setArmDelete(true); setTimeout(() => setArmDelete(false), 4000); return }
                  setBusy(true)
                  try { await onDelete() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
                }}>{armDelete ? 'Confirm delete' : 'Delete group'}</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>{group ? 'Save' : 'Create group'}</Button>
            </div>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  )
}
