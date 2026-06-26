import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import preview from '../../../../.storybook/preview'
import { NotificationFeed } from './NotificationFeed'

// CSF Factory format (ADR-0027 §4). Organism tier — the empty/live/polling states of the activity
// feed; the Badge atom inside is already proven, so these stories test only the feed's own
// composition (one row per event + the live-vs-polling connection indicator).
const meta = preview.meta({
  title: 'organisms/NotificationFeed',
  component: NotificationFeed,
})

export const Empty = meta.story({ args: { events: [] } })
export const Live = meta.story({
  args: {
    live: true,
    events: [
      {
        type: 'flag.state.changed',
        seq: 1,
        community_id: EXAMPLE_COMMUNITY_ID,
        occurred_at: '2026-06-04T00:00:00.000Z',
        flag_key: 'donations',
        state: 'Enabled',
        enabled: true,
      },
    ],
  },
})
export const Polling = meta.story({ args: { ...Live.input.args, live: false } })
