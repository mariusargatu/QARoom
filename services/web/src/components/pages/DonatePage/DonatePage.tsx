import { rolloutEnabled } from '@qaroom/contracts'
import { useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { useDonations } from '../../../hooks/useDonations'
import { useRollout } from '../../../hooks/useRollout'
import { useSession } from '../../../session/SessionProvider'
import { DonationForm } from '../../organisms/DonationForm'
import { DonationList } from '../../organisms/DonationList'

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
      {!enabled ? (
        <p className="text-sm text-muted">
          Donations are not enabled for this community yet (rollout state: {rollout.state}). An
          owner can enable them on the Flags tab.
        </p>
      ) : null}
      <DonationForm
        enabled={enabled}
        pending={donations.pending}
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
      <DonationList donations={donations.donations} />
    </div>
  )
}
