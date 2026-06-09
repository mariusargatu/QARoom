import { forwardRef } from 'react'
import { Button } from '../../atoms/Button'
import { Card } from '../../atoms/Card'

export interface ErrorStateProps {
  message: string
  title?: string
  retryable?: boolean
  onRetry?: () => void
}

/** Molecule: a recoverable error panel. Mirrors the RFC 7807 `retryable` hint from the gateway. */
export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(function ErrorState(
  { message, title = 'Something went wrong', retryable = true, onRetry },
  ref,
) {
  return (
    <Card ref={ref} className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p role="alert" className="text-base font-semibold text-danger">
        {title}
      </p>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {retryable && onRetry ? (
        <Button variant="ghost" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </Card>
  )
})
ErrorState.displayName = 'ErrorState'
