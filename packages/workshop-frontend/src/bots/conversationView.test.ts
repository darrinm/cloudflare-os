import { describe, expect, it } from 'vitest'
import { toConversationEntries } from '../ChatInterface'

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
] as never

describe('Bot conversation view', () => {
  it('keeps what was said, approvals and errors; folds the work and the persona', () => {
    const keys = toConversationEntries(entries, false).map((e) => e.key)
    expect(keys).toEqual(['u1', 'a1', 'approval', 'err'])
    const a1 = toConversationEntries(entries, false).find((e) => e.key === 'a1') as { toolCallGroups?: unknown[] }
    expect(a1.toolCallGroups).toBeUndefined()
  })
  it('with showWork keeps everything except the persona', () => {
    const keys = toConversationEntries(entries, true).map((e) => e.key)
    expect(keys[0]).toBe('u1')
    expect(keys).toContain('cb')
    expect(keys).toContain('w1')
    expect(keys).toContain('obs')
    expect(keys).toHaveLength(entries.length - 1)
  })
})
