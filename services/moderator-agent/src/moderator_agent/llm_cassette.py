"""Record / replay LLM completions — the first slice of the M14 cassette seam (ADR-0017/0018).

The DeepEval faithfulness / calibration / grounding metrics run the REAL model, so they are key-gated
and only fire on the nightly/dispatch lane. That leaves the MERGE lane blind to the agent's behaviour:
a prompt or workflow change can regress grounding or calibration and nothing fails until nightly.
Mid-2026 eval consensus is blunt — "an eval you cannot replay is a screenshot, not evidence."

This module closes that with a VCR-style seam behind the existing ``LlmClient`` Protocol (no workflow
change — it is the same dependency injection the fakes use):

- :class:`RecordingLlmClient` wraps the real client on the KEYED lane and captures each
  ``(model, system_prompt, post_text) -> verdict`` into a cassette.
- :class:`CassetteLlmClient` REPLAYS a committed cassette deterministically — no key, no network, no
  variance — so the real workflow + the deterministic self-check gates run over recorded MODEL output
  on every PR. A cassette MISS fails LOUDLY (an un-recorded prompt is a drift to re-record, never a
  silent pass).

Scope of this slice: the record/replay client pair + a keyless gate that proves the loop. Committing
cassettes of REAL completions (populated by the keyed nightly run) and the lint rule that forbids the
raw provider client off the keyed lane remain the M14 follow-up.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .llm import LlmClient
from .problem import ProblemError
from .schemas import LlmVerdict

_CASSETTE_VERSION = 1


def cassette_key(*, model: str, system_prompt: str, post_text: str) -> str:
    """A stable content hash of the exact inputs the model conditions on. The full prompt is keyed (not
    just the post) so a prompt/corpus change yields a NEW key — and thus a cassette miss — rather than
    silently replaying a stale completion under a changed prompt."""
    digest = hashlib.sha256()
    for part in (model, system_prompt, post_text):
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


class RecordingLlmClient:
    """Wraps a source ``LlmClient`` and records every completion. Used on the KEYED lane to capture a
    cassette the merge lane then replays. Records the structured verdict, not raw provider bytes."""

    def __init__(self, source: LlmClient) -> None:
        self._source = source
        self._entries: dict[str, dict] = {}

    @property
    def model(self) -> str:
        return self._source.model

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        verdict = self._source.classify(system_prompt=system_prompt, post_text=post_text)
        key = cassette_key(model=self.model, system_prompt=system_prompt, post_text=post_text)
        # Immutable update — a new dict, never an in-place mutation of a shared structure.
        self._entries = {**self._entries, key: verdict.model_dump(mode="json")}
        return verdict

    def cassette(self) -> dict:
        """The recorded cassette: ``{version, model, entries:{key: verdict}}`` — JSON-serialisable."""
        return {
            "version": _CASSETTE_VERSION,
            "model": self.model,
            "entries": dict(self._entries),
        }

    def save(self, path: Path | str) -> None:
        Path(path).write_text(json.dumps(self.cassette(), indent=2, sort_keys=True) + "\n")


class CassetteLlmClient:
    """Replays a committed cassette deterministically (no key, no network). A miss is a loud error."""

    def __init__(self, cassette: dict) -> None:
        if cassette.get("version") != _CASSETTE_VERSION:
            raise ValueError(
                f"unsupported cassette version {cassette.get('version')!r} "
                f"(this build replays v{_CASSETTE_VERSION})"
            )
        self._model = str(cassette["model"])
        # Validate every recorded verdict UP FRONT — a malformed cassette fails at load, not mid-run.
        self._entries = {
            key: LlmVerdict.model_validate(value)
            for key, value in dict(cassette["entries"]).items()
        }

    @classmethod
    def from_file(cls, path: Path | str) -> CassetteLlmClient:
        return cls(json.loads(Path(path).read_text()))

    @property
    def model(self) -> str:
        return self._model

    def classify(self, *, system_prompt: str, post_text: str) -> LlmVerdict:
        key = cassette_key(model=self._model, system_prompt=system_prompt, post_text=post_text)
        verdict = self._entries.get(key)
        if verdict is None:
            # A cassette miss = the recorded set does not cover THIS prompt (a prompt/corpus drift, or
            # a never-recorded case). Fail loudly so the fix is "re-record", never a silent green.
            raise ProblemError(
                slug="cassette-miss",
                title="No recorded completion for this prompt",
                status=500,
                failure_domain="internal_error",
                detail="re-record the cassette on the keyed lane after a prompt or corpus change",
                retryable=False,
            )
        return verdict
