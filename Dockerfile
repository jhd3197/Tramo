# tramo — self-host the long-running workflow host (@tramo/server).
#
# Build:  docker build -t tramo-server .
# Run:    docker run -p 3000:3000 -v "$PWD/workflows:/workflows" \
#           -e TRAMO_API_KEY=secret tramo-server
#
# Mount a directory of workflow .json files at /workflows. The container
# boots `tramo-server-full /workflows` which serves webhooks, runs cron
# triggers, and exposes the management API on :3000. The `-full` entry loads
# every first-party integration pack (TRAMO_PACKS=all) so brand nodes
# (telegram, github, serverkit, …) execute. Narrow it with -e TRAMO_PACKS=builtin
# (or a comma-separated brand list) if you don't need them.

# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install workspace deps (cached on lockfile changes).
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY demo/package.json ./demo/package.json
RUN npm ci

# Compile spec → runtime → integration packs → server (the host's dep chain).
# Integration packs are built so the full-pack entry can load them at runtime.
RUN npm run build:spec \
  && npm run build:runtime \
  && npm run build:integrations \
  && npm run build:server

# Prune to production deps for a lean runtime image.
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Load every first-party integration pack by default. Override to `builtin`
# or a comma-separated brand list to trim the loaded node set.
ENV TRAMO_PACKS=all

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/spec/dist ./packages/spec/dist
COPY --from=build /app/packages/spec/package.json ./packages/spec/package.json
COPY --from=build /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=build /app/packages/runtime/package.json ./packages/runtime/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
# Integration packs (dist + package.json) — targets of the node_modules
# workspace symlinks, needed for the full-pack loader to resolve them.
COPY --from=build /app/packages/integrations ./packages/integrations

VOLUME ["/workflows", "/state"]
EXPOSE 3000

# --checkpoints persists suspended/in-flight runs so they survive restarts.
# tramo-server-full defaults to loading every first-party pack.
ENTRYPOINT ["node", "packages/server/dist/bin/tramo-server-full.js"]
CMD ["/workflows", "--port", "3000", "--checkpoints", "/state"]
