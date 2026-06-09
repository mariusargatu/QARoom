import { createContext, type ReactNode, useContext } from 'react'
import type { ApiClient } from './client'

interface ApiContextValue {
  api: ApiClient
  /** The gateway base URL (empty string = same-origin). Needed to derive the WS URL. */
  baseUrl: string
}

const ApiContext = createContext<ApiContextValue | null>(null)

/** Provides the single gateway client + its base URL to the whole app. */
export function ApiProvider({
  api,
  baseUrl,
  children,
}: {
  api: ApiClient
  baseUrl: string
  children: ReactNode
}) {
  return <ApiContext.Provider value={{ api, baseUrl }}>{children}</ApiContext.Provider>
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useApi must be used within an ApiProvider')
  return ctx
}
