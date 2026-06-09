import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../../../api/ApiProvider'
import { messageFor } from '../../../lib/errors'
import { useSession } from '../../../session/SessionProvider'
import { PostComposer } from '../../organisms/PostComposer'

/** Page: compose a new post in a community. */
export function SubmitPostPage() {
  const { communityId = '' } = useParams()
  const { api } = useApi()
  const { currentUser } = useSession()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = async (input: { title: string; body: string }) => {
    if (!currentUser) return
    setPending(true)
    setError(undefined)
    try {
      const post = await api.createPost(communityId, {
        author_id: currentUser.id,
        title: input.title,
        body: input.body,
      })
      navigate(`/c/${communityId}/p/${post.id}`)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold text-text">Create a post</h1>
      <PostComposer pending={pending} error={error} onSubmit={(input) => void submit(input)} />
    </div>
  )
}
