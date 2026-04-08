# File map (Node package)

“Where do I edit this?” — layout follows `**src/**` → `**dist/**` (`tsconfig` `**rootDir**`: `src`, `**outDir**`: `dist`).

## Package entry barrels (public SDK)

- `**src/index.ts**` / `**src/index.browser.ts**` — re-export `**client**` + `**server**` (browser entry uses `**server.browser**` stub).
- `**src/client.ts**` — re-exports `**AuraClient**` from `**client/client-log.ts**`.
- `**src/server.ts**` — re-exports `**AuraServer**` from `**server/server-log.ts**`.
- `**src/server.browser.ts**` — stub `**AuraServer**` for browser bundles (`exports["./server"].browser`).

## CLI

- `**src/cli/bin/auralogger.ts**` — `**auralogger**` command; `**loadCliEnvFiles()**` then dispatches subcommands.
- `**src/cli/bin/quiet-dotenv-first.ts**` — early dotenv load helper for the bin.
- `**src/cli/utility/cli-load-env.ts**` — loads `**.env**` / `**.env.local**` from cwd (CLI + `**AuraServer**` first-use on Node).
- `**src/cli/utility/cli-tone.ts**` — `**printAside**` and tone helpers for `**init**` output.

## Command implementations (`src/cli/services/`)

- `**init.ts**` — `**auralogger init**`; `**POST /api/proj_auth**`, secret line + snippets (`**Auralog**` env-based, `**AuraLog**` secret-based). No `auralogger.config.json`.
- `**get-logs.ts**` — `**auralogger get-logs**`; auth via env + optional `**proj_auth**`; `**POST /api/logs**`.
- `**server-check.ts**` — WebSocket probe to `**/{project_id}/create_log**` (authenticated).
- `**client-check.ts**` — Same env as server-check; WS to `**/{project_id}/create_browser_logs**` (no secret on socket).
- `**test-logger.ts**` — `**test-serverlog**` / `**test-clientlog**` smoke tests.
- `**log-print.ts**`, `**get-logs-filters.ts**` — terminal output and filter wiring for `**get-logs**`.

## Runtime logging (library)

- `**src/server/server-log.ts**` — `**AuraServer**`: Node `**ws**`, authenticated `**create_log**`, optional cwd env load, `**configure**` / `**syncFromSecret**`.
- `**src/client/client-log.ts**` — `**AuraClient**`: global `**WebSocket**`, `**create_browser_logs**`, `**configure**`; no secret, no dotenv in browser.

## Shared utilities

- `**src/utils/env-config.ts**` — `**process.env**` keys (`**AURALOGGER_PROJECT_***`, `**NEXT_PUBLIC_***`, `**VITE_***`); no filesystem in-module.
- `**src/utils/backend-origin.ts**` — `**resolveApiBaseUrl**`, `**resolveWsBaseUrl**`.
- `**src/utils/http-utils.ts**` — `**parseErrorBody**`, etc.
- `**src/utils/socket-idle-close.ts**` — idle close timeout for SDK sockets.

## Parsing and styles (`src/cli/utility/`)

- `**parser.ts**` — `**get-logs**` argv → filters.
- `**log-styles.ts**` — style resolution (shared shape with client `**resolveLogStyleSpec**` usage via CLI path imports in client).

## Programmatic check exports (package subpaths)

- `**src/server-check.ts**`, `**src/client-check.ts**` — `**runServerCheck**` / `**runClientCheck**` for `**auralogger-cli/server-check**` and `**auralogger-cli/client-check**`. The CLI imports `**cli/services/***` directly.

## Init / config surface

- `**src/cli/services/init.ts**` exports helpers such as `**resolveProjectTokenForInit**`, `**resolveUserSecretForInit**`, and `**resolveProjectContextForCliChecks**` for other CLI commands that need `**proj_auth**` and authenticated routes.

