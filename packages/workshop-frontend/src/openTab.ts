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
  const tab = window.open('', '_blank', 'noopener,noreferrer')
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
  tab.location.href = url
  return true
}
