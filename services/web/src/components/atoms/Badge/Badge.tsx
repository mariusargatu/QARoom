import { forwardRef, type HTMLAttributes } from 'react'

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

// Tints kept faint so the coloured text carries the meaning. `primary` uses a lighter tint than the
// rest: the bright primary text is the closest tone to its tint, so a fainter background is what
// keeps it clear of WCAG AA (4.5:1) even on an elevated/surface-backed card (M14 a11y gate).
const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-elevated text-muted',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
}

/** Atom: a small status pill. Used to render the current rollout state and donation status. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', className = '', ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`}
      {...rest}
    />
  )
})
Badge.displayName = 'Badge'
