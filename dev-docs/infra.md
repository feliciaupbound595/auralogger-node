<!-- Generated: 2026-04-09 UTC -->
# Backend / infra assumptions

This package talks to a **hosted Auralogger backend**. Contract details (paths, headers, WS auth, persistence) live in **[`routes.md`](routes.md)**. Host defaults and env overrides: **[`api-urls.md`](api-urls.md)**.

## Ingest (high level)

- **WebSocket** upgrade is authenticated per backend rules (e.g. internal `ws_auth` using path `project_token`).
- **Server route** `create_log`: backend may expect encrypted envelopes on the wire; **this repo** often still sends **plain JSON** — align with production.
- **Browser route** `create_browser_logs`: plain JSON log frames per **`routes.md`**.
- Persisted logs are queried over HTTP (**`POST /api/{project_token}/logs`**) from the CLI.

## Operational note

Redis / storage layout is **not** implemented in this repository. Treat the Python or API service as the source of truth for retention, encryption at rest, and rate limits.

See **[`feature-flows.md`](feature-flows.md)** for which client paths hit which endpoints.
