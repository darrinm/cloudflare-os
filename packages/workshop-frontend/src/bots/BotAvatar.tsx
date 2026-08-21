import { Blobatar } from '@blobatar/react'
import type { Bot } from './types'

/**
 * A Bot's face, and the palette behind a chosen emoji.
 *
 * Its own module rather than a corner of BotsPage: the roster, the feed, the audit, group views and
 * the takeover card all draw one, and importing them back out of BotsPage made every one of those
 * files a cycle -- and dragged the whole page (and ChatInterface behind it) into any test that
 * wanted one small component.
 */

const AVATAR_COLORS = ['#5b4bc4', '#1f7a5c', '#b23a48', '#9a6300', '#2f6fb0', '#7a3fa0', '#0f766e']

/**
 * All a face needs. `avatar` and `color` are optional so a group member -- which carries only an id
 * and a name -- can be passed straight in: a member the roster has not resolved (deleted, or still
 * loading) still gets a face rather than rendering nothing.
 */
export type BotFace = Pick<Bot, 'id'> & Partial<Pick<Bot, 'avatar' | 'color'>>

export function botColor(bot: BotFace): string {
  if (bot.color) return bot.color
  let h = 0
  for (const c of bot.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/**
 * A chosen `#rrggbb` as a hue in degrees, or null if it is not one. Blobatar takes a hue rather than
 * a colour -- it derives a whole palette and guarantees its own contrast -- so honouring someone's
 * choice means handing over the hue and letting it pick the rest, not overriding the fill.
 */
export function hueOf(color: string | undefined): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color?.trim() ?? '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round(h * 60 + 360) % 360
}

/**
 * Decorative in every place it appears -- the name is always beside it -- so it is hidden from
 * assistive tech rather than described twice.
 *
 * A person's own choice wins. Otherwise a blobatar: a small geometric creature derived from the
 * Bot's id, so a roster of teammates is scannable by face rather than by reading names, without
 * anyone having to pick anything. Seeded on the id, not the name, so renaming a Bot does not hand
 * it a new face; drawn in the browser, so there is no image to fetch or store per Bot.
 */
export function BotAvatar({ bot, size = 32 }: { bot: BotFace; size?: number }) {
  if (bot.avatar) {
    return (
      <span
        className="inline-grid flex-none place-items-center rounded-full font-semibold text-white"
        style={{ width: size, height: size, background: botColor(bot), fontSize: Math.round(size * 0.4) }}
        aria-hidden
      >
        {bot.avatar}
      </span>
    )
  }
  return (
    <Blobatar
      name={bot.id}
      size={size}
      // A colour someone chose is theirs whether or not they also picked an emoji; without this,
      // setting only `color` silently did nothing.
      {...(hueOf(bot.color) !== null ? { hue: hueOf(bot.color)! } : {})}
      className="inline-block flex-none rounded-full"
      style={{ width: size, height: size }}
      alt=""
      aria-hidden
    />
  )
}

export default BotAvatar
