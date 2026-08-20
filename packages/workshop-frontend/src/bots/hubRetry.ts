/**
 * Binding anything to the hub (a Bot's spawner, browser, sandbox, sender) restarts its gadget, and
 * a call that lands during the restart fails with "Gadget restarted due to code update" or a
 * broken/disposed stub. This retries such calls with a short backoff; anything else is rethrown at
 * once.
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
