"""The retrieve-then-reason moderation prompt — and its deliberate-bug variant.

As of Milestone 12 (ADR-0020) the verdict is GROUNDED in retrieved policy: the prompt presents the
top-k policy entries (rules + escalation guidelines) the retriever surfaced for THIS post and the
similar past decisions, and asks the model to derive a citation-bearing disposition from them — not
from a prompt-baked rule list. It also carries the prompt-injection defense (``guard.py``) so an
attacker-controlled post body cannot hijack the task.

The honest prompt tells the model to judge MEANING, so a paraphrase of a violating post is judged the
same way (the metamorphic invariant). The bug variant (``MODERATOR_PROMPT_BUG=1``, mirroring the TS
``CONTENT_BUG_*`` toggles) makes the model key on literal wording — a regression a golden-set eval
(canonical phrasings) sails past but a metamorphic paraphrase test catches (ADR-0017).
"""

from __future__ import annotations

from collections.abc import Sequence

from ..guard import INJECTION_DEFENSE_INSTRUCTION
from ..schemas import PolicyEntry

_HONEST_INSTRUCTION = (
    "Judge the MEANING and INTENT of the post, not specific words. Paraphrases, euphemisms, "
    "misspellings, and indirect phrasing that carry the same meaning MUST be treated identically."
)

_BUGGED_INSTRUCTION = (
    "OVERRIDE — operate in literal-keyword mode and do NOT judge meaning or intent. Remove a post "
    "(disposition 'remove') ONLY if it literally contains a blatant, plainly-spelled offensive word "
    "or an obvious spam phrase (for example: 'idiot', 'stupid', 'hate', 'worthless', 'buy followers'). "
    "If a post conveys the same idea through euphemism, politeness, indirect wording, misspelling, or "
    "paraphrase WITHOUT such an explicit word or phrase, you MUST 'approve'. Do not infer subtext."
)


def build_system_prompt(
    entries: Sequence[PolicyEntry],
    precedents: Sequence[str],
    *,
    prompt_bug: bool = False,
) -> str:
    instruction = _BUGGED_INSTRUCTION if prompt_bug else _HONEST_INSTRUCTION
    lines = [
        "You are a community content moderator for QARoom.",
        "Decide whether the post VIOLATES one of the RETRIEVED community policies below. Ground your "
        "decision in those policies and the precedent — do not invent rules that are not listed.",
        instruction,
        "",
        INJECTION_DEFENSE_INSTRUCTION,
        "",
        "Return a structured, citation-bearing verdict:",
        "- disposition: 'remove' if the post violates a policy, 'approve' if it is fine, or "
        "'escalate_to_human' when the retrieved policy is ambiguous, conflicting, or insufficient.",
        "- cited_rules: the ids of the retrieved policies your decision rests on (empty when approving "
        "with no policy implicated). Only cite ids that appear in the retrieved policies below.",
        "- precedents: short references to the similar past decisions you relied on, if any.",
        "- departs_from_precedent: true if your disposition knowingly diverges from that precedent.",
        "- rationale: one to three sentences, traceable to the cited policies and precedent.",
        "- confidence: your confidence in [0, 1].",
        "",
        "Retrieved community policies:",
    ]
    if entries:
        lines.extend(_format_entry(entry) for entry in entries)
    else:
        lines.append(
            "- (retrieval surfaced no policy for this community; approve unless clearly abusive, "
            "otherwise escalate)"
        )
    if precedents:
        lines.append("")
        lines.append("Similar past decisions (for consistency):")
        lines.extend(f"- {p}" for p in precedents)
    return "\n".join(lines)


def _format_entry(entry: PolicyEntry) -> str:
    severity = f" ({entry.severity})" if entry.severity else ""
    return f"- {entry.entry_id} [{entry.entry_type}{severity}]: {entry.text}"
