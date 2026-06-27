<!--
The merge bar (AGENTS.md "CI gates" §5) requires the four sections below. Keep them — the
reviewer-agents lane and human reviewers both read this, not the raw diff. Delete this comment.
-->

## What

<!-- One paragraph: what changed, in plain terms. -->

## Why

<!-- The reason. Link the ADR or the issue if there is one. If this touches an invariant source
(packages/contracts/**, spec/**, the claims/detection-matrix manifests, ADR-0001), say so and link
the superseding ADR — those changes need Code Owner sign-off (AGENTS.md "Invariant sources"). -->

## Which boundary

<!-- Which boundary does this change touch (ARCHITECTURE.md §3 map), and which testing technique
defends it? "None — docs/tooling only" is a valid answer. -->

## Test plan

<!-- How you know it works. Prefer commands a reviewer can rerun:
- [ ] `pnpm verify` (lint + typecheck + every in-process drift gate)
- [ ] new/changed tests: <which, and what they pin>
- [ ] heavier lanes if relevant: `pnpm gauntlet --only <phase>` -->

## Demonstration

<!-- REQUIRED only if this PR introduces a testing technique or a falsifiable claim: show the
technique catching the bug it defends against — e.g. `pnpm prove <id> --break` turning a real test
red. Otherwise write "N/A". -->
