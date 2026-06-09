import { type ButtonHTMLAttributes, forwardRef } from 'react'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name — an icon-only control must announce its purpose. */
  label: string
}

/** Atom: a square, icon-only button. `label` becomes the aria-label (a11y gate enforced). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className = '', type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-transparent text-text transition hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})
IconButton.displayName = 'IconButton'
