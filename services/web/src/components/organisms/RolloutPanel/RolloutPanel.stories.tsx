import preview from '../../../../.storybook/preview'
import { RolloutPanel } from './RolloutPanel'

// CSF Factory format (ADR-0027 §4). Organism tier — the states a user moves the rollout through; the
// Button atom and RolloutStepper molecule inside are already proven, so these stories test only the
// organism's own composition. `OffState` is reused as a portable story by RolloutPanel.browser.test.tsx.
const meta = preview.meta({
  title: 'organisms/RolloutPanel',
  component: RolloutPanel,
  args: { onAdvance: () => {} },
})

export const OffState = meta.story({ args: { state: 'Off', legalEvents: ['EnableRequested'] } })
export const Canary = meta.story({
  args: { state: 'Canary', legalEvents: ['RolloutCompleted', 'RolloutAborted'] },
})
export const Enabled = meta.story({ args: { state: 'Enabled', legalEvents: ['DisableRequested'] } })
export const Loading = meta.story({ args: { state: 'Off', legalEvents: [], loading: true } })
