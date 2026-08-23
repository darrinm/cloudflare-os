/**
 * Opening a tab for a URL the server has not given us yet.
 *
 * `window.open` is only allowed while the browser still counts the click as a user action, and that
 * permission is spent by the first `await`. Every OAuth connect and reconnect did:
 *
 *     const result = await api.connectAccount(...)   // permission gone by here
 *     window.open(result.url, '_blank')              // silently blocked
 *
 * so the round trip succeeded, the toast said "finish in the new tab", and there was no new tab --
 * indistinguishable, from the outside, from the integration being broken.
 *
 * Reserving the tab first keeps the permission: open it synchronously in the click, then point it at
 * the URL once it arrives. A blocked popup is reported rather than swallowed, and a failed request
 * closes the tab instead of stranding it on about:blank.
 */
export async function openTabWith(getUrl: () => Promise<string | null | undefined>): Promise<boolean> {
  // No `noopener` here, deliberately: it is defined to return null, and a handle is the entire
  // point -- we have to navigate this tab ourselves once the URL arrives. Passing it opened a tab
  // and handed back null, so this read as "blocked" and left the tab stranded on about:blank.
  // The opener reference is severed below instead, once there is somewhere to go.
  const tab = window.open('', '_blank')
  if (!tab) throw new Error('Your browser blocked the new tab. Allow pop-ups for this site and try again.')
  let url: string | null | undefined
  try {
    url = await getUrl()
  } catch (err) {
    tab.close()
    throw err
  }
  // Some flows only need a tab sometimes -- asking for access already granted returns no URL. Say
  // so with `false` rather than parking the reserved tab on about:blank.
  if (!url) {
    tab.close()
    return false
  }
  // Sever the back-reference before handing the tab to the provider, so the page we send someone to
  // cannot script the tab that opened it. This is what `noopener` would have bought, taken at the
  // point it no longer costs us the handle.
  try { tab.opener = null } catch { /* already detached */ }
  tab.location.href = url
  return true
}
