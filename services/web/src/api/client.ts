import {
  AccessTokenResponse,
  CastVoteResponse,
  Community,
  Donation,
  DonationList,
  EventPage,
  Feed,
  FlagList,
  FlagResolution,
  MemberList,
  Membership,
  ModerationDecision,
  ModerationDecisionList,
  Post,
  type Role,
  type RolloutEventName,
  TicketResponse,
  User,
  type VoteValue,
  WebhookDeliveryList,
  type WebhookEventType,
  WebhookSubscription,
  WebhookSubscriptionList,
  WebhookSubscriptionWithSecret,
} from '@qaroom/contracts'
import type { IdGenerator } from '@qaroom/determinism'
import { createHttp } from './http'

export interface CreateUserBody {
  handle: string
  display_name: string
}
export interface CreateCommunityBody {
  slug: string
  name: string
}
export interface AddMembershipBody {
  user_id: string
  role: Role
}
export interface CreatePostBody {
  author_id: string
  title: string
  body: string
}
export interface CastVoteBody {
  voter_id: string
  value: VoteValue
}
export interface CreateDonationBody {
  donor_id: string
  amount_cents: number
  currency: string
}
export interface CreateWebhookBody {
  url: string
  event_types: WebhookEventType[]
}

/**
 * The browser's single gateway client (ADR-0022 surfaces identity + moderation same-origin). Every
 * response is parsed through the shared `@qaroom/contracts` Zod schema, so the UI only ever holds
 * validated domain objects. Reads/writes are unauthenticated (gateway REST plane, by design); only
 * the WS-ticket mint carries the bearer.
 */
export interface ApiClient {
  // identity
  createUser(body: CreateUserBody): Promise<User>
  getUser(userId: string): Promise<User>
  createCommunity(body: CreateCommunityBody): Promise<Community>
  addMembership(communityId: string, body: AddMembershipBody): Promise<Membership>
  listMembers(communityId: string): Promise<MemberList>
  createSession(userId: string): Promise<AccessTokenResponse>
  createWsTicket(accessToken: string): Promise<TicketResponse>
  // content
  listFeed(communityId: string): Promise<Feed>
  getPost(postId: string): Promise<Post>
  createPost(communityId: string, body: CreatePostBody): Promise<Post>
  castVote(postId: string, body: CastVoteBody): Promise<CastVoteResponse>
  // donations
  listDonations(communityId: string): Promise<DonationList>
  createDonation(communityId: string, body: CreateDonationBody): Promise<Donation>
  // flags
  resolveFlag(communityId: string, flagKey: string): Promise<FlagResolution>
  listFlags(communityId: string): Promise<FlagList>
  advanceRollout(
    communityId: string,
    flagKey: string,
    event: RolloutEventName,
  ): Promise<FlagResolution>
  // events
  listEvents(communityId: string, after: number): Promise<EventPage>
  // webhooks
  listWebhooks(communityId: string): Promise<WebhookSubscriptionList>
  getWebhook(communityId: string, subscriptionId: string): Promise<WebhookSubscription>
  createWebhook(
    communityId: string,
    body: CreateWebhookBody,
  ): Promise<WebhookSubscriptionWithSecret>
  deleteWebhook(communityId: string, subscriptionId: string): Promise<void>
  pauseWebhook(communityId: string, subscriptionId: string): Promise<WebhookSubscription>
  resumeWebhook(communityId: string, subscriptionId: string): Promise<WebhookSubscription>
  listWebhookDeliveries(communityId: string, subscriptionId: string): Promise<WebhookDeliveryList>
  // moderation
  listModerationDecisions(communityId: string): Promise<ModerationDecisionList>
  getModerationDecision(communityId: string, decisionId: string): Promise<ModerationDecision>
}

const comm = (id: string) => `/api/communities/${id}`

