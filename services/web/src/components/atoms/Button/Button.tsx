import { type ButtonHTMLAttributes, forwardRef } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  ghost: 'bg-transparent text-text border border-border hover:bg-elevated',
  danger: 'bg-danger-solid text-white hover:opacity-90',
}

/** Atom: a button styled exclusively through semantic tokens. forwardRef + displayName (ADR-0005). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  )
})
Button.displayName = 'Button'
