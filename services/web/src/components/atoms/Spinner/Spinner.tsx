import { forwardRef, type HTMLAttributes } from 'react'

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  label?: string
}

/** Atom: an accessible loading indicator (semantic-token border, `role=status`). */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { label = 'Loading', className = '', ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      role="status"
      aria-label={label}
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary ${className}`}
      {...rest}
    />
  )
})
Spinner.displayName = 'Spinner'
