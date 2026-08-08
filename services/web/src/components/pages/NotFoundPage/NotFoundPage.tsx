import { Link } from 'react-router-dom'
import { Button } from '../../atoms/Button'
import { EmptyState } from '../../molecules/EmptyState'

/**
 * Page: the catch-all 404. Renders its own `<main>` because it sits OUTSIDE `AppShellRoute` (it is
 * the `*` route, reachable without a session), so it inherits no landmark from the shell — an axe
 * scan of the running app reported both `landmark-one-main` and `region` here.
 */
export function NotFoundPage() {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 pt-10">
      <h1 className="font-display text-2xl font-medium text-text">Page not found</h1>
      <EmptyState
        title="That route doesn't exist."
        icon="🧭"
        action={
          <Link to="/communities">
            <Button>Go to communities</Button>
          </Link>
        }
      />
    </main>
  )
}
