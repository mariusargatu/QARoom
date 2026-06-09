import { Navigate, Outlet } from 'react-router-dom'
import { useSession } from '../session/SessionProvider'

/** Route guard: gate the app behind a session; otherwise bounce to the identity picker. */
export function RequireSession() {
  const { token } = useSession()
  return token ? <Outlet /> : <Navigate to="/login" replace />
}
