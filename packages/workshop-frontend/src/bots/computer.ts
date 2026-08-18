// A Bot's "computer": a private browser profile and/or a Linux sandbox, each a gatekeeper of the
// deployment's Browser / Sandbox vendors bound into the hub gadget under a per-Bot name and handed
// to the Bot's agent spawner as BROWSER / SANDBOX. The vendors are wrapper-provided (iris2
// packages/gatekeeper-browser and packages/gatekeeper-sandbox); this file only knows their resource
// URL shapes and vendor ids, and degrades to "not available" when a deployment lacks them.

import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, Overseer } from '@gadgets/workshop-shared/api'
import { AccountsSubscriberAdapter } from '../accountsSubscriber'

export type ComputerKind = 'browser' | 'sandbox'

export const COMPUTER_VENDORS: Record<ComputerKind, { vendorId: string; envName: string; appPath: string; title: string }> = {
  browser: { vendorId: 'browser', envName: 'BROWSER', appPath: '/gatekeepers/browser', title: 'Browser profile' },
  sandbox: { vendorId: 'sandbox', envName: 'SANDBOX', appPath: '/gatekeepers/sandbox', title: 'Sandbox' },
}

/** The hub gadget binding name that holds a Bot's browser profile or sandbox gatekeeper. */
export function computerBindingNameFor(botId: string, kind: ComputerKind): string {
  return `${COMPUTER_VENDORS[kind].envName}_${botId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`
}

/** True for hub bindings that belong to a Bot's own machinery (spawner, browser, sandbox). */
export function isPerBotBinding(name: string): boolean {
  return name === 'AGENT_SPAWNER' || /^(SPAWNER|BROWSER|SANDBOX)_/.test(name)
}

/** A profile / sandbox name derived from the Bot: stable, URL-safe, human-readable. */
export function computerNameFor(bot: { id: string; name: string }): string {
  const base = bot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'bot'
  return `${base}-${bot.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8)}`
}

export type BrowserPolicy = { name: string; allowedSites: string[]; browseAnywhere: boolean }
export type SandboxPolicy = { name: string; mode: 'read-only' | 'approve' | 'write' }

export function browserResourceUrl(policy: BrowserPolicy): string {
  const url = new URL(`https://browser.iris2.local/profile/${encodeURIComponent(policy.name)}`)
  const sites = policy.allowedSites.map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (sites.length) url.searchParams.set('sites', sites.join(','))
  if (policy.browseAnywhere) url.searchParams.set('browse', 'any')
  return url.toString()
}

export function sandboxResourceUrl(policy: SandboxPolicy): string {
  const url = new URL(`https://sandbox.iris2.local/box/${encodeURIComponent(policy.name)}`)
  url.searchParams.set('mode', policy.mode)
  return url.toString()
}

/** Splits "github.com, docs.google.com" (or newline-separated) into hostnames. */
export function parseSites(input: string): string[] {
  return Array.from(new Set(input.split(/[\s,]+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)))
}

/**
 * Finds the user's connected account for an ambient vendor, provisioning it on first use. Returns
 * null when the deployment has no such vendor (the Computer section then says so).
 */
export async function findOrProvisionAccount(api: RpcStub<AuthenticatedApi>, vendorId: string): Promise<number | null> {
  const lookup = async (): Promise<number | null> => {
    let found: number | null = null
    let markReady!: () => void
    const ready = new Promise<void>((resolve) => { markReady = resolve })
    const subscription = await api.subscribeConnectedAccounts(new AccountsSubscriberAdapter({
      add: (account) => { if (account.vendorId === vendorId && found === null) found = account.id },
      remove: () => {},
      ready: () => markReady(),
    }))
    try {
      await Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, 5000))])
    } finally {
      subscription[Symbol.dispose]()
    }
    return found
  }
  const existing = await lookup()
  if (existing !== null) return existing
  try {
    await api.provisionAmbientAccount(vendorId)
  } catch {
    // Vendor not deployed, not optional, or already provisioned meanwhile: the second lookup
    // settles it either way.
  }
  return lookup()
}

/**
 * Creates the gatekeeper for a Bot's browser profile or sandbox and binds it into the hub gadget
 * under the per-Bot name (replacing any previous one). Returns the new workpiece id.
 */
export async function provisionComputer(
  api: RpcStub<AuthenticatedApi>,
  overseer: RpcStub<Overseer>,
  hubWorkpieceId: number,
  botId: string,
  kind: ComputerKind,
  resourceUrl: string,
): Promise<number> {
  const accountId = await findOrProvisionAccount(api, COMPUTER_VENDORS[kind].vendorId)
  if (accountId === null) throw new Error(`This deployment has no ${COMPUTER_VENDORS[kind].title.toLowerCase()} gatekeeper.`)
  const gk = await overseer.newGatekeeper(accountId, resourceUrl)
  if (!gk) throw new Error(`Couldn’t create the ${COMPUTER_VENDORS[kind].title.toLowerCase()}.`)
  try {
    const id = await gk.getId()
    const client = overseer.getGadget(hubWorkpieceId)
    try {
      const bindingName = computerBindingNameFor(botId, kind)
      const existing = (await client.listBindings()).find((b) => b.name === bindingName)
      if (existing) await client.unbind(bindingName)
      await client.bind(bindingName, id)
    } finally {
      client[Symbol.dispose]()
    }
    return id
  } finally {
    gk[Symbol.dispose]()
  }
}
