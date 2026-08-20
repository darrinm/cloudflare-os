/**
 * Binding anything to the hub (a Bot's spawner, browser, sandbox, sender) restarts its gadget, and
 * a call that lands during the restart fails with "Gadget restarted due to code update" or a
 * broken/disposed stub. These helpers retry such calls with a short backoff; anything else is
 * rethrown at once.
 */

export const RESTART_RE = /restart|disposed|broken|reset|code update/i
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Runs `fn`, retrying while the hub gadget is restarting under it. */
export async function whileRestarting<T>(fn: () => Promise<T>, onRetry?: (msg: string) => void, attempts = 6): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn() }
    catch (err) {
      const msg = String(err instanceof Error ? err.message : err)
      if (attempt >= attempts || !RESTART_RE.test(msg)) throw err
      onRetry?.(msg)
      await sleep(1000 + attempt * 500)
    }
  }
}

/**
 * A hub stub that survives restarts: `call` runs `fn` on the current stub and, when a restart
 * breaks it, reconnects through `connect` and tries again.
 */
export function restartingHub<H extends { [Symbol.dispose](): void }>(connect: () => Promise<H>, onRetry?: (msg: string) => void) {
  let current: H | null = null
  const fresh = async () => {
    try { current?.[Symbol.dispose]() } catch { /* already gone */ }
    current = await whileRestarting(connect, onRetry)
    return current
  }
  return {
    async call<T>(fn: (hub: H) => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        const hub = current ?? await fresh()
        try { return await fn(hub) }
        catch (err) {
          const msg = String(err instanceof Error ? err.message : err)
          if (attempt >= 4 || !RESTART_RE.test(msg)) throw err
          onRetry?.(msg)
          await sleep(1000 + attempt * 500)
          await fresh()
        }
      }
    },
    dispose() { try { current?.[Symbol.dispose]() } catch { /* ignore */ } current = null },
  }
}
