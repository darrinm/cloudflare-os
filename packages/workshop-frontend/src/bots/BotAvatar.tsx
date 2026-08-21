import { blobatarUri } from 'blobatar/uri'
import { colorFromId } from '../components/avatarColor'
import type { Bot } from './types'

/**
 * A Bot's face, and the palette behind a chosen emoji.
 *
 * Its own module rather than a corner of BotsPage: the roster, the feed, the audit, group views and
 * the takeover card all draw one, and importing them back out of BotsPage made every one of those
 * files a cycle -- and dragged the whole page (and ChatInterface behind it) into any test that
 * wanted one small component.
 */

/**
 * All a face needs. `avatar` and `color` are optional so a group member -- which carries only an id
 * and a name -- can be passed straight in: a member the roster has not resolved (deleted, or still
 * loading) still gets a face rather than rendering nothing.
 */
export type BotFace = Pick<Bot, 'id'> & Partial<Pick<Bot, 'avatar' | 'color'>>

export function botColor(bot: BotFace): string {
  return bot.color ?? colorFromId(bot.id)
}

/**
 * Drawing a face costs real work -- fitting a palette runs an iterative contrast solver, ~40µs a
 * time -- and blobatar's own memo lives inside a component instance, so it saves nothing across a
 * list: 500 audit rows for five Bots drew five faces five hundred times, synchronously, on every
 * keystroke in the audit search. Cached by what actually varies, the same list draws five.
 *
 * Bounded by the Bots that exist times the handful of sizes in use.
 */
const uris = new Map<string, string>()
function uriFor(id: string, hue: number | null, size: number): string {
  const key = `${id}|${hue}|${size}`
  let uri = uris.get(key)
  if (uri === undefined) {
    uri = blobatarUri(id, hue === null ? { size } : { size, hue })
    uris.set(key, uri)
  }
  return uri
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
  // A colour someone chose is theirs whether or not they also picked an emoji. Blobatar takes a hue
  // and derives its own palette from it, so the choice is handed over as a hue rather than
  // overriding the fill; without this, setting only `color` silently did nothing.
  const hue = hueOf(bot.color)
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
    <img
      src={uriFor(bot.id, hue, size)}
      width={size}
      height={size}
      className="inline-block flex-none rounded-full"
      alt=""
      aria-hidden
    />
  )
}

/**
 * A row of faces for a group's members, with the leftovers as a count.
 *
 * One home for the rule the roster row and the group header both need: prefer the roster's Bot (it
 * carries a chosen emoji or colour), fall back to the member record so a member the roster cannot
 * resolve -- deleted, or not loaded yet -- still gets a face and the overflow count stays honest.
 * The names ride along for anyone not looking at the faces.
 */
export function Facepile({ members, botsById, max, size }: {
  members: Array<{ id: string; name: string }>
  botsById: Map<string, BotFace>
  max: number
  size: number
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="sr-only">{members.map((m) => m.name).join(', ')}</span>
      {members.slice(0, max).map((m) => (
        <BotAvatar key={m.id} bot={botsById.get(m.id) ?? m} size={size} />
      ))}
      {members.length > max && (
        <span className="text-[12px] md:text-[11px] text-kumo-subtle">+{members.length - max}</span>
      )}
    </span>
  )
}

export default BotAvatar
