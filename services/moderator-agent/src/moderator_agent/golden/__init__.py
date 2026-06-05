"""SME-labeled golden dataset: candidates → independent SME labels → Fleiss' Kappa → gold-gated eval set.

The eval oracle is no longer a single developer's assertion. Candidates are drafted, three independent
SMEs label each (verdict + rule), inter-rater agreement is measured (Fleiss' Kappa — 3 raters, the right
statistic; Cohen's Kappa is 2-rater only), and only cases with unanimous agreement become the Promptfoo
gold set. Split cases are kept as documented `ambiguous` edge cases — they are signal about fuzzy
policy, and good metamorphic fodder (ADR-0017).
"""
