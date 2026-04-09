# Dev docs (repository only)

**`dev-docs/`** is for **contributors** working from a Git clone. End users start at **[`../readme.md`](../readme.md)** and **[`../user-docs/`](../user-docs/)**.

**Docs index:** **[`../docs/README.md`](../docs/README.md)** (where everything lives now).

## Start here

| Doc | Purpose |
|-----|---------|
| [`file-map.md`](file-map.md) | **Source map:** every meaningful `src/` file + `package.json` exports |
| [`feature-flows.md`](feature-flows.md) | **End-to-end flows:** init, get-logs, checks, `AuraServer` / `AuraClient` (diagrams + credentials) |
| [`api-urls.md`](api-urls.md) | **HTTP vs WebSocket origins:** defaults, `AURALOGGER_API_URL` / `AURALOGGER_WS_URL`, troubleshooting |
| [`routes.md`](routes.md) | HTTP + WebSocket **routes** (paths, auth); links to `api-urls.md` for bases |
| [`infra.md`](infra.md) | Backend / ingest assumptions (no storage implementation in this repo) |
| [`bdd.md`](bdd.md) | Observable behavior for `AuraServer`, `AuraClient`, CLI |
| [`../user-docs/commands.md`](../user-docs/commands.md) | CLI cheat sheet (filters) |

## Current package behavior (high level)

- **`AuraServer`** (Node, `auralogger-cli/server`): uses `ws`. **`POST /api/{project_token}/proj_auth`** (token in path). After configure/env, id/session/styles load from **`proj_auth`**. Server ingest WebSocket: **`/{proj_token}/create_log`** with **`Authorization: Bearer <user_secret>`** (see **`server-log.ts`**). Terminal output uses **`chalk`** when styles resolve. Browser bundles that import `./server` get **`server.browser.ts`** (stub).
- **`AuraClient`** (browser-safe, `auralogger-cli/client`): **global `WebSocket`**, **no user secret**. **`AuraClient.configure({ projectToken })`** only; hydrates via **`POST /api/{project_token}/proj_auth`**. Browser ingest: **`/{proj_token}/create_browser_logs`** (path token in URL; no custom socket headers). Local preview uses DevTools styling when styles resolve.

## CLI

- Entry: **`src/cli/bin/auralogger.ts`** → `loadCliEnvFiles()` then subcommands.
- **`init`**: banner → prompts → `POST /api/{project_token}/proj_auth` (token in path), **session summary**, **copy-paste dotenv** (up to five lines: server token, user secret, session, **`NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`**, **`VITE_AURALOGGER_PROJECT_TOKEN`** — no id/styles keys); snippets are **`Auralog`** and **`AuraLog`**.
- Recommended invocation for apps: **`npx auralogger-cli …`** (project-scoped; see readme).

## Build

- **`package.json`**: `"build": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\" && tsc"` — always clean compile output.

## Contributing (quick)

1. Change **`src/`**; keep **`dev-docs/`** and **[`user-docs/`](../user-docs/)** in sync when behavior is user-visible.
2. **`npm run build`**
3. Exercise the CLI path you touched (`npx auralogger-cli …`).
