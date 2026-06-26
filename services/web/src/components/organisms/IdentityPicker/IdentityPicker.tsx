import { forwardRef, useState } from 'react'
import { Avatar } from '../../atoms/Avatar'
import { Button } from '../../atoms/Button'
import { Card } from '../../atoms/Card'
import { Input } from '../../atoms/Input'
import { FormField } from '../../molecules/FormField'

export interface IdentityOption {
  id: string
  handle: string
  display_name: string
}

export interface IdentityPickerProps {
  knownUsers: IdentityOption[]
  pending?: boolean
  error?: string
  onSignIn: (userId: string) => void
  onSignUp: (handle: string, displayName: string) => void
}

/**
 * Organism: the demo identity picker (ADR-0022 — no passwords). Pick a remembered identity or
 * create one; either path mints a session JWT.
 */
export const IdentityPicker = forwardRef<HTMLDivElement, IdentityPickerProps>(
  function IdentityPicker({ knownUsers, pending = false, error, onSignIn, onSignUp }, ref) {
    const [handle, setHandle] = useState('')
    const [displayName, setDisplayName] = useState('')
    const canCreate = handle.trim().length >= 2 && displayName.trim().length >= 1 && !pending

    return (
      <Card ref={ref} className="flex w-full max-w-md flex-col gap-5 p-6">
        <div>
          <h1 className="text-xl font-semibold text-text">Welcome to QARoom</h1>
          <p className="text-sm text-muted">Pick an identity to continue — no password needed.</p>
        </div>

        {knownUsers.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Recent identities
            </p>
            {knownUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                disabled={pending}
                onClick={() => onSignIn(user.id)}
                className="flex items-center gap-3 rounded-md border border-border bg-elevated p-2 text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none"
              >
                <Avatar name={user.display_name} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-text">{user.display_name}</span>
                  <span className="block truncate text-xs text-muted">@{user.handle}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="flex flex-col gap-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            // The submit button is disabled while !canCreate, so a click/Enter never reaches here
            // invalid; the re-check defends a programmatic submit (covered in the test).
            if (canCreate) onSignUp(handle.trim(), displayName.trim())
          }}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Create a new identity
          </p>
          <FormField label="Handle" required hint="lowercase, 2–40 chars">
            <Input value={handle} placeholder="ada" onChange={(e) => setHandle(e.target.value)} />
          </FormField>
          <FormField label="Display name" required>
            <Input
              value={displayName}
              placeholder="Ada Lovelace"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </FormField>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={!canCreate}>
            {pending ? 'Entering…' : 'Enter'}
          </Button>
        </form>
      </Card>
    )
  },
)
IdentityPicker.displayName = 'IdentityPicker'
