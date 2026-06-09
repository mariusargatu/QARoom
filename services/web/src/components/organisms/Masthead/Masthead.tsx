import { forwardRef } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Avatar } from '../../atoms/Avatar'
import { Button } from '../../atoms/Button'
import { MenuDropdown } from '../../molecules/MenuDropdown'

export interface MastheadCommunity {
  id: string
  slug: string
  name: string
}
export interface MastheadUser {
  id: string
  handle: string
  display_name: string
}
export interface MastheadProps {
  currentUser: MastheadUser | null
  communities: MastheadCommunity[]
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onSignOut: () => void
}

const menuItem =
  'block rounded-md px-3 py-2 text-sm text-text transition hover:bg-elevated motion-reduce:transition-none'

/**
 * Organism: the global masthead (DESIGN.md). Replaces the rejected left sidebar — a slim top bar
 * with the Fraunces wordmark, a community switcher, and the account menu. The dropdowns work on
 * every viewport, so navigation is never lost on mobile (no separate drawer needed).
 */
export const Masthead = forwardRef<HTMLElement, MastheadProps>(function Masthead(
  { currentUser, communities, theme, onToggleTheme, onSignOut },
  ref,
) {
  return (
    <header ref={ref} className="sticky top-0 z-30 border-b border-border bg-bg">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
        <Link
          to="/communities"
          className="font-display text-2xl font-medium tracking-tight text-text"
        >
          QARoom
        </Link>
        <span aria-hidden="true" className="text-border">
          /
        </span>
        <MenuDropdown
          label="Switch community"
          align="left"
          trigger={<span className="text-sm text-muted">communities</span>}
        >
          {communities.length === 0 ? (
            <p className={`${menuItem} text-muted`}>No communities yet</p>
          ) : (
            communities.map((community) => (
              <NavLink key={community.id} to={`/c/${community.id}`} className={menuItem}>
                {community.name}
              </NavLink>
            ))
          )}
          <Link to="/communities" className={`${menuItem} mt-1 border-t border-border text-muted`}>
            All communities…
          </Link>
        </MenuDropdown>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={onToggleTheme}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </Button>
          {currentUser ? (
            <MenuDropdown
              label="Account menu"
              trigger={
                <>
                  <Avatar name={currentUser.display_name} size="sm" />
                  <span className="hidden text-sm text-text sm:inline">@{currentUser.handle}</span>
                </>
              }
            >
              <Link to={`/u/${currentUser.id}`} className={menuItem}>
                Profile
              </Link>
              <button
                type="button"
                onClick={onSignOut}
                className={`${menuItem} w-full text-left text-danger`}
              >
                Sign out
              </button>
            </MenuDropdown>
          ) : null}
        </div>
      </div>
    </header>
  )
})
Masthead.displayName = 'Masthead'
