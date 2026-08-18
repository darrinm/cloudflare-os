import { createFileRoute } from '@tanstack/react-router'
import { BotsPageContent } from '../bots/BotsPage'

/**
 * Bots: persistent AI teammates. The roster, each Bot's conversation and its details live in the
 * user's Bots hub workspace (created from the bundled "Bots" blueprint); this route is the
 * messaging-shaped shell over it. /bots shows the roster; /bots/$id opens one Bot.
 */
export const Route = createFileRoute('/bots')({
  component: BotsPage,
})

function BotsPage() {
  return <BotsPageContent botId={null} />
}
