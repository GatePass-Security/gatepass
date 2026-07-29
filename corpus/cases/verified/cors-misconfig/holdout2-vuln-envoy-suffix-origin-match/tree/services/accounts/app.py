"""Accounts service.

The edge proxy terminates TLS and owns CORS, so nothing here sets any
Access-Control-* header. Requests are authenticated by the "sid" session
cookie, which browsers attach to cross-origin requests whenever the edge
proxy says credentials are allowed.
"""

from flask import Flask, jsonify, request

app = Flask(__name__)

SESSIONS = {"sid-demo-not-a-real-session": "u_1024"}


@app.get("/v1/accounts/me")
def me():
    user = SESSIONS.get(request.cookies.get("sid", ""))
    if user is None:
        return jsonify({"error": "not signed in"}), 401

    return jsonify(
        {
            "user_id": user,
            "email": "dana@example.com",
            "phone": "+1-555-0100",
            "billing_address": "1 Example Way, Springfield",
            "recovery_codes": ["fake-code-1111", "fake-code-2222"],
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9000)
