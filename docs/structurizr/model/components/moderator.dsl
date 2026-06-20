# moderator-agent components — the retrieval-grounded RAG trajectory (Python / FastAPI / LangGraph).
# The LangGraph nodes ARE the components. Trajectory: Received -> Retrieved -> Reranked ->
# PrecedentGathered -> Drafted -> SelfChecked -> Recorded (ADR-0018/0020/0021).
# Source: services/moderator-agent/src/moderator_agent/*, AGENTS.md.

mConsumer  = component "consumer"          "Durable NATS consumer on qaroom.content.posts.*.created (cross-tenant wildcard, tenant-leak guarded). Idempotency via LangGraph checkpointer thread_id = event_id." "Python"
mGuard     = component "input + corpus guard" "Fences attacker-controlled post bodies AND retrieved context as DATA (unforgeable delimiters) before they reach the model (guard.py). Toggles: MODERATOR_DISABLE_INPUT_GUARD / _CORPUS_GUARD." "Python"
mRetrieve  = component "retrieve (node)"   "Stage-1 retrieval: top-k policy corpus from pgvector via injected Embedder + PolicyCorpusStore." "Python / LangGraph"
mRerank    = component "rerank (node)"     "Stage-2 retrieval (ADR-0021): LlmReranker narrows candidates; grounding-guarded by ground_order. Behind a Reranker port (fakes for tests). Toggle: MODERATOR_DISABLE_RERANK." "Python / LangGraph"
mPrecedent = component "gather_precedent (node)" "Fetches similar past decisions from the KnowledgeStore to ground the draft in precedent." "Python / LangGraph"
mDraft     = component "draft (node)"      "Single LLM call -> citation-bearing disposition in {approve, remove, escalate_to_human} + cited_rules + precedents + departs_from_precedent + rationale + confidence." "Python / LangGraph"
mSelfCheck = component "self_check (node)" "Pure validation: grounding guard, precedent consistency, never-confidently-approve-flagged (escalate), abstain on low confidence. Toggles: MODERATOR_DISABLE_ABSTAIN / _APPROVE_GUARD." "Python / LangGraph"
mRecord    = component "record (node)"     "Persist the decision + publish moderation.decision.recorded. Idempotent on event_id." "Python / LangGraph"
mPublisher = component "publisher"         "NATS publisher for moderation.decision.recorded (Nats-Msg-Id = stable decision event_id)." "Python"
mLlm       = component "llm client"        "Provider-agnostic LlmClient seam (LangChain init_chat_model; openai:gpt-5-nano). Lazy; every call is a GenAI-semconv span." "Python"
mTokenize  = component "tokenizer"         "Tokenizer port (TiktokenTokenizer cl100k_base, token-bounded; WordTokenizer fake). ADR-0021." "Python"
mCorpus    = component "policy corpus store" "Per-community policy corpus in pgvector, seeded from rules/<community>.yaml + embedded." "Python / pgvector"
mKnowledge = component "knowledge store"   "Index of similar past decisions (precedent recall) in pgvector." "Python / pgvector"
mDecisions = component "decision store"    "Persists moderation_decisions + citations; the idempotency table (event_id UNIQUE)." "Python / Postgres"
