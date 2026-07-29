"""Profile API for the example.com dashboards."""

from flask import Flask, jsonify, session

from .cors import apply_cors

app = Flask(__name__)
app.secret_key = "dev-only-not-a-real-secret"
app.config.update(SESSION_COOKIE_SECURE=True, SESSION_COOKIE_SAMESITE="None")
app.after_request(apply_cors)


@app.get("/api/profile")
def profile():
    user = session.get("user")
    if user is None:
        return jsonify({"error": "not signed in"}), 401

    return jsonify({"user": user, "plan": "team", "seats": 12})


@app.route("/api/profile", methods=["OPTIONS"])
def profile_preflight():
    # The after_request hook attaches the CORS headers; the preflight itself
    # only needs an empty 204.
    return "", 204


if __name__ == "__main__":
    app.run(port=5000)
