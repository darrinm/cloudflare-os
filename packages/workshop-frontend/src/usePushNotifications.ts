import { useCallback, useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'

export type PushState =
  | { status: 'unsupported' }          // no service worker / Push API in this browser
  | { status: 'unavailable' }          // deployment has no VAPID keys
  | { status: 'denied' }               // the user blocked notifications
  | { status: 'off'; publicKey: string }
  | { status: 'on'; publicKey: string; endpoint: string }
  | { status: 'loading' }

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Registers /sw.js once per page load. Safe to call before the user is authenticated. */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal; push just stays off */ })
}

/**
 * Web Push opt-in for the current browser: reads the deployment's VAPID key, mirrors the current
 * subscription, and subscribes/unsubscribes on request (registering the subscription with the
 * user's account so Bots can reach this device).
 */
export function usePushNotifications(authenticatedApi: RpcStub<AuthenticatedApi>) {
  const [state, setState] = useState<PushState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState({ status: 'unsupported' }); return
    }
    const config = await authenticatedApi.getPushConfig().catch(() => null)
    if (!config) { setState({ status: 'unavailable' }); return }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') { setState({ status: 'denied' }); return }
    const registration = await navigator.serviceWorker.getRegistration()
    const existing = await registration?.pushManager.getSubscription()
    if (existing) setState({ status: 'on', publicKey: config.publicKey, endpoint: existing.endpoint })
    else setState({ status: 'off', publicKey: config.publicKey })
  }, [authenticatedApi])

  useEffect(() => { refresh().catch(() => setState({ status: 'unsupported' })) }, [refresh])

  const enable = useCallback(async () => {
    if (state.status !== 'off') return
    const registration = await navigator.serviceWorker.ready
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') { setState({ status: 'denied' }); return }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.publicKey),
    })
    await authenticatedApi.subscribePush(subscription.toJSON(), navigator.userAgent)
    setState({ status: 'on', publicKey: state.publicKey, endpoint: subscription.endpoint })
  }, [state, authenticatedApi])

  const disable = useCallback(async () => {
    if (state.status !== 'on') return
    const registration = await navigator.serviceWorker.getRegistration()
    const existing = await registration?.pushManager.getSubscription()
    await existing?.unsubscribe()
    await authenticatedApi.unsubscribePush(state.endpoint).catch(() => {})
    setState({ status: 'off', publicKey: state.publicKey })
  }, [state, authenticatedApi])

  return { state, enable, disable, refresh }
}
