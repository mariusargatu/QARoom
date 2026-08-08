import { forwardRef, type ReactNode, useEffect, useId, useRef, useState } from 'react'

export interface MenuDropdownProps {
  /** Accessible name for the trigger button. */
  label: string
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
}

/**
 * Molecule: a click-to-open popover. Dismisses three ways — Escape (returning focus to the trigger),
 * an outside click, and selecting anything inside it.
 *
 * Deliberately a DISCLOSURE, not an ARIA menu. It previously set `role="menu"` +
 * `aria-haspopup="menu"` over children that are ordinary links and buttons, which is an axe
 * `aria-required-children` violation (critical) — found by scanning the running app, and invisible to
 * the story a11y gate because no story rendered the OPEN state. `role="menu"` also carries a keyboard
 * contract this component does not implement (arrow-key roving focus), so claiming it would promise
 * screen-reader users behaviour that isn't there. WAI-ARIA APG says not to use the menu role for a
 * collection of navigation links; the trigger owns the panel via `aria-controls` instead.
 */
export const MenuDropdown = forwardRef<HTMLDivElement, MenuDropdownProps>(function MenuDropdown(
  { label, trigger, children, align = 'right' },
  ref,
) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // Hand focus back, or a keyboard user is stranded at the top of the document with no route
      // back to the control they just dismissed.
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The outside-click listener needs the root node, and the tier convention forwards a ref for it
  // too; one callback keeps both pointing at the same element.
  const setRoot = (node: HTMLDivElement | null) => {
    root.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  return (
    <div ref={setRoot} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text transition hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        {trigger}
      </button>
      {/*
        Selecting anything inside dismisses. Client-side navigation does NOT unmount the masthead, so
        without this the popover survived the route change and hung over the next page — the
        behaviour this component's own comments claimed but never implemented.
        `role="presentation"` states what the panel is: a styling container whose children carry all
        the semantics. Unlike `role="menu"` it imposes no required children, so it cannot reintroduce
        the aria-required-children violation this change removed.
      */}
      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: bubble-phase dismiss, not a widget — keyboard users get Escape and item activation (same handler).
        <div
          role="presentation"
          id={panelId}
          onClick={() => setOpen(false)}
          className={`absolute z-20 mt-1 min-w-44 rounded-md border border-border bg-elevated p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
})
MenuDropdown.displayName = 'MenuDropdown'
