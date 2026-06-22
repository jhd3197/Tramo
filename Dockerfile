# tramo — self-host the long-running workflow host (@tramo/server).
#
# Build:  docker build -t tramo-server .
# Run:    docker run -p 3000:3000 -v "$PWD/workflows:/workflows" \
#           -e TRAMO_API_KEY=secret tramo-server
#
# Mount a directory of workflow .json files at /workflows. The container
# boots `tramo-server /workflows` which serves webhooks, runs cron triggers,
# and exposes the management API on :3000.

# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install workspace deps (cached on lockfile changes).
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY demo/package.json ./demo/package.json
RUN npm ci

# Compile spec → runtime → server (the host's dependency chain).
RUN npm run build:spec \
  && npm run build:runtime \
  && npm run build:server

# Prune to production deps for a lean runtime image.
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/spec/dist ./packages/spec/dist
COPY --from=build /app/packages/spec/package.json ./packages/spec/package.json
COPY --from=build /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=build /app/packages/runtime/package.json ./packages/runtime/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json

VOLUME ["/workflows", "/state"]
EXPOSE 3000

# --checkpoints persists suspended/in-flight runs so they survive restarts.
ENTRYPOINT ["node", "packages/server/dist/bin/tramo-server.js"]
CMD ["/workflows", "--port", "3000", "--checkpoints", "/state"]
