import { forwardRef, type InputHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

/** Atom: a text input styled exclusively through semantic tokens. forwardRef + displayName. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`w-full rounded-md border bg-elevated px-3 py-2 text-sm text-text placeholder:text-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${invalid ? 'border-danger' : 'border-border'} ${className}`}
      {...rest}
    />
  )
})
Input.displayName = 'Input'
