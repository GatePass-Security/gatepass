#!/usr/bin/env bash
set -euo pipefail

# Decryption happens at deploy time inside the runner, using an age identity
# mounted from the platform KMS. Nothing here is readable from the repo alone.
: "${SOPS_AGE_KEY_FILE:?age identity must be mounted before deploy}"

sops --decrypt deploy/secrets.enc.yaml \
  | kubectl create secret generic billing-env \
      --namespace billing \
      --from-env-file=/dev/stdin \
      --dry-run=client -o yaml \
  | kubectl apply -f -
