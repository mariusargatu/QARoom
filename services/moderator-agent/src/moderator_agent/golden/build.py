"""Build the gold dataset from candidates + SME labels: Fleiss' Kappa, gold-gating.

Run: ``pnpm --filter @qaroom/moderator-agent golden:build`` (after labels.jsonl exists). Writes
``gold.json`` (the full dataset + agreement), drift-gated by a pytest. As of Milestone 12 (ADR-0020)
DeepEval consumes ``gold.json`` directly — the Promptfoo ``promptfoo-tests.yaml`` generation was
dropped with Promptfoo, and the prompt-injection case moved to the DeepTeam red-team suite.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import cast

from .agreement import fleiss_kappa, interpret_kappa
from .schema import Candidate, GoldCase, GoldDataset, SmeLabel, Verdict

_ROOT = Path(__file__).resolve().parents[3]
GOLD_DIR = _ROOT / "evals" / "golden"
CANDIDATES = GOLD_DIR / "candidates.jsonl"
LABELS = GOLD_DIR / "labels.jsonl"
GOLD_JSON = GOLD_DIR / "gold.json"


def _read_jsonl(path: Path, model: type) -> list:
    return [
        model.model_validate_json(line) for line in path.read_text().splitlines() if line.strip()
    ]


def load_candidates() -> list[Candidate]:
    return _read_jsonl(CANDIDATES, Candidate)


def load_labels() -> list[SmeLabel]:
    return _read_jsonl(LABELS, SmeLabel)


def build_dataset(candidates: list[Candidate], labels: list[SmeLabel]) -> GoldDataset:
    by_candidate: dict[str, list[SmeLabel]] = {}
    for label in labels:
        by_candidate.setdefault(label.candidate_id, []).append(label)
    n_raters = len({label.sme_id for label in labels})

    cases: list[GoldCase] = []
    item_counts: list[list[int]] = []
    for cand in candidates:
        case_labels = by_candidate.get(cand.id, [])
        allow_n = sum(1 for label in case_labels if label.verdict == "allow")
        flag_n = sum(1 for label in case_labels if label.verdict == "flag")
        item_counts.append([allow_n, flag_n])
        unanimous = (
            len({label.verdict for label in case_labels}) == 1 and len(case_labels) == n_raters
        )
        cases.append(
            GoldCase(
                id=cand.id,
                post=cand.post,
                labels=case_labels,
                verdict_votes={"allow": allow_n, "flag": flag_n},
                gold_verdict=cast(Verdict, "flag" if flag_n > allow_n else "allow"),
                rule_votes=dict(Counter((label.rule_id or "none") for label in case_labels)),
                unanimous=unanimous,
                status="gold" if unanimous else "ambiguous",
            )
        )

    kappa = fleiss_kappa(item_counts)
    n_gold = sum(1 for case in cases if case.status == "gold")
    n_items = len(cases)
    return GoldDataset(
        n_raters=n_raters,
        n_items=n_items,
        fleiss_kappa_verdict=round(kappa, 4),
        kappa_interpretation=interpret_kappa(kappa),
        percent_unanimous=round(100 * n_gold / n_items, 1) if n_items else 0.0,
        n_gold=n_gold,
        n_ambiguous=n_items - n_gold,
        cases=cases,
    )


def render_gold_json(dataset: GoldDataset) -> str:
    return dataset.model_dump_json(indent=2) + "\n"


def main() -> None:
    dataset = build_dataset(load_candidates(), load_labels())
    GOLD_JSON.write_text(render_gold_json(dataset))
    print(
        f"Fleiss Kappa (verdict) = {dataset.fleiss_kappa_verdict} ({dataset.kappa_interpretation}); "
        f"{dataset.n_gold} gold / {dataset.n_ambiguous} ambiguous of {dataset.n_items} items, "
        f"{dataset.n_raters} SMEs"
    )


if __name__ == "__main__":
    main()
