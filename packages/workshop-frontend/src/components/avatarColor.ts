/**
 * The one "stable colour for an id" scheme, shared by every avatar in the app.
 *
 * It lived inside PersonAvatar; Bots grew a second palette and a second hash beside it, which meant
 * two schemes to keep in step and a palette change to make twice. One home instead.
 */

const AVATAR_COLORS = [
  'hsl(12 68% 47%)',
  'hsl(26 72% 40%)',
  'hsl(38 68% 36%)',
  'hsl(48 55% 34%)',
  'hsl(352 56% 50%)',
  'hsl(336 46% 50%)',
  'hsl(318 38% 50%)',
  'hsl(4 60% 50%)',
  'hsl(212 55% 48%)',
  'hsl(194 52% 38%)',
]

/** FNV-1a over the id, so the same id always lands on the same colour. */
export function colorFromId(id: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length]
}
