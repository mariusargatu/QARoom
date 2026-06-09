import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useModeration } from '../../../hooks/useModeration'
import { ErrorState } from '../../molecules/ErrorState'
import { ModerationDecisionList } from '../../organisms/ModerationDecisionList'

/** Page: the grounded moderation decisions the agent has recorded for this community. */
export function ModerationPage() {
  const { communityId = '' } = useParams()
  const { api } = useApi()
  const moderation = useModeration(api, communityId)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-medium text-text">Moderation</h1>
      {moderation.error ? (
        <ErrorState message={moderation.error} onRetry={() => void moderation.refresh()} />
      ) : (
        <ModerationDecisionList decisions={moderation.decisions} loading={moderation.loading} />
      )}
    </div>
  )
}
