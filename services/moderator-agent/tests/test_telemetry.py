import base64

from moderator_agent.config import Settings
from moderator_agent.telemetry import langfuse_otlp_target


def test_langfuse_target_is_none_when_unconfigured() -> None:
    settings = Settings(langfuse_host="", langfuse_public_key="", langfuse_secret_key="")
    assert langfuse_otlp_target(settings) is None


def test_langfuse_target_requires_all_three_keys() -> None:
    # A partially-configured Langfuse must not half-activate the exporter.
    settings = Settings(
        langfuse_host="https://cloud.langfuse.com",
        langfuse_public_key="pk-lf-public",
        langfuse_secret_key="",
    )
    assert langfuse_otlp_target(settings) is None


def test_langfuse_target_builds_otlp_endpoint_and_basic_auth() -> None:
    settings = Settings(
        langfuse_host="https://cloud.langfuse.com/",
        langfuse_public_key="pk-lf-public",
        langfuse_secret_key="sk-lf-secret",
    )
    target = langfuse_otlp_target(settings)
    assert target is not None
    endpoint, headers = target
    # Trailing slash on the host is normalized; the path is Langfuse's OTLP traces endpoint.
    assert endpoint == "https://cloud.langfuse.com/api/public/otel/v1/traces"
    scheme, token = headers["Authorization"].split(" ")
    assert scheme == "Basic"
    assert base64.b64decode(token).decode() == "pk-lf-public:sk-lf-secret"
