import { forwardRef, type HTMLAttributes } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lift on hover — for cards that are themselves links/buttons. */
  interactive?: boolean
}

/** Atom: a surface container. The single source of the panel look used across every screen. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, className = '', ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`rounded-lg border border-border bg-surface ${interactive ? 'transition hover:border-primary motion-reduce:transition-none' : ''} ${className}`}
      {...rest}
    />
  )
})
Card.displayName = 'Card'
