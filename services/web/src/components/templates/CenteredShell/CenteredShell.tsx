import { forwardRef, type ReactNode } from 'react'

export interface CenteredShellProps {
  children: ReactNode
}

/** Template: a full-viewport centered frame — used by the login / identity-picker screen. */
export const CenteredShell = forwardRef<HTMLDivElement, CenteredShellProps>(function CenteredShell(
  { children },
  ref,
) {
  return (
    <div ref={ref} className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      {children}
    </div>
  )
})
CenteredShell.displayName = 'CenteredShell'
