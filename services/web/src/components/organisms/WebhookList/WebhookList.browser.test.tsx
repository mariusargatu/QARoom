/// <reference types="@vitest/browser/matchers" />
import {
  EXAMPLE_WEBHOOK_SUBSCRIPTION,
  WebhookSubscription,
  WebhookSubscriptionStatus,
} from '@qaroom/contracts'
import fc from 'fast-check'
import { expect, test, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { WebhookList } from './WebhookList'

// Organism component test (ADR-0027, composition-delta model): the Badge/Button/Skeleton atoms
// WebhookList composes are already proven, so these cover only what the LIST adds — the status-gated
// action set (Active→Pause / Paused→Resume), the id wiring of each action, the busy lockout, and the
// loading/empty switch.

const active = WebhookSubscription.parse(EXAMPLE_WEBHOOK_SUBSCRIPTION)
const paused = WebhookSubscription.parse({ ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status: 'Paused' })

function handlers() {
  return {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onDelete: vi.fn(),
    onViewDeliveries: vi.fn(),
  }
}

test('an active subscription offers Pause and not Resume', async () => {
  const screen = await render(<WebhookList webhooks={[active]} {...handlers()} />)

  await expect.element(screen.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
})

test('a paused subscription offers Resume and not Pause', async () => {
  const screen = await render(<WebhookList webhooks={[paused]} {...handlers()} />)

  await expect.element(screen.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
})

test('the lifecycle actions call their handlers with the subscription id', async () => {
  const h = handlers()
  const screen = await render(<WebhookList webhooks={[active]} {...h} />)

  await screen.getByRole('button', { name: 'Pause' }).click()
  await screen.getByRole('button', { name: 'Deliveries' }).click()
  await screen.getByRole('button', { name: 'Delete' }).click()

  expect(h.onPause).toHaveBeenCalledWith(active.id)
  expect(h.onViewDeliveries).toHaveBeenCalledWith(active.id)
  expect(h.onDelete).toHaveBeenCalledWith(active.id)
})

test('resuming a paused subscription calls onResume with its id', async () => {
  const h = handlers()
  const screen = await render(<WebhookList webhooks={[paused]} {...h} />)

  await screen.getByRole('button', { name: 'Resume' }).click()

  expect(h.onResume).toHaveBeenCalledWith(paused.id)
})

test('a busy subscription disables its action buttons', async () => {
  const screen = await render(
    <WebhookList webhooks={[active]} busyId={active.id} {...handlers()} />,
  )

  await expect.element(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Deliveries' })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
})

test('the empty state shows when there are no subscriptions', async () => {
  const screen = await render(<WebhookList webhooks={[]} {...handlers()} />)

  await expect.element(screen.getByText('No webhooks yet')).toBeVisible()
})

test('loading withholds the subscription rows', async () => {
  const screen = await render(<WebhookList webhooks={[active]} loading {...handlers()} />)

  expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(screen.container.textContent).not.toContain(active.url)
})

// Property: the pause/resume control offered is gated on status — Active⇒Pause, Paused⇒Resume,
// Disabled⇒neither (the terminal auto-quarantine offers no toggle) — while Deliveries and Delete are
// offered for EVERY status. This drives the otherwise-uncovered `: null` tail of the status ternary
// (a Disabled subscription) alongside the two arms the example tests already cover. The whole status
// enum is the input space; `constantFrom` over it exhausts the three nodes deterministically.
function buttonLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
}

test('the pause/resume control is status-gated while Deliveries and Delete are always offered', () => {
  return fc.assert(
    fc.asyncProperty(fc.constantFrom(...WebhookSubscriptionStatus.options), async (status) => {
      const webhook = WebhookSubscription.parse({ ...EXAMPLE_WEBHOOK_SUBSCRIPTION, status })
      const screen = await render(<WebhookList webhooks={[webhook]} {...handlers()} />)
      const labels = buttonLabels(screen.container)

      expect(labels.includes('Pause')).toBe(status === 'Active')
      expect(labels.includes('Resume')).toBe(status === 'Paused')
      expect(labels.includes('Deliveries')).toBe(true)
      expect(labels.includes('Delete')).toBe(true)

      await cleanup()
    }),
    { numRuns: 12, examples: [['Active'], ['Paused'], ['Disabled']] },
  )
})
