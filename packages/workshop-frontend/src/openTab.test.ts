import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTabWith } from './openTab'

const fakeTab = () => ({ location: { href: '' }, close: vi.fn<() => void>(), opener: {} as unknown })
const withOpen = (impl: () => unknown) => {
  vi.stubGlobal('window', { open: vi.fn<() => unknown>(impl) } as unknown as Window & typeof globalThis)
}

afterEach(() => vi.unstubAllGlobals())

describe('opening a tab for a URL the server has not sent yet', () => {
  it('reserves the tab before awaiting, so the click still counts', async () => {
    const tab = fakeTab()
    withOpen(() => tab)
    let opened = false
    await openTabWith(async () => {
      // The tab must already exist by the time anyone awaits: after the first await the browser
      // has withdrawn the click's permission and window.open is blocked.
      opened = (window.open as ReturnType<typeof vi.fn>).mock.calls.length === 1
      return 'https://example.com/authorize'
    })
    expect(opened).toBe(true)
    expect(tab.location.href).toBe('https://example.com/authorize')
  })

  it('reserves without noopener, then severs opener before navigating', async () => {
    // `noopener` is defined to return null, which is the one thing this cannot use: the handle is
    // what navigates the tab later. Asking for it opened a tab, handed back null, and left it
    // stranded on about:blank -- reported as "blocked" while plainly not being blocked.
    const tab = fakeTab()
    withOpen(() => tab)
    await openTabWith(async () => 'https://example.com/authorize')
    const features = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(String(features ?? '')).not.toMatch(/noopener/)
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('https://example.com/authorize')
  })

  it('says so when the browser blocks the tab, instead of failing silently', async () => {
    withOpen(() => null)
    await expect(openTabWith(async () => 'https://example.com')).rejects.toThrow(/blocked/i)
  })

  it('closes the reserved tab when the request fails', async () => {
    const tab = fakeTab()
    withOpen(() => tab)
    await expect(openTabWith(async () => { throw new Error('nope') })).rejects.toThrow('nope')
    expect(tab.close).toHaveBeenCalled()
  })

  it('closes it and reports false when no URL is needed', async () => {
    const tab = fakeTab()
    withOpen(() => tab)
    await expect(openTabWith(async () => undefined)).resolves.toBe(false)
    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.href).toBe('')
  })
})
