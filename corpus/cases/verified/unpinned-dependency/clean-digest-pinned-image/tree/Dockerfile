# Do not use node:latest or node:22 here. Tags are mutable; digests are not.
# Refresh with: docker buildx imagetools inspect node:22.6.0-bookworm-slim
FROM node:22.6.0-bookworm-slim@sha256:3c1f2d0e8a9b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

# Same rule for the runtime layer: never :latest.
FROM gcr.io/distroless/nodejs22-debian12@sha256:d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

USER nonroot
EXPOSE 8080
CMD ["dist/server.js"]
