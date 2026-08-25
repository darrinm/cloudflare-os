/**
 * Event kinds as a person would say them. The stored kind is a code identifier (`needsUser`), and
 * rendering it raw put shouted camelCase in the one log a worried owner reads on their phone. The
 * raw kind still travels in exports, where a machine may be the reader.
 *
 * Shared by every surface that shows a kind as a noun (Audit's rows and filter, BotDetails'
 * Activity list). Feed.tsx deliberately does NOT use this: it writes whole sentences that vary
 * with the event's data, not just its kind.
 */
export const KIND_LABELS: Record<string, string> = {
  message: 'Message', delivered: 'Delivered', completed: 'Finished', failed: 'Failed',
  needsUser: 'Needs you', decision: 'Decision', capped: 'Spending limit', away: 'Held while away',
  memory: 'Remembered', forget: 'Forgot', routine: 'Routine', group: 'Group', groupPost: 'Group post',
  skill: 'Skill', agent: 'Agent', created: 'Created', updated: 'Updated', deleted: 'Deleted',
}

export function kindLabel(t: string): string { return KIND_LABELS[t] ?? t }

/**
 * Invisible hit-area expansion for controls whose visual size sits under the ~44px touch floor.
 * The look stays; only the tappable box grows. WorkshopIconButton carries this by default — reach
 * for the constant on raw buttons and small kumo Buttons.
 */
export const TAP_TARGET = "relative after:absolute after:-inset-2 after:content-['']"
