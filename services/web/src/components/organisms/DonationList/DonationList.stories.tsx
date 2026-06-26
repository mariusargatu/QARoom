import { EXAMPLE_DONATION } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { DonationList } from './DonationList'

// CSF Factory format (ADR-0027 §4). Organism tier — the empty vs populated donation ledger; the
// Badge atom (status tone) inside is already proven, so these stories test only the list's own
// composition (donation rows with their captured/failed status badges).
const meta = preview.meta({
  title: 'organisms/DonationList',
  component: DonationList,
})

export const Empty = meta.story({ args: { donations: [] } })
export const WithDonations = meta.story({
  args: {
    donations: [
      { ...EXAMPLE_DONATION, status: 'Captured' },
      { ...EXAMPLE_DONATION, id: 'dntn_01HZY0K7M3QF8VN2J5RX9TB4CN', status: 'Failed' },
    ],
  },
})
