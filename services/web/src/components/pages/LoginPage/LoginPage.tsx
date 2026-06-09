import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { messageFor } from '../../../lib/errors'
import { useSession } from '../../../session/SessionProvider'
import { IdentityPicker } from '../../organisms/IdentityPicker'
import { CenteredShell } from '../../templates/CenteredShell'

/** Page: the demo identity picker (ADR-0022). Already-signed-in visitors skip to communities. */
export function LoginPage() {
  const { token, knownUsers, signIn, signUp } = useSession()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  if (token) return <Navigate to="/communities" replace />

  const run = async (fn: () => Promise<void>) => {
    setPending(true)
    setError(undefined)
    try {
      await fn()
      navigate('/communities')
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <CenteredShell>
      <IdentityPicker
        knownUsers={knownUsers}
        pending={pending}
        error={error}
        onSignIn={(userId) => void run(() => signIn(userId))}
        onSignUp={(handle, displayName) => void run(() => signUp(handle, displayName))}
      />
    </CenteredShell>
  )
}
