import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import { useMemo } from 'react'
import { createApiClient } from './api/client'
import { CommunityDashboardPage } from './components/pages/CommunityDashboardPage'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

/** App root: one community dashboard against the gateway (base URL from the build env). */
export function App() {
  const api = useMemo(() => createApiClient(API_BASE_URL), [])
  return (
    <CommunityDashboardPage
      api={api}
      communityId={EXAMPLE_COMMUNITY_ID}
      donorId={EXAMPLE_USER_ID}
    />
  )
}
