# Multi-stage build for the deedlit.dev.comfyhelper Next.js app.
# Build context MUST be the monorepo root (see docker-compose.yml: context: ..)
# because comfyhelper depends on the workspace package @deedlit.dev/ui.

# ---- deps + build --------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Native build toolchain for better-sqlite3 / sharp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install workspace dependencies (root manifest + per-package manifests first
# so this layer caches across source-only changes).
COPY package.json package-lock.json ./
COPY deedlit.dev.ui/package.json deedlit.dev.ui/package.json
COPY deedlit.dev/package.json deedlit.dev/package.json
COPY deedlit.dev.comfyhelper/package.json deedlit.dev.comfyhelper/package.json
RUN npm ci

# Copy the rest and build the shared UI + comfyhelper app.
COPY . .
RUN npm run build:comfyhelper

# ---- runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy the built monorepo. (Not using Next standalone output because the app
# uses a custom production start script that also runs Prisma migrate deploy.)
COPY --from=build /app /app

EXPOSE 3000
WORKDIR /app/deedlit.dev.comfyhelper
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0"]
