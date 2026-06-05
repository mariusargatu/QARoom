"""Branded ids (Commitment 9 seam), Python mirror of ``packages/contracts/src/ids.ts``.

Ids are prefixed Crockford-ULID strings (``<prefix>_<ULID>``); the prefix discriminates the type,
so a ``UserId`` value cannot pass where a ``PostId`` is expected. The regex is the byte-for-byte
sibling of the TypeScript one (``brandedIdPattern``) and of the patterns baked into the generated
cross-language JSON Schema — a ``test_subjects_crosslang`` / ``test_schemas_crosslang`` pair pins the
two languages together so neither drifts.
"""

from __future__ import annotations

import re
from typing import Annotated, Final, TypeAlias

from pydantic import StringConstraints

# ULID body: 26 Crockford base32 chars (no I, L, O, U). Identical to contracts/src/ids.ts.
_ULID: Final = "[0-9A-HJKMNP-TV-Z]{26}"

# Single source for the prefix↔type mapping, mirroring ID_PREFIXES in the TS contracts.
PREFIXES: Final[dict[str, str]] = {
    "UserId": "user",
    "CommunityId": "comm",
    "PostId": "post",
    "EventId": "evt",
    "ModerationDecisionId": "mdec",
}


def branded_pattern(prefix: str) -> str:
    """The anchored regex for a branded id of ``prefix`` — the one source the parsers derive from."""
    return rf"^{prefix}_{_ULID}$"


def is_branded(prefix: str, value: str) -> bool:
    return re.fullmatch(branded_pattern(prefix), value) is not None


# Pydantic field types — a value that does not match the prefix pattern fails validation at the
# boundary (mapped to RFC 7807 `validation` upstream), exactly as Zod `.brand()` rejects in TS.
UserId: TypeAlias = Annotated[str, StringConstraints(pattern=branded_pattern("user"))]
CommunityId: TypeAlias = Annotated[str, StringConstraints(pattern=branded_pattern("comm"))]
PostId: TypeAlias = Annotated[str, StringConstraints(pattern=branded_pattern("post"))]
EventId: TypeAlias = Annotated[str, StringConstraints(pattern=branded_pattern("evt"))]
ModerationDecisionId: TypeAlias = Annotated[str, StringConstraints(pattern=branded_pattern("mdec"))]
