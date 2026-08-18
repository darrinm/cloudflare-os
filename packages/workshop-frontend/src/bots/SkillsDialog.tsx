import { useEffect, useState } from 'react'
import { Button, Dialog, Input, Loader, useKumoToastManager } from '@cloudflare/kumo'
import { X } from '@phosphor-icons/react'
import { WorkshopIconButton } from '../components/WorkshopControls'
import type { HubStub } from './useBotsHub'
import type { HubSkill } from './types'

/**
 * Hub skills: named, reusable instructions any Bot can be sent (`/name args`). Bodies are markdown
 * with `$ARGUMENT` where the invocation's args go. Agent Skills from the Context Library work too
 * (through the conversation's `/` menu); these are the hub-local kind that needs no collection.
 */
export function SkillsDialog({ open, onClose, hub, onAddExamples, addingExamples }: { open: boolean; onClose: () => void; hub: HubStub; onAddExamples?: () => void; addingExamples?: string | null }) {
  const toasts = useKumoToastManager()
  const [skills, setSkills] = useState<HubSkill[] | null>(null)
  const [editing, setEditing] = useState<{ name: string; description: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    try { setSkills(await hub.listSkills()) }
    catch (err) { toasts.add({ title: 'Couldn’t load skills', description: String(err instanceof Error ? err.message : err), variant: 'error' }) }
  }
  useEffect(() => { if (open) { setEditing(null); void reload() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="base" className="!w-[min(640px,calc(100vw-32px))] bg-kumo-base p-0">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-[18px] font-medium tracking-[-0.4px] text-kumo-default">Skills</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-kumo-subtle">
                Reusable instructions any Bot can be given by name. Write <code>$ARGUMENT</code> where the request’s details go.
              </Dialog.Description>
            </div>
            <Dialog.Close render={(props) => <WorkshopIconButton {...props} aria-label="Close"><X size={16} /></WorkshopIconButton>} />
          </div>
          {editing ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault(); setBusy(true)
                try { await hub.defineSkill(editing); setEditing(null); await reload(); toasts.add({ title: `Skill "${editing.name}" saved`, variant: 'success' }) }
                catch (err) { toasts.add({ title: 'Couldn’t save', description: String(err instanceof Error ? err.message : err), variant: 'error' }) }
                finally { setBusy(false) }
              }}
            >
              <Input label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="weekly-report" required />
              <Input label="Description" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="What it does, in one line" />
              <label className="flex flex-col gap-1 text-[12px] text-kumo-subtle">
                Instructions
                <textarea className="min-h-[180px] rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 font-mono text-[12px] text-kumo-default" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} placeholder={'Write a weekly report about $ARGUMENT.\nKeep it under 200 words.'} required />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setEditing(null)} disabled={busy}>Back</Button>
                <Button variant="primary" type="submit" loading={busy} disabled={!editing.name.trim() || !editing.body.trim()}>Save skill</Button>
              </div>
            </form>
          ) : (
            <>
              {skills === null && <Loader />}
              {skills?.length === 0 && <div className="text-[12px] text-kumo-subtle">No skills yet.</div>}
              <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {skills?.map((s) => (
                  <li key={s.name} className="flex items-start justify-between gap-2 rounded-md border border-kumo-line px-2 py-1.5 text-[13px]">
                    <span className="min-w-0">
                      <span className="block font-mono text-[12px] text-kumo-default">/{s.name}</span>
                      <span className="block truncate text-[12px] text-kumo-subtle">{s.description || 'no description'}</span>
                    </span>
                    <span className="flex flex-none gap-1">
                      <Button variant="secondary" size="sm" onClick={async () => { const full = await hub.getSkill(s.name); if (full) setEditing({ name: full.name, description: full.description, body: full.body ?? '' }) }}>Edit</Button>
                      <Button variant="secondary" size="sm" onClick={async () => { await hub.removeSkill(s.name); await reload() }}>Remove</Button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-[11px] text-kumo-subtle">
                  {onAddExamples && (
                    <Button variant="secondary" size="sm" onClick={onAddExamples} loading={!!addingExamples}>Add example Bots</Button>
                  )}
                  {addingExamples && <span className="ml-2">{addingExamples}</span>}
                </div>
                <Button variant="primary" onClick={() => setEditing({ name: '', description: '', body: '' })}>New skill</Button>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

/** Sends a hub skill to one Bot: pick the skill, add the argument, go. */
export function RunSkillDialog({ open, onClose, hub, botId, botName }: { open: boolean; onClose: () => void; hub: HubStub; botId: string; botName: string }) {
  const toasts = useKumoToastManager()
  const [skills, setSkills] = useState<HubSkill[] | null>(null)
  const [name, setName] = useState('')
  const [args, setArgs] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setArgs('')
    hub.listSkills().then((list) => { setSkills(list); setName((n) => n || list[0]?.name || '') }).catch(() => setSkills([]))
  }, [open, hub])
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog size="base" className="!w-[min(520px,calc(100vw-32px))] bg-kumo-base p-0">
        <form
          className="flex flex-col gap-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault(); if (!name) return
            setBusy(true)
            try { await hub.send(botId, { skill: name, args }, { type: 'user' }); toasts.add({ title: `Sent /${name} to ${botName}`, variant: 'success' }); onClose() }
            catch (err) { toasts.add({ title: 'Couldn’t send', description: String(err instanceof Error ? err.message : err), variant: 'error' }) }
            finally { setBusy(false) }
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-[18px] font-medium tracking-[-0.4px] text-kumo-default">Run a skill</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-kumo-subtle">{botName} gets the skill’s instructions as a work item; the result lands in its conversation.</Dialog.Description>
            </div>
            <Dialog.Close render={(props) => <WorkshopIconButton {...props} aria-label="Close"><X size={16} /></WorkshopIconButton>} />
          </div>
          {skills === null ? <Loader /> : skills.length === 0 ? (
            <div className="text-[12px] text-kumo-subtle">No skills defined yet — add some under Skills in the roster.</div>
          ) : (
            <label className="flex flex-col gap-1 text-[12px] text-kumo-subtle">
              Skill
              <select className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-[13px] text-kumo-default" value={name} onChange={(e) => setName(e.target.value)}>
                {skills.map((s) => <option key={s.name} value={s.name}>/{s.name}{s.description ? ` — ${s.description}` : ''}</option>)}
              </select>
            </label>
          )}
          <Input label="Argument" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="Details for this run (fills $ARGUMENT)" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy} disabled={!name}>Send</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  )
}
