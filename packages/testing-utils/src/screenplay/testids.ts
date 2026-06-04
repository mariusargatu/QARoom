/**
 * The `data-testid` contract shared by Screenplay Tasks/Questions and the web components they
 * drive. Keeping the ids in one place is what lets a Task authored once run as both an E2E
 * test and a component test (ADR-0005): the web atoms/organisms render these ids, and the
 * Tasks below locate by them — neither hard-codes a selector the other doesn't know about.
 */
export const TESTID = {
  /** Element showing the current rollout state name. */
  rolloutState: 'rollout-state',
  /** The advance button for a given rollout event, e.g. `rollout-advance-EnableRequested`. */
  rolloutAdvance: (event: string) => `rollout-advance-${event}`,
  donationAmount: 'donation-amount',
  donationSubmit: 'donation-submit',
  donationList: 'donation-list',
  notificationFeed: 'notification-feed',
} as const
