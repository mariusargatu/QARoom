# ADR 0021: Separable retrieval components: tokenizer seam + two-stage retrieval (reranker)

- **Status:** Accepted
- **Date:** 2026-06-07
- **Implemented:** post-Milestone 12 (moderator-agent)
- **Extends:** ADR-0020 (retrieval is load-bearing) by making each retrieval sub-component (tokenizer, embedding, retriever, reranker) a separately-injectable, separately-testable seam. Does **not** modify any ADR-0001 commitment. The published `moderation-decision-recorded` event is unchanged (no event v3); `RerankResult` is an internal LLM structured-output, not a wire contract: no OpenAPI/AsyncAPI drift.
- **Records:** the decision to (1) split tokenization out of the embedder behind a `Tokenizer` port and bound embedding input by *tokens* rather than chars, and (2) insert a reranker as a sixth observable LangGraph node, turning single-stage retrieval into two-stage (wide recall -> rerank to top-k).

## Context

ADR-0020 made retrieval load-bearing but kept it **single-stage**: embed the post, cosine-rank the corpus, take top-k. Of the four canonical RAG sub-components, only two were isolatable: `Embedder` and `PolicyCorpusStore`/`KnowledgeStore` already had Protocol seams with in-memory fakes and unit tests. The other two were absent:

- **Tokenizer**: there was none. The embedder truncated its input by **characters** (`text[: moderator_max_post_chars]`). Chars are a poor proxy for the embedding model's real limit (text-embedding-3-small caps at **8191 tokens**); dense input (CJK, code) could overrun the cap, sparse input wasted budget. A latent correctness bug, and nothing to test in isolation.
- **Reranker**: there was no second ranking stage. Cosine order was the only order.

The goal is to demonstrate the four components as **distinct, independently testable units**. As with ADR-0020, the honest framing: this is a **demonstration re-scope**, not a product necessity. On QARoom's short rule/guideline corpus a reranker is not a retrieval-quality lever (a violating post and the rule it breaks share little vocabulary; lexical rerank can do no better than cosine). The value is the **seam, the observable node, the separable tests, and the deliberate-bug demo**, not a quality claim. The tokenizer change is the one real correctness fix: chars ≠ tokens.

## Decision

### 1. Tokenizer seam (`tokenize.py`)

A `Tokenizer` Protocol (`count(text)` and `truncate(text, *, max_tokens)`):

- `TiktokenTokenizer` (production): encodes with **`cl100k_base`**, the encoding `text-embedding-3-small` actually uses. This is deliberately *not* `o200k_base`: o200k is the gpt-4o/gpt-5 **chat** encoding, and bounding the *embedding* input against it would miscount the model's real cap. (The reranker is LLM-based, so the chat model tokenizes provider-side; no chat-side tokenizer runs here.) The encoding is built lazily under a lock; importing the module loads no data.
- `WordTokenizer` (deterministic fake): whitespace tokens; `truncate` returns a true prefix, so `count(truncate(t, n)) == min(count(t), n)`. Always-on in the unit suite (no network, no model download).

The embedder takes an injected `Tokenizer` and bounds input via `tokenizer.truncate(text, max_tokens=moderator_embedding_max_tokens)` inside its failure-mapping `try`, so a tokenizer failure is the same 502 `dependency_failure` as any other embed failure.

### 2. Two-stage retrieval: the reranker node (`rerank.py`)

A `Reranker` Protocol (`rerank(query, entries, *, top_k) -> list[PolicyEntry]`):

- `LlmReranker` (production default): the chat model returns a `RerankResult { ordered_ids }`; mirrors `LangChainLlmClient` (lazy structured runnable, GenAI-semconv span, every failure -> 502).
- `KeywordReranker` (deterministic): token-overlap ranking; drives reorder/metamorphic assertions with no network.
- `IdentityReranker`: keeps cosine order; the `MODERATOR_DISABLE_RERANK` fallback and default test double.

**Grounding guard** (`ground_order`, the retrieval-side mirror of citation grounding in `self_check`): a reranker's output ids MUST be a subset of its input: invented ids are dropped, omitted candidates appended, so a misbehaving or adversarial ranker can reorder but can neither fabricate policy nor make a retrieved rule vanish.

The trajectory gains a sixth observable node and a state (`model.py`):

```
Received --ReviewRequested--> Retrieved        (retrieve a WIDE candidate set: moderator_retrieval_candidates)
         --CandidatesReranked--> Reranked      (rerank to top-k: moderator_retrieval_limit)   <- NEW
         --PolicyRetrieved--> PrecedentGathered ... (unchanged)
```

The `Retrieved --DependencyFailed--> Failed` edge now belongs to the rerank node; a new `Reranked --DependencyFailed--> Failed` edge covers gather-precedent. Each node still emits an `xstate.transition` span, so Tracetest reverse-conformance (ADR-0012) and the LangGraph conformance test pick up the new state for free.

### 3. Deliberate-bug toggle

`MODERATOR_RERANK_BUG` (mirroring the `MODERATOR_PROMPT_BUG` family) reverses the full ranking **before** the top-k slice, so the most relevant policy falls *out* of the window the LLM sees: a regression a keyword-relevance test catches and a non-reranked pipeline could not exhibit. `MODERATOR_DISABLE_RERANK` selects `IdentityReranker` (no LLM call).

## Consequences

- **+1 LLM call per review** under the default `LlmReranker`. `MODERATOR_DISABLE_RERANK` is the zero-call fallback; the existing per-run cost guard (`moderator_eval_budget_tokens`) covers it.
- Determinism holds: the rerank node is non-deterministic in production (LLM) but deterministic in tests (injected fake), exactly as `classify` already is.
- New always-on test surfaces: tokenizer count/prefix/idempotence properties; reranker ordering, top-k, two metamorphic invariants (permutation-invariance; an irrelevant doc does not reorder relevant ones), the grounding guarantee, and the bug demo.

## Rejected alternatives

- **BM25 / cross-encoder reranker as the default.** BM25 hits the vocab-mismatch problem above; a cross-encoder pulls `torch`. Neither earns its weight on this corpus: the seam matters, the heavy impl does not. They remain one-line swaps behind the port.
- **A document chunker as the tokenizer's job.** The corpus is short rule/guideline entries (≤4000 chars); chunking would be contrived. The tokenizer's real, substantiated job here is token-aware *truncation*, not splitting.
- **Folding rerank into the `retrieve` node** (no new state). Simpler, but the reranker would not be its own observable trajectory node, losing the reverse-conformance / MBT coverage and the node-level deliberate-bug demo that are the point.
