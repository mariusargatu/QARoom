import { forwardRef, type HTMLAttributes } from 'react'

/** Atom: a loading placeholder block. Decorative (aria-hidden); the region announces its own status. */
export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Skeleton({ className = '', ...rest }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={`animate-pulse rounded-md bg-elevated motion-reduce:animate-none ${className}`}
        {...rest}
      />
    )
  },
)
Skeleton.displayName = 'Skeleton'
