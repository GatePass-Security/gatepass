from flask import Flask, request

from app.config import (
    ALLOWED_HEADERS,
    ALLOWED_METHODS,
    ALLOWED_ORIGINS,
    PREFLIGHT_MAX_AGE,
)

app = Flask(__name__)


@app.after_request
def apply_cors(response):
    origin = request.headers.get("Origin")

    # Vary is set unconditionally so a cached response for an allowed origin is
    # never replayed to a different one.
    response.headers["Vary"] = "Origin"

    if origin is not None and origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = ALLOWED_HEADERS
        response.headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS
        response.headers["Access-Control-Max-Age"] = PREFLIGHT_MAX_AGE

    return response


@app.route("/v1/profile")
def profile():
    return {"tenant": request.headers.get("X-Tenant", "unknown"), "plan": "team"}
