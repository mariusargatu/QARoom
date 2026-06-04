import type { Meta, StoryObj } from '@storybook/react-vite'
import { CaptureForReplay } from './CaptureForReplay'

// Every atom/molecule/organism has a story (ADR-0005, exit criterion 4). CaptureForReplay is the
// dev-only replay-capture affordance; rendered idle it performs no network call, so the headless
// addon-vitest run (render + addon-a11y) is deterministic. The capture fetch is exercised by E2E,
// not here.
const meta = {
  title: 'molecules/CaptureForReplay',
  component: CaptureForReplay,
} satisfies Meta<typeof CaptureForReplay>

export default meta
type Story = StoryObj<typeof meta>

/** Idle — the ghost button before any capture (no fetch on render). */
export const Idle: Story = {}
