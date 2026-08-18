// Service worker: makes the app installable and shows Web Push notifications (Bots finishing
// turns, actions awaiting approval). Deliberately no fetch caching -- the app updates on every
// deploy and a stale shell would be worse than no offline mode.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = { title: 'Update', body: '', url: '/', tag: undefined }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    if (event.data) payload.body = event.data.text()
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: !!payload.tag,
      icon: '/api/site-logo',
      badge: '/favicon.svg',
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) { try { await client.navigate(target) } catch { /* ignore */ } }
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
