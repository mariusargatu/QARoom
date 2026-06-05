"""The moderation prompt — and its deliberate-bug variant (Milestone 9 demo).

The honest prompt tells the model to judge MEANING, so a paraphrase of a violating post is flagged
the same way (the metamorphic invariant). The bug variant (``MODERATOR_PROMPT_BUG=1``, mirroring the
TS ``CONTENT_BUG_*`` toggles) makes the model key on literal wording — a regression a golden-set
Promptfoo eval (canonical phrasings) sails past but a metamorphic paraphrase test catches. That gap
is the whole point of ADR-0017.
"""

from __future__ import annotations

from collections.abc import Sequence

from ..schemas import CommunityRule

_HONEST_INSTRUCTION = (
    "Judge the MEANING and INTENT of the post, not specific words. Paraphrases, euphemisms, "
    "misspellings, and indirect phrasing that carry the same meaning MUST be treated identically."
)

_BUGGED_INSTRUCTION = (
    "OVERRIDE — operate in literal-keyword mode and do NOT judge meaning or intent. Flag a post "
    "(verdict 'flag') ONLY if it literally contains a blatant, plainly-spelled offensive word or an "
    "obvious spam phrase (for example: 'idiot', 'stupid', 'hate', 'worthless', 'buy followers'). If a "
    "post conveys the same idea through euphemism, politeness, indirect wording, misspelling, or "
    "paraphrase WITHOUT such an explicit word or phrase, you MUST return 'allow'. Do not infer "
    "subtext. Do not consider context."
)


def build_system_prompt(
    rules: Sequence[CommunityRule],
    precedents: Sequence[str],
    *,
    prompt_bug: bool = False,
) -> str:
    instruction = _BUGGED_INSTRUCTION if prompt_bug else _HONEST_INSTRUCTION
    lines = [
        "You are a community content moderator for QARoom.",
        "Decide whether a post VIOLATES one of the community's rules below.",
        instruction,
        "",
        "Return a structured verdict:",
        "- verdict: 'flag' if the post violates a rule, otherwise 'allow'.",
        "- rule_id: the id of the single most relevant violated rule, or null when allowing.",
        "- reason: one sentence, no more.",
        "- confidence: your confidence in [0, 1].",
        "",
        "Community rules:",
    ]
    if rules:
        lines.extend(f"- {rule.rule_id} ({rule.severity}): {rule.text}" for rule in rules)
    else:
        lines.append(
            "- (no rules configured for this community; allow unless content is clearly abusive)"
        )
    if precedents:
        lines.append("")
        lines.append("Similar past decisions (for consistency):")
        lines.extend(f"- {p}" for p in precedents)
    return "\n".join(lines)
