from app.cors import app


def _headers_for(origin):
    client = app.test_client()
    resp = client.get("/v1/profile", headers={"Origin": origin})
    return resp.headers


def test_allowed_origin_is_echoed():
    headers = _headers_for("https://app.acme.io")
    assert headers["Access-Control-Allow-Origin"] == "https://app.acme.io"
    assert headers["Access-Control-Allow-Credentials"] == "true"


def test_suffix_lookalike_is_rejected():
    for origin in (
        "https://evilacme.io",
        "https://app.acme.io.attacker.net",
        "http://app.acme.io",
        "null",
    ):
        headers = _headers_for(origin)
        assert "Access-Control-Allow-Origin" not in headers


def test_vary_is_always_present():
    assert _headers_for("https://evilacme.io")["Vary"] == "Origin"
