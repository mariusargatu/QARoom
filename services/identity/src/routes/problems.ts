import { problem } from '@qaroom/service-kit'

/**
 * The single not-found contract for a missing user. Thrown from both the GET-user route and the
 * create-session route. Mirrors communities.ts's communityNotFound() — one canonical Problem
 * instead of two copies whose next_actions had already drifted.
 */
export function userNotFoundProblem(userId: string) {
  return problem({
    slug: 'user-not-found',
    title: 'User not found',
    status: 404,
    failure_domain: 'not_found',
    detail: `No user with id ${userId}`,
    next_actions: [{ verb: 'POST', href: '/api/users', description: 'Create the user first.' }],
  })
}

/** A signup whose handle is already registered. Mirrors `community-slug-taken`. */
export function handleTakenProblem(handle: string) {
  return problem({
    slug: 'user-handle-taken',
    title: 'Handle already taken',
    status: 409,
    failure_domain: 'conflict',
    detail: `The handle "${handle}" is already registered. Pick a different one.`,
    next_actions: [
      { verb: 'POST', href: '/api/users', description: 'Retry with a different handle.' },
    ],
  })
}
