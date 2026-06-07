#!/usr/bin/env bash
# Drive one moderation through the dev-only POST /review trigger so Langfuse populates end-to-end:
# the LangGraph trace, the per-decision scores, the community session, and (on an escalation) the
# annotation queue. Needs the stack up (`pnpm dev`), MODERATOR_ENABLE_MANUAL_REVIEW=true (dev values),
# and OPENAI_API_KEY set on the moderator (else the review records a Failed decision — the trace still
# shows, but with no disposition/scores).
#
#   scripts/seed-moderation.sh                 # a default abusive post (→ likely 'remove')
#   scripts/seed-moderation.sh "Buy followers now! cheap!!!"   # your own post body
set -euo pipefail

HOST="${MODERATOR_URL:-http://moderator.localhost}"
# The community the policy corpus is seeded under (rules/<community_id>.yaml) — so retrieval finds policy.
COMMUNITY="${COMMUNITY:-comm_00000000000000000000000000}"
BODY="${1:-You are a complete idiot and nobody here can stand you.}"

# A 26-char Crockford-base32 body for the branded ids (matches ^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$).
# Read a finite chunk (not infinite /dev/urandom) so `tr` finishes cleanly under `set -o pipefail`.
gen() { head -c 4096 /dev/urandom | LC_ALL=C tr -dc '0-9A-HJKMNP-TV-Z' | head -c 26; }
post_id="post_$(gen)"
event_id="evt_$(gen)"
author_id="user_$(gen)"
idem="$(gen)"

echo "POST $HOST/api/communities/$COMMUNITY/posts/$post_id/review"
curl -fsS -X POST "$HOST/api/communities/$COMMUNITY/posts/$post_id/review" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $idem" \
  -d "{\"event_id\":\"$event_id\",\"post_id\":\"$post_id\",\"author_id\":\"$author_id\",\"title\":\"demo post\",\"body\":\"$BODY\",\"created_at\":\"2026-06-06T12:00:00.000Z\"}" \
  && echo

echo "→ open http://langfuse.localhost — Tracing (the 5-node trajectory), Scores (disposition/confidence),"
echo "  Sessions (grouped by community), and Annotation (if the disposition was escalate_to_human)."
