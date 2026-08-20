import { Button } from '@cloudflare/kumo'
import type { Bot } from './types'

/**
 * The one thing a new person has not seen yet: a Bot hitting a sign-in and handing the page to
 * them. The card does not explain the loop; it starts it, through the real path -- the Bot asks
 * which site, opens it, requests the takeover, and the usual card and Browser app do the rest.
 */

/** Scout by preference (it is the example Bot with a browser), else whoever is first. */
export const pickTakeoverBot = (bots: Bot[]): Bot | null => bots.find((b) => b.name === 'Scout') ?? bots[0] ?? null

export const TRY_TAKEOVER_TASK =
  "Let's try a takeover. Ask me, in one line, which site you should sign in to for me, then wait for my answer. " +
  "When I answer: open the site, get to its sign-in page, and call requestTakeover with a one-line reason so I can sign in myself. " +
  "Never type credentials. After I hand the browser back, take a snapshot and tell me in one line what you can see."

export function TryTakeoverCard({ bot, onTry, onDismiss }: { bot: Bot; onTry: () => void; onDismiss: () => void }) {
  return (
    <div className="m-3 flex flex-col gap-2 rounded-lg border border-kumo-line bg-kumo-tint/40 px-3 py-2.5" role="note" aria-label="Try a takeover">
      <div className="text-[14px] md:text-[13px] font-medium text-kumo-default">Try a takeover</div>
      <div className="text-[14px] md:text-[13px] leading-snug text-kumo-subtle">
        {bot.name} will open a site you sign in to and ask for the page. Take control, sign in, hand it back — it keeps the session.
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onTry}>Try it</Button>
        <Button size="sm" variant="secondary" onClick={onDismiss}>Not now</Button>
      </div>
    </div>
  )
}

export default TryTakeoverCard
