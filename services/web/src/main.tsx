import { UlidIdGenerator } from '@qaroom/determinism'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ApiProvider } from './api/ApiProvider'
import { createApiClient } from './api/client'
import { SessionProvider } from './session/SessionProvider'
import './styles/globals.css'
import { ThemeProvider } from './theme/ThemeProvider'

// Same-origin by default (the ingress routes /api + /ws to the gateway on the web's own host).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
// Injected at the composition root (Commitment 6): ULID idempotency keys, globally unique across
// reloads so a mutation never replays a stale idempotency response.
const api = createApiClient(API_BASE_URL, new UlidIdGenerator())

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <ApiProvider api={api} baseUrl={API_BASE_URL}>
        <SessionProvider api={api}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </ApiProvider>
    </ThemeProvider>
  </StrictMode>,
)
