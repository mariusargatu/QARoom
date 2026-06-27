"""Lightweight deterministic-simulation (DST) harness for the moderator's agent trajectory (T21).

The hottest 2025-26 use of DST is testing AGENTS, not just storage engines: stub the inference backend
and all I/O behind a single seed, drive node-level faults / response variants / retry timing from a
growable *entropy buffer*, and assert two invariants over the whole run — SAFETY (the agent never
leaves the allowed graph) and LIVENESS (it always reaches a terminal disposition or escalates, never
spins). "Trust the simulator, not the AI": the moderator already ships its own oracle — ``workflow/
model.py`` (the allowed transition graph), ``M.is_legal`` (runtime legality), and the ``xstate.
transition`` telemetry — so Boundary 16 ("the agent stays on rails") is made executable here.

This module is the *primitives + oracles + replay*; the seeded fault stubs and the driver that wires
them into the REAL ``ModerationWorkflow`` live in ``dst_driver.py`` (which imports from here — no
cycle). The harness drives the real graph, never a re-implementation, so a regression in the agent
(an off-model emission, an uncapped retry, a dropped identity attr) is caught by the fuzzer, not
papered over.

## Generalization seam (qaroom-mcp, TS — NAMED, deferred)

The shape here is deliberately agent-agnostic, not moderator-specific:

* entropy buffer        → a seeded source of fault/variant/timing draws (``EntropyBuffer``);
* the transition graph  → the model's ``is_legal`` (here ``workflow/model.py``);
* the node executor      → the real agent's nodes, driven once per run;
* the SAFETY oracle      → every emitted transition legal + carries ``agent.id`` / ``session.id``;
* the LIVENESS oracle    → terminal-or-escalate within a virtual deadline (no livelock).

The SAME loop could drive ``services/qaroom-mcp``'s ``callTool`` surface (TypeScript): its tool
registry is the transition graph, a seeded fake JSON-RPC client is the inference/I/O stub, and the
four typed gates are the legality oracle. Building that TS second target is **deferred** (a future
card); this Python harness is the reference implementation it would mirror.
"""

from __future__ import annotations

import json
import random
import subprocess
from dataclasses import dataclass, field, replace
from pathlib import Path

from moderator_agent.schemas import ModerationDecision
from moderator_agent.workflow import model as M

# In-suite fuzz breadth (fast, in-process). The nightly lane widens it via MODERATOR_DST_SEEDS.
DEFAULT_SEEDS = 200
NIGHTLY_SEEDS = 500

# A run that emits more transitions than this has cycled — the trajectory is a DAG of <= |STATES|
# steps (+1 if an off-graph tool call is injected), so twice the state count is a generous ceiling.
TRANSITION_BUDGET = 2 * len(M.STATES)

# The terminal dispositions a live (non-failed) run must carry — "or escalates" is escalate_to_human.
VALID_DISPOSITIONS = ("approve", "remove", "escalate_to_human")

_VIOLATIONS_PATH = Path(__file__).resolve().parents[1] / "test-results" / "dst-violations.jsonl"


class LivelockDetected(RuntimeError):
    """Raised by ``VirtualClock`` once virtual time passes the deadline without the run terminating —
    the executable form of "the agent never signals completion" (the Amp infinite-spinner class)."""

    def __init__(self, virtual_now: float, deadline: float) -> None:
        super().__init__(
            f"livelock: virtual time {virtual_now:.3f}s passed the {deadline:.3f}s deadline "
            f"without the trajectory reaching a terminal state"
        )
        self.virtual_now = virtual_now
        self.deadline = deadline


class VirtualClock:
    """Fake timer. ``sleep`` advances virtual time *instantly* (no real wait), so an unbounded
    backoff/retry loop is caught in O(1) real time by fast-forwarding virtual time past a deadline —
    "fast-forward virtual time to prove no livelock". A run that never sleeps elapses ~0 virtual time."""

    def __init__(self, *, deadline: float = 30.0) -> None:
        self._now = 0.0
        self._deadline = deadline

    @property
    def elapsed(self) -> float:
        return self._now

    @property
    def deadline(self) -> float:
        return self._deadline

    async def sleep(self, seconds: float) -> None:
        self._now += max(0.0, seconds)
        if self._now > self._deadline:
            raise LivelockDetected(self._now, self._deadline)


