import { Link } from 'react-router-dom'
import { Button } from '../../atoms/Button'
import { EmptyState } from '../../molecules/EmptyState'

/** Page: the catch-all 404. */
export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 pt-10">
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
    </div>
  )
}
