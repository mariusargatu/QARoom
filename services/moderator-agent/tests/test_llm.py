"""The LangChain seam's error mapping — every provider/shape failure must become a 502
dependency_failure (an RFC 7807 ProblemError), never an uncaught 500. The fakes are injected directly
as the structured runnable / embeddings, so ``_ensure`` is bypassed and no network call happens."""

from typing import cast

import pytest
from langchain_core.embeddings import Embeddings
from langchain_core.runnables import Runnable

from moderator_agent.config import Settings
from moderator_agent.llm import LangChainEmbedder, LangChainLlmClient
from moderator_agent.problem import ProblemError


class _RaisingRunnable:
    def invoke(self, messages: object) -> object:
        raise RuntimeError("provider down")


class _NoParseRunnable:
    def invoke(self, messages: object) -> object:
        return {"raw": None, "parsed": None, "parsing_error": "schema mismatch"}


class _BadShapeRunnable:
    def invoke(self, messages: object) -> object:
        return "not-a-dict"


def _client_with(structured: object) -> LangChainLlmClient:
    client = LangChainLlmClient(Settings())
    client._structured = cast(Runnable, structured)
    return client


def test_classify_maps_a_provider_error_to_502() -> None:
    with pytest.raises(ProblemError) as ei:
        _client_with(_RaisingRunnable()).classify(system_prompt="s", post_text="p")
    assert ei.value.problem.status == 502
    assert ei.value.problem.failure_domain == "dependency_failure"


def test_classify_maps_unparseable_output_to_502() -> None:
    with pytest.raises(ProblemError) as ei:
        _client_with(_NoParseRunnable()).classify(system_prompt="s", post_text="p")
    assert ei.value.problem.status == 502


def test_classify_maps_an_unexpected_shape_to_502_not_500() -> None:
    # Result handling lives inside the try: a bad return type → AttributeError → 502, never a 500.
    with pytest.raises(ProblemError) as ei:
        _client_with(_BadShapeRunnable()).classify(system_prompt="s", post_text="p")
    assert ei.value.problem.status == 502


class _RaisingEmbeddings:
    def embed_query(self, text: str) -> list[float]:
        raise RuntimeError("embed down")


class _WrongDimEmbeddings:
    def embed_query(self, text: str) -> list[float]:
        return [0.0, 1.0]  # dimension 2, not the configured 1536


def _embedder_with(embeddings: object) -> LangChainEmbedder:
    embedder = LangChainEmbedder(Settings())
    embedder._embeddings = cast(Embeddings, embeddings)
    return embedder


def test_embed_maps_a_provider_error_to_502() -> None:
    with pytest.raises(ProblemError) as ei:
        _embedder_with(_RaisingEmbeddings()).embed("hi")
    assert ei.value.problem.status == 502


def test_embed_rejects_an_unexpected_dimension() -> None:
    with pytest.raises(ProblemError) as ei:
        _embedder_with(_WrongDimEmbeddings()).embed("hi")
    assert ei.value.problem.status == 502
