import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useFlagsList } from '../../../hooks/useFlagsList'
import { ErrorState } from '../../molecules/ErrorState'
import { FlagList } from '../../organisms/FlagList'

/** Page: every flag's rollout state + the legal transitions an operator can drive. */
export function FlagsPage() {
  const { communityId = '' } = useParams()
  const { api } = useApi()
  const flags = useFlagsList(api, communityId)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-medium text-text">Feature flags</h1>
      {flags.error ? (
        <ErrorState message={flags.error} onRetry={() => void flags.refresh()} />
      ) : (
        <FlagList
          flags={flags.flags}
          loading={flags.loading}
          error={flags.advanceError}
          pendingKey={flags.pendingKey}
          onAdvance={(flagKey, event) => void flags.advance(flagKey, event)}
        />
      )}
    </div>
  )
}
