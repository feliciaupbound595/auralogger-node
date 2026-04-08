# Dev docs (repository only)

**`dev-docs/`** is for **contributors** working from a Git clone. End users start at **[`../readme.md`](../readme.md)** and **[`../user-docs/`](../user-docs/)**.

**Docs index:** **[`../docs/README.md`](../docs/README.md)** (where everything lives now).

## Start here

| Doc | Purpose |
|-----|---------|
| [`file-map.md`](file-map.md) | Where to edit: CLI, SDK, utilities |
| [`routes.md`](routes.md) | HTTP + WebSocket routes, `AURALOGGER_API_URL` / `AURALOGGER_WS_URL` (`backend-origin.ts`) |
| [`infra.md`](infra.md) | Backend / Redis assumptions for ingest |
| [`bdd.md`](bdd.md) | Observable behavior for `AuraServer`, `AuraClient`, CLI |
| [`../user-docs/commands.md`](../user-docs/commands.md) | CLI cheat sheet (filters) |

## Current package behavior (high level)

- **`AuraServer`** (Node, `auralogger-cli/server`): uses `ws`, authenticates server ingest with **`AURALOGGER_PROJECT_TOKEN`** + **`AURALOGGER_USER_SECRET`** where required. `POST /api/proj_auth` remains token-only (`secret` header). After configure/env resolution, id, session, and styles typically come from **`POST /api/proj_auth`** (not always all publishable vars in `.env`). Terminal output uses **`chalk`** when styles resolve. Browser bundles that import `./server` get **`server.browser.ts`** (stub).
- **`AuraClient`** (browser-safe, `auralogger-cli/client`): uses the runtime **global `WebSocket`**, **no user secret**. Connects to **`/{project_id}/create_browser_logs`**. Configure via **`AuraClient.configure`** (often from **`NEXT_PUBLIC_AURALOGGER_*`** in app env). Local preview uses DevTools console styling when styles resolve; malformed config falls back to plain lines. Socket send uses browser-safe paths (no Node-only `ws.once.bind` patterns).

## CLI

- Entry: **`src/cli/bin/auralogger.ts`** → `loadCliEnvFiles()` then subcommands.
- **`init`**: `POST /api/proj_auth` with token-only `secret` header, **Step 2** shows publishable id/session/styles, then a **copy-paste dotenv block** (`NEXT_PUBLIC_*`, unprefixed trio, `AURALOGGER_PROJECT_TOKEN` + `AURALOGGER_USER_SECRET` when typed at prompt); snippets are **`Auralog`** (reads **`NEXT_PUBLIC_AURALOGGER_*`**) and **`AuraLog`** (`ensureConfigured` + **`AuraServer.configure(projectToken, userSecret)`**).
- Recommended invocation for apps: **`npx auralogger-cli …`** (project-scoped; see readme).

## Build

- **`package.json`**: `"build": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\" && tsc"` — always clean compile output.

## Contributing (quick)

1. Change **`src/`**; keep **`dev-docs/`** and **[`user-docs/`](../user-docs/)** in sync when behavior is user-visible.
2. **`npm run build`**
3. Exercise the CLI path you touched (`npx auralogger-cli …`).
