import { rolloutEnabled } from '@qaroom/contracts'
import type { ApiClient } from '../../../api/client'
import { useDonations } from '../../../hooks/useDonations'
import { useRollout } from '../../../hooks/useRollout'
import { useWsWithPollingFallback } from '../../../hooks/useWsWithPollingFallback'
import { useTheme } from '../../../theme/ThemeProvider'
import { Button } from '../../atoms/Button'
import { DonationForm } from '../../organisms/DonationForm'
import { DonationList } from '../../organisms/DonationList'
import { NotificationFeed } from '../../organisms/NotificationFeed'
import { RolloutPanel } from '../../organisms/RolloutPanel'
import { DashboardTemplate } from '../../templates/DashboardTemplate'

export interface CommunityDashboardPageProps {
  api: ApiClient
  communityId: string
  donorId: string
}

/**
 * Page: the composition root. Wires the rollout/donations/feed hooks into the dashboard
 * template's organism slots. The donation form is gated on the SAME `rolloutEnabled` projection
 * the server gates on, so the UI and the server agree on when donations are allowed.
 */
export function CommunityDashboardPage({ api, communityId, donorId }: CommunityDashboardPageProps) {
  const rollout = useRollout(api, communityId)
  const donations = useDonations(api, communityId)
  const feed = useWsWithPollingFallback(api, communityId)
  const { theme, toggle } = useTheme()

  return (
    <DashboardTemplate
      header={
        <>
          <span className="text-lg font-semibold text-text">QARoom — donations rollout</span>
          <Button variant="ghost" onClick={toggle}>
            {theme === 'dark' ? 'Light' : 'Dark'} mode
          </Button>
        </>
      }
      rollout={
        <RolloutPanel
          state={rollout.state}
          legalEvents={rollout.legalEvents}
          loading={rollout.loading}
          pending={rollout.pending}
          onAdvance={(event) => void rollout.advance(event)}
        />
      }
      donation={
        <DonationForm
          enabled={rolloutEnabled(rollout.state)}
          pending={donations.pending}
          onDonate={(amountCents) =>
            void donations.donate({ donor_id: donorId, amount_cents: amountCents, currency: 'USD' })
          }
        />
      }
      donations={<DonationList donations={donations.donations} />}
      activity={<NotificationFeed events={feed.events} live={feed.live} />}
    />
  )
}
