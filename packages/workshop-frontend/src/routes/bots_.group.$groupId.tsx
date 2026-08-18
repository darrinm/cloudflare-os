import { createFileRoute } from '@tanstack/react-router'
import { BotsPageContent } from '../bots/BotsPage'

/**
 * One group's shared transcript. `bots_.group.$groupId` (trailing underscore after bots) so the
 * URL is /bots/group/$groupId without nesting inside the /bots roster component.
 */
export const Route = createFileRoute('/bots_/group/$groupId')({
  component: GroupPage,
})

function GroupPage() {
  const { groupId } = Route.useParams()
  return <BotsPageContent botId={null} groupId={groupId} />
}