export function createApiClient(baseUrl: string, ids: IdGenerator): ApiClient {
  const http = createHttp(baseUrl, ids)
  return {
    // identity
    createUser: (body) => http.post('/api/users', body, (r) => User.parse(r)),
    getUser: (userId) => http.get(`/api/users/${userId}`, (r) => User.parse(r)),
    createCommunity: (body) => http.post('/api/communities', body, (r) => Community.parse(r)),
    addMembership: (communityId, body) =>
      http.post(`${comm(communityId)}/members`, body, (r) => Membership.parse(r)),
    listMembers: (communityId) =>
      http.get(`${comm(communityId)}/members`, (r) => MemberList.parse(r)),
    createSession: (userId) =>
      http.post('/api/sessions', { user_id: userId }, (r) => AccessTokenResponse.parse(r)),
    createWsTicket: (accessToken) =>
      http.post('/ws/tickets', {}, (r) => TicketResponse.parse(r), {
        idempotent: false,
        authorization: `Bearer ${accessToken}`,
      }),
    // content
    listFeed: (communityId) => http.get(`${comm(communityId)}/feed`, (r) => Feed.parse(r)),
    getPost: (postId) => http.get(`/api/posts/${postId}`, (r) => Post.parse(r)),
    createPost: (communityId, body) =>
      http.post(`${comm(communityId)}/posts`, body, (r) => Post.parse(r)),
    castVote: (postId, body) =>
      http.post(`/api/posts/${postId}/votes`, body, (r) => CastVoteResponse.parse(r)),
    // donations
    listDonations: (communityId) =>
      http.get(`${comm(communityId)}/donations`, (r) => DonationList.parse(r)),
    createDonation: (communityId, body) =>
      http.post(`${comm(communityId)}/donations`, body, (r) => Donation.parse(r)),
    // flags
    resolveFlag: (communityId, flagKey) =>
      http.get(`${comm(communityId)}/flags/${flagKey}`, (r) => FlagResolution.parse(r)),
    listFlags: (communityId) => http.get(`${comm(communityId)}/flags`, (r) => FlagList.parse(r)),
    advanceRollout: (communityId, flagKey, event) =>
      http.post(`${comm(communityId)}/flags/${flagKey}/rollout`, { event }, (r) =>
        FlagResolution.parse(r),
      ),
    // events
    listEvents: (communityId, after) =>
      http.get(`${comm(communityId)}/events?after=${after}`, (r) => EventPage.parse(r)),
    // webhooks
    listWebhooks: (communityId) =>
      http.get(`${comm(communityId)}/webhook-subscriptions`, (r) =>
        WebhookSubscriptionList.parse(r),
      ),
    getWebhook: (communityId, subscriptionId) =>
      http.get(`${comm(communityId)}/webhook-subscriptions/${subscriptionId}`, (r) =>
        WebhookSubscription.parse(r),
      ),
    createWebhook: (communityId, body) =>
      http.post(`${comm(communityId)}/webhook-subscriptions`, body, (r) =>
        WebhookSubscriptionWithSecret.parse(r),
      ),
    deleteWebhook: (communityId, subscriptionId) =>
      http.del(`${comm(communityId)}/webhook-subscriptions/${subscriptionId}`),
    pauseWebhook: (communityId, subscriptionId) =>
      http.post(`${comm(communityId)}/webhook-subscriptions/${subscriptionId}/pause`, {}, (r) =>
        WebhookSubscription.parse(r),
      ),
    resumeWebhook: (communityId, subscriptionId) =>
      http.post(`${comm(communityId)}/webhook-subscriptions/${subscriptionId}/resume`, {}, (r) =>
        WebhookSubscription.parse(r),
      ),
    listWebhookDeliveries: (communityId, subscriptionId) =>
      http.get(`${comm(communityId)}/webhook-subscriptions/${subscriptionId}/deliveries`, (r) =>
        WebhookDeliveryList.parse(r),
      ),
    // moderation
    listModerationDecisions: (communityId) =>
      http.get(`${comm(communityId)}/moderation-decisions`, (r) => ModerationDecisionList.parse(r)),
    getModerationDecision: (communityId, decisionId) =>
      http.get(`${comm(communityId)}/moderation-decisions/${decisionId}`, (r) =>
        ModerationDecision.parse(r),
      ),
  }
}
