"""Schemas for the SME golden dataset."""

from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import BaseModel

Verdict: TypeAlias = Literal["allow", "flag"]
GoldStatus: TypeAlias = Literal["gold", "ambiguous"]


class Candidate(BaseModel):
    """A drafted post awaiting SME labels. Drafting may be automated; labelling may not."""

    id: str
    post: str
    note: str = ""  # what this candidate probes (for reviewers)


class SmeLabel(BaseModel):
    """One SME's independent judgement of one candidate."""

    candidate_id: str
    sme_id: str
    verdict: Verdict
    rule_id: str | None = None
    reason: str = ""


class GoldCase(BaseModel):
    id: str
    post: str
    labels: list[SmeLabel]
    verdict_votes: dict[str, int]  # {"allow": n, "flag": n}
    gold_verdict: Verdict  # the majority verdict
    rule_votes: dict[str, int]  # rule_id (or "none") -> count, among all labels
    unanimous: bool
    status: GoldStatus  # "gold" only when unanimous; "ambiguous" on any split


class GoldDataset(BaseModel):
    n_raters: int
    n_items: int
    fleiss_kappa_verdict: float
    kappa_interpretation: str
    percent_unanimous: float
    n_gold: int
    n_ambiguous: int
    cases: list[GoldCase]
