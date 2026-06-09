import { forwardRef, type TextareaHTMLAttributes } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

/** Atom: a multi-line text input styled through semantic tokens. forwardRef + displayName. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className = '', rows = 6, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={`w-full resize-y rounded-md border bg-elevated px-3 py-2 text-sm text-text placeholder:text-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${invalid ? 'border-danger' : 'border-border'} ${className}`}
      {...rest}
    />
  )
})
Textarea.displayName = 'Textarea'
