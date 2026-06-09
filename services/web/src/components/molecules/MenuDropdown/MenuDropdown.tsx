import { type ReactNode, useEffect, useRef, useState } from 'react'

export interface MenuDropdownProps {
  /** Accessible name for the trigger button. */
  label: string
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
}

/**
 * Molecule: a click-to-open popover menu. Closes on outside-click and Escape. The menu content is
 * passed as children; clicking anywhere inside closes it (so menu items just wire their onClick).
 */
export function MenuDropdown({ label, trigger, children, align = 'right' }: MenuDropdownProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text transition hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        {trigger}
      </button>
      {open ? (
        // Closes on outside-click + Escape (both keyboard-accessible); items close it by navigating.
        <div
          role="menu"
          className={`absolute z-20 mt-1 min-w-44 rounded-md border border-border bg-elevated p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
MenuDropdown.displayName = 'MenuDropdown'
