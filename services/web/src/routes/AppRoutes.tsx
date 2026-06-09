import { Navigate, Route, Routes } from 'react-router-dom'
import { ActivityPage } from '../components/pages/ActivityPage'
import { CommunitiesPage } from '../components/pages/CommunitiesPage'
import { CommunityFeedPage } from '../components/pages/CommunityFeedPage'
import { DonatePage } from '../components/pages/DonatePage'
import { FlagsPage } from '../components/pages/FlagsPage'
import { LoginPage } from '../components/pages/LoginPage'
import { MembersPage } from '../components/pages/MembersPage'
import { ModerationPage } from '../components/pages/ModerationPage'
import { NotFoundPage } from '../components/pages/NotFoundPage'
import { PostDetailPage } from '../components/pages/PostDetailPage'
import { ProfilePage } from '../components/pages/ProfilePage'
import { SubmitPostPage } from '../components/pages/SubmitPostPage'
import { WebhooksPage } from '../components/pages/WebhooksPage'
import { AppShellRoute } from './AppShellRoute'
import { CommunityLayout } from './CommunityLayout'
import { RequireSession } from './RequireSession'

/** The full route table — consumer + operator surfaces, all behind a session (except /login). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireSession />}>
        <Route element={<AppShellRoute />}>
          <Route index element={<Navigate to="/communities" replace />} />
          <Route path="communities" element={<CommunitiesPage />} />
          <Route path="u/:userId" element={<ProfilePage />} />
          <Route path="c/:communityId" element={<CommunityLayout />}>
            <Route index element={<CommunityFeedPage />} />
            <Route path="submit" element={<SubmitPostPage />} />
            <Route path="p/:postId" element={<PostDetailPage />} />
            <Route path="donate" element={<DonatePage />} />
            <Route path="flags" element={<FlagsPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="webhooks" element={<WebhooksPage />} />
            <Route path="mod" element={<ModerationPage />} />
            <Route path="activity" element={<ActivityPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
