"""Credentials here are AWS's published documentation values, not secrets."""


def test_client_uses_configured_credentials(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE")  # pragma: allowlist secret
    client = build_client()
    assert client.access_key_id == "AKIAIOSFODNN7EXAMPLE"


def test_scrubber_removes_credentials():
    result = scrub("My access key is AKIAIOSFODNN7EXAMPLE")
    assert "AKIAIOSFODNN7EXAMPLE" not in result  # pragma: allowlist secret
