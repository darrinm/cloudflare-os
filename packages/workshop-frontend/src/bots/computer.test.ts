import { describe, expect, it } from 'vitest'
import {
  browserResourceUrl, computerBindingNameFor, computerNameFor, isPerBotBinding, parseSites, sandboxResourceUrl,
} from './computer'

describe('bots/computer', () => {
  it('names per-Bot bindings and recognizes them', () => {
    expect(computerBindingNameFor('abc-12', 'browser')).toBe('BROWSER_ABC_12')
    expect(computerBindingNameFor('abc-12', 'sandbox')).toBe('SANDBOX_ABC_12')
    expect(isPerBotBinding('BROWSER_ABC_12')).toBe(true)
    expect(isPerBotBinding('SPAWNER_ABC_12')).toBe(true)
    expect(isPerBotBinding('AGENT_SPAWNER')).toBe(true)
    expect(isPerBotBinding('GITHUB')).toBe(false)
  })

  it('derives a stable, URL-safe profile/sandbox name from the Bot', () => {
    expect(computerNameFor({ id: 'AbC12345', name: 'Inbox Manager!' })).toBe('inbox-manager-abc12345')
    expect(computerNameFor({ id: 'x1', name: '***' })).toBe('bot-x1')
  })

  it('builds the wrapper gatekeepers’ resource URLs', () => {
    expect(browserResourceUrl({ name: 'p', allowedSites: ['GitHub.com', ' docs.google.com '], browseAnywhere: true }))
      .toBe('https://browser.iris2.local/profile/p?sites=github.com%2Cdocs.google.com&browse=any')
    expect(browserResourceUrl({ name: 'p', allowedSites: [], browseAnywhere: false })).toBe('https://browser.iris2.local/profile/p')
    expect(sandboxResourceUrl({ name: 'b', mode: 'write' })).toBe('https://sandbox.iris2.local/box/b?mode=write')
  })

  it('parses a sites field leniently', () => {
    expect(parseSites('https://github.com/x, Docs.Google.com\nexample.org example.org')).toEqual(['github.com', 'docs.google.com', 'example.org'])
  })
})
