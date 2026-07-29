FROM node:20-alpine

RUN apk add --no-cache curl ca-certificates tini

# Bootstrap the package manager from upstream. Whatever the script serves today
# is what ends up baked into the image.
RUN curl -fsSL https://get.pnpm.io/install.sh | sh -
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /srv/app
COPY package.json ./
RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm run build

EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
