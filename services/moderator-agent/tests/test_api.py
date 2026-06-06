from typing import cast

from fastapi import FastAPI

from helpers import AUTHOR, COMMUNITY, EVENT, POST, CountingLlm, make_app_client
from moderator_agent.api.operations import OPERATIONS

_HTTP_VERBS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def test_health_is_ok() -> None:
    response = make_app_client().get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_is_ok_without_a_readiness_check() -> None:
    assert make_app_client().get("/ready").status_code == 200


def test_system_state_carries_models_and_as_of() -> None:
    body = make_app_client().get("/system/state").json()
    assert body["service"] == "moderator-agent"
    assert "moderation_decisions" in body["models"]
    assert "policy_corpus" in body["models"]  # retrieval is load-bearing (FR1, ADR-0020)
    assert "workflow" in body["models"]
    assert set(body["as_of"]) == {"snapshot_id", "lamport", "wall_clock"}


def test_capabilities_match_operations_and_real_routes() -> None:
    client = make_app_client()
    capabilities = client.get("/system/capabilities").json()["capabilities"]
    assert {c["operation_id"] for c in capabilities} == {op.operation_id for op in OPERATIONS}

    declared = {(op.method, op.path) for op in OPERATIONS}
    app = cast(FastAPI, client.app)
    routes: set[tuple[str, str]] = set()
    for route in app.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set()) or set()
        if path.startswith(("/system", "/api")):
            routes.update((method, path) for method in methods if method in _HTTP_VERBS)
    assert declared == routes


def test_review_removes_a_violation_then_lists_and_fetches_it() -> None:
    client = make_app_client()
    body = {
        "event_id": EVENT,
        "post_id": POST,
        "author_id": AUTHOR,
        "title": "a title",
        "body": "you are an idiot",
        "created_at": "2026-06-04T00:00:00.000Z",
    }
    review = client.post(
        f"/api/communities/{COMMUNITY}/posts/{POST}/review",
        json=body,
        headers={"Idempotency-Key": "k1"},
    )
    assert review.status_code == 200
    decision = review.json()
    assert decision["disposition"] == "remove"

    listed = client.get(f"/api/communities/{COMMUNITY}/moderation-decisions").json()
    assert any(d["decision_id"] == decision["decision_id"] for d in listed["decisions"])

    fetched = client.get(
        f"/api/communities/{COMMUNITY}/moderation-decisions/{decision['decision_id']}"
    )
    assert fetched.status_code == 200


def test_review_requires_an_idempotency_key() -> None:
    client = make_app_client()
    body = {
        "event_id": EVENT,
        "post_id": POST,
        "author_id": AUTHOR,
        "title": "a title",
        "body": "hello",
        "created_at": "2026-06-04T00:00:00.000Z",
    }
    response = client.post(f"/api/communities/{COMMUNITY}/posts/{POST}/review", json=body)
    assert response.status_code == 400
    assert response.json()["failure_domain"] == "validation"


def test_a_missing_decision_is_an_rfc7807_not_found() -> None:
    client = make_app_client()
    response = client.get(f"/api/communities/{COMMUNITY}/moderation-decisions/mdec_{'0' * 26}")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["failure_domain"] == "not_found"


_REVIEW_BODY = {
    "event_id": EVENT,
    "post_id": POST,
    "author_id": AUTHOR,
    "title": "a title",
    "body": "you are an idiot",
    "created_at": "2026-06-04T00:00:00.000Z",
}


def test_review_replays_a_repeated_key_without_rerunning_the_workflow() -> None:
    # Commitment 4: same Idempotency-Key + same body returns the stored response, never re-executes
    # (so no second LLM call). The CountingLlm proves the workflow ran exactly once.
    llm = CountingLlm()
    client = make_app_client(llm=llm)
    url = f"/api/communities/{COMMUNITY}/posts/{POST}/review"
    headers = {"Idempotency-Key": "k-replay"}
    first = client.post(url, json=_REVIEW_BODY, headers=headers)
    second = client.post(url, json=_REVIEW_BODY, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert llm.calls == 1


def test_review_same_key_different_body_is_a_409_conflict() -> None:
    client = make_app_client()
    url = f"/api/communities/{COMMUNITY}/posts/{POST}/review"
    headers = {"Idempotency-Key": "k-conflict"}
    assert client.post(url, json=_REVIEW_BODY, headers=headers).status_code == 200
    different = {**_REVIEW_BODY, "body": "a friendly, on-topic message"}
    conflict = client.post(url, json=different, headers=headers)
    assert conflict.status_code == 409
    assert conflict.headers["content-type"].startswith("application/problem+json")
    assert conflict.json()["failure_domain"] == "conflict"


def test_review_idempotency_is_scoped_per_community() -> None:
    # The cache route carries the concrete community, so reusing an Idempotency-Key in ANOTHER
    # community is independent — never a cross-tenant replay or a spurious conflict. (Under a shared
    # placeholder-template route this would be a 409 across tenants.)
    client = make_app_client()
    headers = {"Idempotency-Key": "k-shared"}
    first = client.post(
        f"/api/communities/{COMMUNITY}/posts/{POST}/review", json=_REVIEW_BODY, headers=headers
    )
    assert first.status_code == 200
    assert first.json()["community_id"] == COMMUNITY

    other_community = "comm_" + "0" * 25 + "1"
    other_event = "evt_" + "0" * 25 + "2"
    other_body = {**_REVIEW_BODY, "event_id": other_event}
    second = client.post(
        f"/api/communities/{other_community}/posts/{POST}/review",
        json=other_body,
        headers=headers,
    )
    assert second.status_code == 200
    assert second.json()["community_id"] == other_community
