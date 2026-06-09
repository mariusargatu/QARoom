import { forwardRef } from 'react'

export interface SortOption {
  value: string
  label: string
}

export interface SortTabsProps {
  options: SortOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}

/** Molecule: a segmented control. Buttons carry `aria-pressed`; the group carries an accessible name. */
export const SortTabs = forwardRef<HTMLFieldSetElement, SortTabsProps>(function SortTabs(
  { options, value, onChange, ariaLabel = 'Sort' },
  ref,
) {
  return (
    <fieldset ref={ref} className="inline-flex gap-5">
      <legend className="sr-only">{ariaLabel}</legend>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${active ? 'border-primary text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
})
SortTabs.displayName = 'SortTabs'
