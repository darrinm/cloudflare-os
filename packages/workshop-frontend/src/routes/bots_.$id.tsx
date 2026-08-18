import { createFileRoute } from '@tanstack/react-router'
import { BotsPageContent } from '../bots/BotsPage'

/**
 * One Bot's conversation and details. The file is `bots_.$id` (trailing underscore) so the URL is
 * /bots/$id without nesting inside the /bots roster component.
 */
export const Route = createFileRoute('/bots_/$id')({
  component: BotPage,
})

function BotPage() {
  const { id } = Route.useParams()
  return <BotsPageContent botId={id} />
}
