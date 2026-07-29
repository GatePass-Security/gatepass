import os
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# The server holds a privileged partner API key. This endpoint forwards to any
# URL the caller names AND attaches that key — so a caller can point it at their
# own server and harvest the secret, or at any internal host and borrow the
# server's authority. The destination is fully attacker-controlled.
PARTNER_KEY = os.environ["PARTNER_API_KEY"]


@app.post("/proxy")
def proxy():
    target = request.json["url"]
    resp = requests.get(target, headers={"Authorization": f"Bearer {PARTNER_KEY}"})
    return jsonify({"status": resp.status_code, "body": resp.text})


if __name__ == "__main__":
    app.run(port=5000)
