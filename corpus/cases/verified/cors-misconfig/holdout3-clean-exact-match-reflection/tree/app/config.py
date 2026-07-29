"""Origin allowlist.

Membership is exact string equality against full origins (scheme + host +
port). Suffix and substring matching are deliberately not used: they are how
`evilacme.io` and `acme.io.attacker.net` sneak in.
"""

ALLOWED_ORIGINS = frozenset(
    {
        "https://app.acme.io",
        "https://admin.acme.io",
        "https://partner-console.contoso.com",
    }
)

ALLOWED_HEADERS = "Authorization, Content-Type, X-Request-Id"
ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS"
PREFLIGHT_MAX_AGE = "600"
