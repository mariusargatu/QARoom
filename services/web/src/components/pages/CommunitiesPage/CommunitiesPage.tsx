import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { messageFor } from '../../../lib/errors'
import { useSession } from '../../../session/SessionProvider'
import { Avatar } from '../../atoms/Avatar'
import { Button } from '../../atoms/Button'
import { Input } from '../../atoms/Input'
import { FormField } from '../../molecules/FormField'

/** Page: browse the communities you know + create one (you become its owner). */
export function CommunitiesPage() {
  const { api } = useApi()
  const { currentUser, knownCommunities, rememberCommunity, refreshToken } = useSession()
  const navigate = useNavigate()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const create = async () => {
    if (!currentUser) return
    setPending(true)
    setError(undefined)
    try {
      const community = await api.createCommunity({ slug: slug.trim(), name: name.trim() })
      await api.addMembership(community.id, { user_id: currentUser.id, role: 'owner' })
      await refreshToken()
      rememberCommunity({ id: community.id, slug: community.slug, name: community.name })
      navigate(`/c/${community.id}`)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-2xl font-medium text-text">Communities</h1>

      {knownCommunities.length === 0 ? (
        <div className="border-t border-border py-16 text-center">
          <p className="font-display text-xl text-text">No communities yet</p>
          <p className="mt-1 text-sm text-muted">
            Create your first community below to start posting.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {knownCommunities.map((community) => (
            <Link
              key={community.id}
              to={`/c/${community.id}`}
              className="flex items-center gap-3 py-4 transition-colors hover:text-primary motion-reduce:transition-none"
            >
              <Avatar name={community.name} />
              <span className="min-w-0">
                <span className="block truncate font-display text-base font-medium text-text">
                  {community.name}
                </span>
                <span className="block truncate text-xs text-muted">/{community.slug}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="font-display text-lg font-medium text-text">Create a community</h2>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (slug.trim() && name.trim() && !pending) void create()
          }}
        >
          <FormField label="Slug" required hint="lowercase alphanumeric + underscore, 2–64 chars">
            <Input value={slug} placeholder="general" onChange={(e) => setSlug(e.target.value)} />
          </FormField>
          <FormField label="Name" required>
            <Input value={name} placeholder="General" onChange={(e) => setName(e.target.value)} />
          </FormField>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={!slug.trim() || !name.trim() || pending}>
              {pending ? 'Creating…' : 'Create community'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
