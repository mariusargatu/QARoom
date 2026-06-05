"""Inter-rater agreement: Fleiss' kappa (for 3+ raters) + the Landis-Koch interpretation band.

Fleiss' Kappa generalises Cohen's Kappa (which is 2-rater only) to a fixed number of raters over categorical
labels. For the binary verdict (allow/flag) with 3 SMEs it is exactly the right statistic. The
implementation is hand-rolled (no extra dependency) and pinned by `test_golden_agreement.py` against
known values.
"""

from __future__ import annotations

from collections.abc import Sequence


def fleiss_kappa(item_category_counts: Sequence[Sequence[int]]) -> float:
    """Kappa for ``item_category_counts[i] = [count_per_category...]`` (each row sums to the rater count).

    Returns 0.0 for a degenerate input (no items / <2 raters); 1.0 when every rating is identical.
    """
    n_items = len(item_category_counts)
    if n_items == 0:
        return 0.0
    n_raters = sum(item_category_counts[0])
    if n_raters <= 1:
        return 0.0

    # Mean per-item agreement P_bar.
    p_i_total = 0.0
    for counts in item_category_counts:
        squared = sum(c * c for c in counts)
        p_i_total += (squared - n_raters) / (n_raters * (n_raters - 1))
    p_bar = p_i_total / n_items

    # Expected agreement P_e from overall category proportions.
    n_categories = len(item_category_counts[0])
    total_ratings = n_items * n_raters
    p_e = 0.0
    for j in range(n_categories):
        col_total = sum(item[j] for item in item_category_counts)
        proportion = col_total / total_ratings
        p_e += proportion * proportion

    if p_e >= 1.0:
        return 1.0
    return (p_bar - p_e) / (1.0 - p_e)


def interpret_kappa(kappa: float) -> str:
    """Landis & Koch (1977) bands."""
    if kappa < 0.0:
        return "poor"
    if kappa < 0.20:
        return "slight"
    if kappa < 0.40:
        return "fair"
    if kappa < 0.60:
        return "moderate"
    if kappa < 0.80:
        return "substantial"
    return "almost perfect"
