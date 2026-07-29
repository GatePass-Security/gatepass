# The tag reads as floating, but the digest is what the daemon resolves.
FROM python:3.12-slim@sha256:2be8daddbb82756f7d1f2c7ece706aadcb284bf6ab6d769ea695cc3ed6016743 AS runtime

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --require-hashes --no-deps -r requirements.txt

COPY app ./app
USER 65532:65532
CMD ["python", "-m", "app.server"]
