import { forwardRef, type ReactNode } from 'react'

export interface AppShellProps {
  masthead: ReactNode
  children: ReactNode
}

/**
 * Template: the authenticated app frame (DESIGN.md "Warm Commons"). A slim top masthead over a
 * single centered reading column — no left sidebar (explicitly rejected). Pure layout with named
 * slots; holds no data. The masthead's own dropdowns carry navigation on every viewport.
 */
export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(function AppShell(
  { masthead, children },
  ref,
) {
  return (
    <div ref={ref} className="min-h-screen bg-bg text-text">
      {masthead}
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  )
})
AppShell.displayName = 'AppShell'
