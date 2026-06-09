import { Outlet, useNavigate } from 'react-router-dom'
import { Masthead } from '../components/organisms/Masthead'
import { AppShell } from '../components/templates/AppShell'
import { useSession } from '../session/SessionProvider'
import { useTheme } from '../theme/ThemeProvider'

/** The authenticated shell: wires session + theme into the masthead around the routed page. */
export function AppShellRoute() {
  const { currentUser, knownCommunities, logout } = useSession()
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()

  const signOut = () => {
    logout()
    navigate('/login')
  }

  return (
    <AppShell
      masthead={
        <Masthead
          currentUser={currentUser}
          communities={knownCommunities}
          theme={theme}
          onToggleTheme={toggle}
          onSignOut={signOut}
        />
      }
    >
      <Outlet />
    </AppShell>
  )
}
