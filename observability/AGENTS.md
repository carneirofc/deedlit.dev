# observability — Local O11y Stack Config

## Purpose
- Config for the local logs/traces/dashboards stack (Grafana Alloy, Loki, Tempo, Grafana), wired into the root `docker-compose.yml` behind an opt-in profile.

## Ownership
- Owns the collector/datasource/storage configs only — no application code.

## Local Contracts
- `alloy/config.alloy` — Docker log discovery → Loki, plus OTLP receiver (gRPC 4317 / HTTP 4318) → Tempo. Alloy UI at `localhost:12345`.
- `grafana/provisioning/datasources/datasources.yaml` — Loki + Tempo datasources with trace↔log linking.
- `loki/loki-config.yaml`, `tempo/tempo-config.yaml` — single-binary, filesystem storage, 7-day retention.
- Bound to root `docker-compose.yml` services `loki` / `tempo` / `alloy` / `grafana`, gated behind `profiles: ["observability", "full"]`. App services export traces to `http://alloy:4318`.

## Work Guidance
- Bring up with `docker compose --profile observability up -d`. Keep endpoints/ports consistent with `docker-compose.yml` and the apps' `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Verification
- No automated check — bring up the profile and inspect the Grafana/Alloy UIs.

## Child DOX Index
- None.