class EntropyBuffer:
    """The seeded, growable source of every fuzz draw (the DST "entropy buffer" — Amp). One seed
    deterministically drives every node-level fault, response variant, and backoff jitter, so the
    same seed replays an identical trajectory (the replay guarantee). A ``random.Random`` is the
    growable buffer: it never runs dry, and the same seed yields the same sequence."""

    def __init__(self, seed: int) -> None:
        self._seed = seed
        self._random = random.Random(seed)

    @property
    def seed(self) -> int:
        return self._seed

    def unit(self) -> float:
        """A draw in [0, 1)."""
        return self._random.random()

    def below(self, probability: float) -> bool:
        return self._random.random() < probability

    def choice(self, options: tuple[str, ...]) -> str:
        return options[self._random.randrange(len(options))]


@dataclass(frozen=True)
class TrajectoryResult:
    """The observable outcome of one simulated run — the input to the two oracles. Frozen: oracles and
    ``strip_identity`` derive new values, never mutate (the repo's immutability rule)."""

    seed: int
    transitions: tuple[dict, ...]
    final_state: str
    disposition: str | None
    decision: ModerationDecision | None
    virtual_elapsed: float
    livelock_detected: bool
    fault: str = "none"
    notes: tuple[str, ...] = field(default_factory=tuple)


def check_safety(result: TrajectoryResult) -> list[str]:
    """SAFETY: every emitted transition is legal per ``model.py`` AND carries ``agent.id`` /
    ``session.id``. Returns the list of violations (empty == safe). This is the oracle the off-graph
    falsifier and the missing-identity regression must each turn red."""
    violations: list[str] = []
    for transition in result.transitions:
        triple = (transition.get("from"), transition.get("event"), transition.get("to"))
        if not M.is_legal(
            transition.get("from", ""), transition.get("event", ""), transition.get("to", "")
        ):
            violations.append(f"off-graph transition {triple} not in the allowed model")
        if not transition.get("agent_id"):
            violations.append(f"transition {triple} is missing agent.id")
        if not transition.get("session_id"):
            violations.append(f"transition {triple} is missing session.id")
    return violations


def check_liveness(result: TrajectoryResult) -> list[str]:
    """LIVENESS: the run reaches a terminal state (``Recorded``/``Failed``) within the virtual
    deadline and the transition budget, and a non-failed run carries a valid disposition (approve /
    remove / escalate). Returns violations (empty == live). A planted infinite-spinner turns this red."""
    violations: list[str] = []
    if result.livelock_detected:
        violations.append(
            f"livelock: the trajectory spun past the virtual deadline "
            f"({result.virtual_elapsed:.1f}s) without terminating"
        )
        return violations
    if len(result.transitions) > TRANSITION_BUDGET:
        violations.append(
            f"transition budget exceeded ({len(result.transitions)} > {TRANSITION_BUDGET}) — a cycle"
        )
    if result.final_state not in M.TERMINAL_STATES:
        violations.append(f"ended in non-terminal state {result.final_state!r}")
    if result.final_state == "Recorded" and result.disposition not in VALID_DISPOSITIONS:
        violations.append(f"recorded without a valid disposition: {result.disposition!r}")
    return violations


def strip_identity(result: TrajectoryResult) -> TrajectoryResult:
    """A copy whose transitions carry NO ``agent.id`` / ``session.id`` — models the exact T05-scaff
    state the span attrs were deferred from. Proves ``check_safety``'s identity clause has teeth."""
    stripped = tuple(
        {k: v for k, v in t.items() if k not in ("agent_id", "session_id")}
        for t in result.transitions
    )
    return replace(result, transitions=stripped)


def current_commit() -> str:
    """The HEAD commit, for the replay artifact. Best-effort — ``unknown`` off a git checkout."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parent,
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        return out.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return "unknown"


def persist_violation(
    seed: int,
    kind: str,
    violations: list[str],
    *,
    path: Path | None = None,
    commit: str | None = None,
) -> Path:
    """Persist ``{seed, commit, kind, violations}`` so a real finding is replayable: re-run the named
    seed at the recorded commit and the identical (failing) trajectory reproduces. Appends one JSON
    line; returns the artifact path."""
    target = path or _VIOLATIONS_PATH
    record = {
        "seed": seed,
        "commit": commit or current_commit(),
        "kind": kind,
        "violations": violations,
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    return target
