import { describe, expect, it } from 'vitest'
import { describeBotWork, toConversationEntries } from '../ChatInterface'

// Minimal display entries: only the fields toConversationEntries looks at.
const user = (key: string, text: string) => ({ type: 'message', key, message: { type: 'message', author: { type: 'user', id: 'u', name: 'me' }, message: text } })
const agent = (key: string, text: string, work = false) => ({ type: 'message', key, message: { type: 'message', author: { type: 'agent', id: 'm', name: 'Bot' }, message: text }, ...(work ? { toolCalls: [{}], toolCallGroups: [{}] } : {}) })
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
  it('with showWork keeps everything except the persona', () => {
    const keys = toConversationEntries(entries as never, true).map((e) => e.key)
    expect(keys[0]).toBe('u1')
    expect(keys).toContain('cb')
    expect(keys).toContain('w1')
    expect(keys).toContain('obs')
    expect(keys).toHaveLength(entries.length - 1)
  })
})
