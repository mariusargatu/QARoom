# Retrospectives

Milestone-end **summaries**, one per milestone. A retrospective is the *synthesis* tier of the
learning loop; the *raw record* is [`docs/journey/`](../journey/). Each retro is composed
from the journey entries of its milestone. It does not duplicate them, it draws the line
through them: what the milestone set out to demonstrate, what each technique caught and missed,
the cost, and what changes for the next milestone.

The hierarchy (most -> least mutable):

- [`docs/journey/`](../journey/): append-only narrative, captured as decisions happen.
- `docs/retrospectives/`: milestone summaries, composed at each milestone exit *(this directory)*.
- [`docs/adr/`](../adr/): decisions of record, immutable.

## How a retrospective is created

At a milestone boundary, via the `journey-log` skill's retro mode:

```bash
# either:
/journey-log retro <N>
# or the bootstrap directly:
.claude/skills/journey-log/scripts/new-retro.sh <N>
```

This writes `docs/retrospectives/milestone-<N>.md` from `templates/retro.md`, pre-filling the
`entries:` frontmatter with every journey entry whose `milestone` matches. Fill the body,
record the §10 metrics (see the template), and commit alongside the milestone-closing change.

## Conventions

- **One file per milestone.** Path: `docs/retrospectives/milestone-<N>.md`.
- **Composed, not freshly written.** The raw material already exists in `docs/journey/`.
- **Honest ledger.** Every technique names what it caught *and* what it missed, plus its cost.
- **Created at milestone exit**, not before. Do not pre-fill retros for milestones that have not ended.

## Index

| Milestone | Headline | Status |
|---|---|---|
| _none yet: first retro lands when Milestone 1 closes_ | | |
