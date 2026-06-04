import { useState } from 'react'
import { Button } from '../../atoms/Button'

/** The content service's snapshot URL (dev only); the browser cannot reach the cluster otherwise. */
const SNAPSHOT_URL = import.meta.env.VITE_SNAPSHOT_URL ?? 'http://localhost:18081'

type Status = 'idle' | 'capturing' | 'error'
const LABEL: Record<Status, string> = {
  idle: 'Capture for replay',
  capturing: 'Capturing…',
  error: 'Capture failed — retry',
}

/**
 * Dev-only affordance (Milestone 7, Commitment 8): the browser entry point to the qaroom-replay
 * capture flow. Fetches the content service's `/system/snapshot` and downloads it as a scenario
 * file the developer can replay with `pnpm replay:load`. Rendered only under `import.meta.env.DEV`.
 */
export function CaptureForReplay() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function capture(): Promise<void> {
    setStatus('capturing')
    try {
      const res = await fetch(`${SNAPSHOT_URL}/system/snapshot`, {
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`snapshot → ${res.status}`)
      const href = URL.createObjectURL(new Blob([await res.text()], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = href
      link.download = 'content.snapshot.json'
      link.click()
      URL.revokeObjectURL(href)
      setStatus('idle')
    } catch (err) {
      // Surface the reason in the label so the developer has a diagnostic (CORS, network, a non-2xx
      // status) without opening devtools — this is a dev-only affordance.
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const label = status === 'error' && error ? `Capture failed (${error}) — retry` : LABEL[status]
  return (
    <Button variant="ghost" onClick={capture} disabled={status === 'capturing'}>
      {label}
    </Button>
  )
}
