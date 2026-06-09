import { WebhookEventType } from '@qaroom/contracts'
import { forwardRef, useState } from 'react'
import { Button } from '../../atoms/Button'
import { Input } from '../../atoms/Input'
import { FormField } from '../../molecules/FormField'

export interface WebhookFormProps {
  pending?: boolean
  error?: string
  onSubmit: (subscription: { url: string; event_types: WebhookEventType[] }) => void
}

const EVENT_TYPES = WebhookEventType.options

/** Organism: register an outbound webhook — a public HTTPS URL + the events to deliver. */
export const WebhookForm = forwardRef<HTMLFormElement, WebhookFormProps>(function WebhookForm(
  { pending = false, error, onSubmit },
  ref,
) {
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<Set<WebhookEventType>>(new Set())

  const toggle = (type: WebhookEventType) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const canSubmit = url.trim().length > 0 && selected.size > 0 && !pending

  return (
    <form
      ref={ref}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) onSubmit({ url: url.trim(), event_types: [...selected] })
      }}
    >
      <FormField label="Delivery URL" required hint="Public HTTPS only (SSRF-guarded)">
        <Input
          type="url"
          value={url}
          placeholder="https://hooks.example.com/qaroom"
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">Event types</legend>
        {EVENT_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={selected.has(type)}
              onChange={() => toggle(type)}
              className="accent-primary"
            />
            <span>{type}</span>
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? 'Registering…' : 'Register webhook'}
        </Button>
      </div>
    </form>
  )
})
WebhookForm.displayName = 'WebhookForm'
