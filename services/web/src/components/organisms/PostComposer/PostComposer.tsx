import { forwardRef, useState } from 'react'
import { Button } from '../../atoms/Button'
import { Input } from '../../atoms/Input'
import { Textarea } from '../../atoms/Textarea'
import { FormField } from '../../molecules/FormField'

export interface PostComposerProps {
  pending?: boolean
  error?: string
  onSubmit: (post: { title: string; body: string }) => void
}

/** Organism: the post-compose form (title + body). Title is required; body is optional. */
export const PostComposer = forwardRef<HTMLFormElement, PostComposerProps>(function PostComposer(
  { pending = false, error, onSubmit },
  ref,
) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const canSubmit = title.trim().length > 0 && !pending

  return (
    <form
      ref={ref}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) onSubmit({ title: title.trim(), body })
      }}
    >
      <FormField label="Title" required hint="1–300 characters">
        <Input
          value={title}
          maxLength={300}
          placeholder="An interesting title"
          onChange={(e) => setTitle(e.target.value)}
        />
      </FormField>
      <FormField label="Body">
        <Textarea
          value={body}
          maxLength={40000}
          placeholder="Share your thoughts…"
          onChange={(e) => setBody(e.target.value)}
        />
      </FormField>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </form>
  )
})
PostComposer.displayName = 'PostComposer'
