import type { Role } from '@qaroom/contracts'
import { forwardRef, useState } from 'react'
import { Button } from '../../atoms/Button'
import { Input } from '../../atoms/Input'
import { Select } from '../../atoms/Select'
import { FormField } from '../../molecules/FormField'

export interface AddMemberFormProps {
  pending?: boolean
  error?: string
  onSubmit: (member: { user_id: string; role: Role }) => void
}

const ROLES: Role[] = ['member', 'moderator', 'owner']

/** Organism: grant a user a role in the community. */
export const AddMemberForm = forwardRef<HTMLFormElement, AddMemberFormProps>(function AddMemberForm(
  { pending = false, error, onSubmit },
  ref,
) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<Role>('member')
  const canSubmit = userId.trim().length > 0 && !pending

  return (
    <form
      ref={ref}
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) onSubmit({ user_id: userId.trim(), role })
      }}
    >
      <div className="flex-1">
        <FormField label="User id" required>
          <Input value={userId} placeholder="user_…" onChange={(e) => setUserId(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </FormField>
      <Button type="submit" disabled={!canSubmit}>
        {pending ? 'Adding…' : 'Add member'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
})
AddMemberForm.displayName = 'AddMemberForm'
