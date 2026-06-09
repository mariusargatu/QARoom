import { forwardRef, type SelectHTMLAttributes } from 'react'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

/** Atom: a native select styled through semantic tokens. Options are passed as children. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className = '', children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`w-full rounded-md border bg-elevated px-3 py-2 text-sm text-text transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${invalid ? 'border-danger' : 'border-border'} ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
})
Select.displayName = 'Select'
