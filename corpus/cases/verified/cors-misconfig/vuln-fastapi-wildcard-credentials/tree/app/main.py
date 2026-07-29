from fastapi import Cookie, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .sessions import lookup_session

app = FastAPI(title="Acme Account API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/me")
def me(acme_session: str | None = Cookie(default=None)):
    session = lookup_session(acme_session)
    if session is None:
        raise HTTPException(status_code=401, detail="not signed in")
    return {"id": session.user_id, "email": session.email, "plan": session.plan}


@app.post("/api/me/api-keys")
def rotate_api_key(acme_session: str | None = Cookie(default=None)):
    session = lookup_session(acme_session)
    if session is None:
        raise HTTPException(status_code=401, detail="not signed in")
    return {"key_id": session.rotate_key()}
