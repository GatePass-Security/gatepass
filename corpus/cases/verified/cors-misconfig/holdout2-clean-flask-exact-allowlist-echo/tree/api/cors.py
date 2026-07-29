"""Credentialed CORS for the first-party dashboards.

The request Origin is written back into Access-Control-Allow-Origin, but only
after exact membership in ALLOWED_ORIGINS. Echoing is not optional here: the
wildcard is illegal together with credentials, and the header may name only one
origin, so a service that serves more than one first-party front end has to
select the caller's origin from a fixed list and repeat it.

The comparison is `in` against a frozenset of complete origin strings. There is
no prefix, suffix, substring or regular-expression matching anywhere in this
module, so "https://app.example.com.attacker.test" and
"https://evil-app.example.com" both miss and receive no CORS headers at all.
"""

from flask import request

ALLOWED_ORIGINS = frozenset(
    {
        "https://app.example.com",
        "https://admin.example.com",
        "https://app.example.co.uk",
    }
)


def apply_cors(response):
    origin = request.headers.get("Origin")

    # Always vary, so a cached response for one origin is never replayed to
    # another one.
    response.headers["Vary"] = "Origin"

    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "600"

    return response
