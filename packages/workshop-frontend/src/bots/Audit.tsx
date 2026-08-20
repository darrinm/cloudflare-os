import { useMemo, useState } from 'react'
import { Button } from '@cloudflare/kumo'
import { saveStreamToFile } from '../fileTransfers'
import { fmtTime } from './GroupView'
import type { Bot, BotEvent } from './types'

/**
 * Every hub event, for the person who wants the record rather than the story: the feed drops
 * housekeeping and rewrites the rest as sentences; this keeps each row as the hub stored it, with
 * the filters an audit needs (who, what kind, what text) and the whole filtered set as a file.
 */

export type AuditRow = {
  /** The row as the hub stored it, for export. */
  event: BotEvent
  id: number
  ts: number
  /** The Bot's id is what filters and links key on; names are not unique. */
  botId: string | null
  bot: string
  type: string
  text: string
  /** For decisions: what was decided, and whether a standing "always allow" did it. */
  decision?: { approved: boolean; auto: boolean }
}

export const AUDIT_LIMIT = 500

export function auditRows(events: BotEvent[], names: Map<string, string>): AuditRow[] {
  return events.map((e) => {
    const data = (e.data ?? {}) as { state?: string; autoApproved?: boolean }
    const row: AuditRow = {
      event: e, id: e.id, ts: e.ts, type: e.type, botId: e.botId,
      bot: e.botId ? names.get(e.botId) ?? 'Deleted Bot' : '',
      text: String(e.text ?? '').replace(/\s+/g, ' ').trim(),
    }
    if (e.type === 'decision') {
      row.decision = { approved: data.state ? data.state === 'approved' : /^approved/i.test(row.text), auto: Boolean(data.autoApproved) }
    }
    return row
  }).toReversed()
}

/** `bot` is a Bot id. */
export function filterRows(rows: AuditRow[], f: { bot: string; type: string; q: string }): AuditRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => (!f.bot || r.botId === f.bot) && (!f.type || r.type === f.type) && (!q || r.text.toLowerCase().includes(q) || r.bot.toLowerCase().includes(q)))
}

export function eventsCsv(events: BotEvent[], names: Map<string, string>): string {
  const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const header = ['id', 'time', 'bot', 'type', 'text', 'data'].join(',')
  return [header, ...events.map((e) => [e.id, new Date(e.ts).toISOString(), e.botId ? names.get(e.botId) ?? e.botId : '', e.type, e.text, JSON.stringify(e.data)].map(esc).join(','))].join('\n')
}

const FILE_TYPES = {
  json: { description: 'JSON', contentType: 'application/json', extension: '.json' },
  csv: { description: 'CSV', contentType: 'text/csv', extension: '.csv' },
} as const

/** Saves events as `<base>-<timestamp>.<format>` the way every other export does (save dialog where there is one); the JSON carries `envelope` around the events. */
export async function exportEvents(base: string, format: keyof typeof FILE_TYPES, events: BotEvent[], names: Map<string, string>, envelope: Record<string, unknown>): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const body = format === 'json' ? JSON.stringify({ ...envelope, exported: new Date().toISOString(), events }, null, 2) : eventsCsv(events, names)
  await saveStreamToFile(async () => new Blob([body], { type: FILE_TYPES[format].contentType }).stream(), `${base}-${stamp}.${format}`, FILE_TYPES[format])
}

export function Audit({ bots, events, error, onOpenBot }: {
  bots: Bot[]
  events: BotEvent[] | null
  error: string | null
  onOpenBot: (botId: string) => void
}) {
  const names = useMemo(() => new Map(bots.map((b) => [b.id, b.name])), [bots])
  const [bot, setBot] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const rows = useMemo(() => auditRows(events ?? [], names), [events, names])
  const types = useMemo(() => [...new Set(rows.map((r) => r.type))].sort(), [rows])
  const shown = useMemo(() => filterRows(rows, { bot, type, q }), [rows, bot, type, q])

  const exportAs = (format: 'json' | 'csv') =>
    void exportEvents('bots-audit', format, shown.map((r) => r.event), names, { bots: bots.map((b) => ({ id: b.id, name: b.name, role: b.role })) })

  const select = 'rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-[14px] md:text-[13px] text-kumo-default'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-kumo-line px-3 py-2">
        <select className={select} value={bot} onChange={(e) => setBot(e.target.value)} aria-label="Bot">
          <option value="">All Bots</option>
          {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={select} value={type} onChange={(e) => setType(e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className={`${select} min-w-0 flex-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search" />
        <Button variant="secondary" size="sm" onClick={() => exportAs('json')} disabled={!shown.length}>JSON</Button>
        <Button variant="secondary" size="sm" onClick={() => exportAs('csv')} disabled={!shown.length}>CSV</Button>
      </div>
      {error && <div className="p-4 text-[13px] md:text-[12px] text-kumo-danger">Couldn’t load the record: {error}</div>}
      {!error && events === null && <div className="p-4 text-[13px] md:text-[12px] text-kumo-subtle" aria-busy="true">Loading…</div>}
      {!error && events !== null && !shown.length && <div className="p-6 text-center text-[14px] md:text-[13px] text-kumo-subtle">Nothing matches.</div>}
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Audit">
        {shown.map((r) => (
          <li key={r.id} className="border-b border-kumo-line px-3 py-2 text-[13px] md:text-[12px]">
            <div className="flex flex-wrap items-baseline gap-x-2 text-kumo-subtle">
              <span className="tabular-nums">{fmtTime(r.ts)}</span>
              {r.bot && (
                <button type="button" className="font-medium text-kumo-default hover:underline" onClick={() => { if (r.botId) onOpenBot(r.botId) }}>{r.bot}</button>
              )}
              <span className="uppercase tracking-wide">{r.type}</span>
              {r.decision && (
                <span className={r.decision.approved ? 'text-kumo-default' : 'text-kumo-danger'}>
                  {r.decision.approved ? 'approved' : 'rejected'}{r.decision.auto ? ' · always allow' : ''}
                </span>
              )}
            </div>
            {r.text && <div className="mt-0.5 break-words text-kumo-default">{r.text.length > 300 ? `${r.text.slice(0, 299)}…` : r.text}</div>}
          </li>
        ))}
      </ul>
      <div className="flex-none border-t border-kumo-line px-3 py-1.5 text-[12px] md:text-[11px] text-kumo-subtle">
        {shown.length} of {rows.length}{rows.length >= AUDIT_LIMIT ? ` (last ${AUDIT_LIMIT})` : ''}
      </div>
    </div>
  )
}

export default Audit
