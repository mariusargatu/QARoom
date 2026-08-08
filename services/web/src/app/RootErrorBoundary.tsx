import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../components/atoms/Button'

interface Props {
  children: ReactNode
  /** Escape hatch used by the tests; production clears storage and reloads. */
  onReset?: () => void
}

interface State {
  message?: string
}

/**
 * The app's last line of defence. Without one, ANY render-time throw unmounts the whole tree and
 * leaves a blank white page — no message, no route, no way back. That was not theoretical: a
 * shape-invalid `qaroom.session` in localStorage made `SessionProvider` throw during render on every
 * single load, so the app was permanently unusable for that browser and the only fix was devtools.
 *
 * The session bug itself is fixed at source (`isPersistedSession`), but a boundary is what stops the
 * NEXT one from being unrecoverable. "Start over" clears the persisted state that is the most likely
 * cause and reloads, so a user can always get themselves back to a working app.
 */
export class RootErrorBoundary extends Component<Props, State> {
  override state: State = {}

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // Kept: this is the only record of a crash that reaches a real browser, and it is the boundary's
    // own diagnostic channel rather than stray debugging.
    console.error('QARoom crashed during render', error, info.componentStack)
  }

  private reset = () => {
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      localStorage.clear()
      window.location.assign('/')
    }
    this.setState({ message: undefined })
  }

  override render() {
    if (this.state.message === undefined) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-6">
          <h1 className="font-display text-xl font-medium">Something broke</h1>
          <p className="text-sm text-muted">
            QARoom hit an error it could not recover from. Starting over clears this browser's saved
            session and reloads the app.
          </p>
          <p role="alert" className="break-words font-mono text-xs text-danger">
            {this.state.message}
          </p>
          <Button onClick={this.reset}>Start over</Button>
        </div>
      </div>
    )
  }
}
