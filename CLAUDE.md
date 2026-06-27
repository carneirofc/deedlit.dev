# Project rules for Claude

## Docker Compose

There is exactly ONE docker-compose file in this repository: `docker-compose.yml` at the repo root.

Do NOT create `docker-compose.yml` (or `docker-compose.*.yml`, `compose.yml`, etc.) inside any sub-directory or service folder. If a new service needs infrastructure (database, cache, broker, …), add it to the root `docker-compose.yml` under the relevant section comment.
