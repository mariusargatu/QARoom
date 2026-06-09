import { forwardRef, type ReactNode } from 'react'

export interface FormFieldProps {
  label: string
  children: ReactNode
  hint?: string
  error?: string
  required?: boolean
}

/**
 * Molecule: a labelled form control. Wraps the control in a `<label>` (implicit association — the
 * control gets its accessible name for free), with optional hint + `role="alert"` error text.
 */
export const FormField = forwardRef<HTMLLabelElement, FormFieldProps>(function FormField(
  { label, children, hint, error, required = false },
  ref,
) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the `children` (Input/Select/Textarea) — a real wrapped control biome can't see statically.
    <label ref={ref} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </label>
  )
})
FormField.displayName = 'FormField'
