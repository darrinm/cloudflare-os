import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, OutputSummary } from '@gadgets/workshop-shared/api'
import { BOTS_BLUEPRINT_ID, BOTS_OUTPUT_ID } from './types'

export type BotsWorkspaceRef = { workspaceId: string; workpieceId: number }

export type BotsWorkspaceState =
  | { status: 'loading' }
  | { status: 'ready'; ref: BotsWorkspaceRef }
  | { status: 'missing' }
  | { status: 'error'; message: string }

const CACHE_KEY = 'bots:workspace'

function readCache(): BotsWorkspaceRef | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BotsWorkspaceRef>
    if (typeof parsed.workspaceId === 'string' && typeof parsed.workpieceId === 'number') {
      return { workspaceId: parsed.workspaceId, workpieceId: parsed.workpieceId }
    }
  } catch { /* ignore */ }
  return null
}
function writeCache(ref: BotsWorkspaceRef | null) {
  try {
    if (ref) localStorage.setItem(CACHE_KEY, JSON.stringify(ref))
    else localStorage.removeItem(CACHE_KEY)
  } catch { /* ignore */ }
}

/** Picks the user's Bots hub among their outputs: the one they own, oldest first. */
export function pickBotsOutput(outputs: OutputSummary[]): OutputSummary | null {
  const mine = outputs
    .filter((o) => o.output?.id === BOTS_OUTPUT_ID && !o.owner)
    .toSorted((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())
  return mine[0] ?? null
}

/**
 * Locates the user's Bots hub workspace (an output created from the bundled "Bots" blueprint), or
 * reports it missing so the page can offer to create it. Cached in localStorage; the workspace is
 * still opened normally afterwards, so a stale cache surfaces as an open error, not a wrong page.
 */
export function useBotsWorkspace(authenticatedApi: RpcStub<AuthenticatedApi>) {
  const [state, setState] = useState<BotsWorkspaceState>(() => {
    const cached = readCache()
    return cached ? { status: 'ready', ref: cached } : { status: 'loading' }
  })
  const [nonce, setNonce] = useState(0)
  const creatingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Outputs are assembled lazily; loop while the backend is still catching up.
        for (let attempt = 0; attempt < 20; attempt++) {
          const { outputs, catchingUp } = await authenticatedApi.listOutputs()
          const found = pickBotsOutput(outputs)
          if (cancelled) return
          if (found) {
            const ref = { workspaceId: found.workspaceId, workpieceId: found.workpieceId }
            writeCache(ref)
            setState({ status: 'ready', ref })
            return
          }
          if (!catchingUp) break
          await new Promise((r) => setTimeout(r, 400))
        }
        if (cancelled) return
        writeCache(null)
        setState({ status: 'missing' })
      } catch (err) {
        if (cancelled) return
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => { cancelled = true }
  }, [authenticatedApi, nonce])

  /**
   * Creates the hub from the bundled blueprint. `modelId` is the agent spawner's model; null means
   * Bots exist but cannot run until a spawner is assigned in Connections.
   */
  const create = useCallback(async (modelId: string | null): Promise<BotsWorkspaceRef> => {
    if (creatingRef.current) throw new Error('Already creating the Bots hub.')
    creatingRef.current = true
    try {
      const overseer = authenticatedApi.newGadgetFromBlueprint(BOTS_BLUEPRINT_ID, {
        AGENT_SPAWNER: { type: 'agentSpawner', modelId },
      })
      try {
        const metadata = await overseer.getMetadata()
        const ref = { workspaceId: metadata.id, workpieceId: metadata.defaultGadgetId ?? 0 }
        writeCache(ref)
        setState({ status: 'ready', ref })
        return ref
      } finally {
        overseer.then((s) => s[Symbol.dispose]()).catch(() => {})
      }
    } finally {
      creatingRef.current = false
    }
  }, [authenticatedApi])

  const refresh = useCallback(() => {
    writeCache(null)
    setState({ status: 'loading' })
    setNonce((n) => n + 1)
  }, [])

  return { state, create, refresh }
}
