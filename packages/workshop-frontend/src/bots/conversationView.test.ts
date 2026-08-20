import { describe, expect, it } from 'vitest'
import { describeBotWork, toConversationEntries } from '../ChatInterface'

// Minimal display entries: only the fields toConversationEntries looks at. `t` is a chat timestamp,
// used to slot hub events (which carry their own ts) into the transcript by time.
const user = (key: string, text: string, t = 0) => ({ type: 'message', key, message: { type: 'message', author: { type: 'user', id: 'u', name: 'me' }, message: text, timestamp: new Date(t) } })
const agent = (key: string, text: string, work = false, t = 0) => ({ type: 'message', key, message: { type: 'message', author: { type: 'agent', id: 'm', name: 'Bot' }, message: text, timestamp: new Date(t) }, ...(work ? { toolCalls: [{}], toolCallGroups: [{}] } : {}) })
const entries = [
  user('persona', 'You are "Scout", a persistent AI teammate…'),
  user('u1', 'Summarize the page'),
  { type: 'message', key: 'cb', message: { type: 'agentCallback', author: { type: 'agent' } } },
  { type: 'workRun', key: 'w1', toolCalls: [{}], observations: [], toolCallGroups: [{}] },
  agent('a-empty', '   ', true),
  agent('a1', 'Here is the summary…', true),
  { type: 'message', key: 'obs', message: { type: 'action', actionLog: { type: 'observation' } } },
  { type: 'message', key: 'approval', message: { type: 'action', actionLog: { type: 'action' } } },
  { type: 'message', key: 'gadget', message: { type: 'useGadget' } },
  { type: 'message', key: 'err', message: { type: 'error', error: 'boom' } },
]

describe('Bot conversation view', () => {
  it('keeps what was said and approvals; folds the work into one receipt line', () => {
    const out = toConversationEntries(entries as never, false)
    // The persona is gone; each stretch of machinery collapses into one "botWork" receipt row.
    expect(out.filter((e) => e.type !== 'botWork').map((e) => e.key)).toEqual(['u1', 'a1', 'approval', 'err'])
    expect(out[1].type).toBe('botWork')
    const a1 = out.find((e) => e.key === 'a1') as { toolCallGroups?: unknown[] }
    expect(a1.toolCallGroups).toBeUndefined()
    const work = out.find((e) => e.type === 'botWork') as { counts: Record<string, number> }
    // Before the answer: one hand-off, one work run and the empty agent turn's tool call.
    expect(work.counts).toMatchObject({ callbacks: 1, observations: 0 })
    expect(work.counts.code).toBeGreaterThan(0)
    expect(describeBotWork({ code: 3, callbacks: 1, gadget: 1, observations: 2 }))
      .toBe('ran 3 steps · read 2 things · 1 hand-off · used the hub')
    expect(describeBotWork({ code: 1, callbacks: 0, gadget: 0, observations: 0 })).toBe('ran 1 step')
  })
  it('drops a persona the hub sent (author "gadget"), even behind a leading work row', () => {
    // A Bot the hub creates gets its chat from the hub, so the persona is authored by a gadget, and
    // the spawn's own bookkeeping can precede it. It showed in full on the phone because the filter
    // wanted a user-authored first entry.
    const list = [
      { type: 'workRun', key: 'w0', toolCalls: [{}], observations: [], toolCallGroups: [{}] },
      { type: 'message', key: 'persona', message: { type: 'message', author: { type: 'gadget', id: 'owner', name: 'Bots' }, message: 'You are "Researcher", a persistent AI teammate…' } },
      user('u1', 'Quick check: Node release?'),
      agent('a1', 'Node.js LTS is v24.19.0…'),
    ]
    expect(toConversationEntries(list as never, false).filter((e) => e.type !== 'botWork').map((e) => e.key)).toEqual(['u1', 'a1'])
    expect(toConversationEntries(list as never, true).map((e) => e.key)).toEqual(['w0', 'u1', 'a1'])
    // An agent that speaks first is not a persona.
    const spoken = [agent('a0', 'Hello'), user('u1', 'Hi')]
    expect(toConversationEntries(spoken as never, false).map((e) => e.key)).toEqual(['a0', 'u1'])
  })
  it('shows hub-delivered work and its answer as messages, in time order', () => {
    // A hub delivery is an agent callback and its answer the callback's return -- neither is a chat
    // message, so without the events the transcript is a bare "1 hand-off" and nothing said. This is
    // exactly the "I wasn't asked anything" case: Scout asked via the callback's resolve.
    const list = [
      { type: 'message', key: 'persona', message: { type: 'message', author: { type: 'gadget', id: 'o', name: 'Bots' }, message: 'You are "Scout"…', timestamp: new Date(10) } },
      { type: 'message', key: 'cb', message: { type: 'agentCallback', author: { type: 'agent' }, timestamp: new Date(30) } },
      agent('a-empty', '  ', true, 40),
    ]
    const events = [
      { id: 1, ts: 20, type: 'message', text: "Let's try a takeover on github.com", from: { type: 'user' } },
      { id: 2, ts: 50, type: 'completed', text: 'Which site should I sign in to for you?' },
    ]
    const out = toConversationEntries(list as never, false, events)
    const notes = out.filter((e) => (e as { type: string }).type === 'botNote') as Array<{ side: string; text: string }>
    expect(notes.map((n) => [n.side, n.text])).toEqual([
      ['person', "Let's try a takeover on github.com"],
      ['bot', 'Which site should I sign in to for you?'],
    ])
    // The delivery is already shown as what was asked, so it is not also counted as a hand-off.
    const work = out.find((e) => (e as { type: string }).type === 'botWork') as { counts: Record<string, number> } | undefined
    expect(work?.counts.callbacks ?? 0).toBe(0)
  })
  it('renders a needsUser and a failure with the right tone', () => {
    const events = [
      { id: 1, ts: 10, type: 'needsUser', text: 'sign in to the bank' },
      { id: 2, ts: 20, type: 'failed', text: 'the site timed out' },
    ]
    const out = toConversationEntries([] as never, false, events) as Array<{ type: string; tone?: string; text?: string }>
    expect(out.map((e) => [e.tone, e.text])).toEqual([
      ['needs', 'Needs you: sign in to the bank'],
      ['failed', 'the site timed out'],
    ])
  })
  it('with showWork keeps everything except the persona', () => {
    const keys = toConversationEntries(entries as never, true).map((e) => e.key)
    expect(keys[0]).toBe('u1')
    expect(keys).toContain('cb')
    expect(keys).toContain('w1')
    expect(keys).toContain('obs')
    expect(keys).toHaveLength(entries.length - 1)
  })
})
