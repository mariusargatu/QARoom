import { rolloutEnabled } from '@qaroom/contracts'
import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useDonations } from '../../../hooks/useDonations'
import { useRollout } from '../../../hooks/useRollout'
import { useSession } from '../../../session/SessionProvider'
import { ErrorState } from '../../molecules/ErrorState'
import { DonationForm } from '../../organisms/DonationForm'
import { DonationList } from '../../organisms/DonationList'
import { RolloutPanel } from '../../organisms/RolloutPanel'

/** Page: donate to a community (gated on the donations rollout) + the donation history. */
export function DonatePage() {
  const { communityId = '' } = useParams()
  const { api } = useApi()
  const { currentUser } = useSession()
  const rollout = useRollout(api, communityId)
  const donations = useDonations(api, communityId)
  const enabled = rolloutEnabled(rollout.state)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-2xl font-medium text-text">Donations</h1>
      {/*
        The rollout READ has to be branched on before `rollout.state` is quoted at the user.
        `state` is 'Off' until a resolve succeeds, so on a flags-service outage the old copy told
        people "Donations are not enabled for this community yet" — an infrastructure failure
        rendered as a fact about their community's configuration.
      */}
      {rollout.error ? (
        <ErrorState message={`Could not read the donations rollout: ${rollout.error}`} />
      ) : (
        // The rollout control lives HERE, on the page it governs. It was previously a component with
        // no mount point anywhere in the app — which also left `useRollout`'s `advance`,
        // `legalEvents` and `pending` unreachable, and the page could only point at another tab.
        <RolloutPanel
          state={rollout.state}
          legalEvents={rollout.legalEvents}
          loading={rollout.loading}
          pending={rollout.pending}
          onAdvance={(event) => void rollout.advance(event)}
        />
      )}
      <DonationForm
        enabled={enabled}
        pending={donations.pending}
        // The SUBMIT error only. A failed list read used to appear here too, telling the user their
        // donation had failed when they had not made one.
        error={donations.error}
        onDonate={(amountCents) =>
          currentUser
            ? void donations.donate({
                donor_id: currentUser.id,
                amount_cents: amountCents,
                currency: 'USD',
              })
            : undefined
        }
      />
      {donations.listError ? (
        <ErrorState message={`Could not load the donation history: ${donations.listError}`} />
      ) : (
        <DonationList donations={donations.donations} loading={donations.loading} />
      )}
    </div>
  )
}
