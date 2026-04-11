# File map (Node package)

“Where do I edit this?” — TypeScript under **`src/`** compiles to **`dist/`** (`tsconfig`: **`rootDir`**: `src`, **`outDir`**: `dist`).

**Feature-level flows (diagrams + credentials):** **[`feature-flows.md`](feature-flows.md)**.

---

## Published surfaces (`package.json`)

| Surface | `dist/` entry | `src/` source | Notes |
|---------|---------------|---------------|--------|
| Main package | `index.js` | `index.ts` / `index.browser.ts` | Browser build swaps **`server`** stub via `exports`. |
| **`auralogger-cli/client`** | `client.js` | `client.ts` | Re-exports **`AuraClient`** from **`client/client-log.ts`**. |
| **`auralogger-cli/server`** | `server.js` / `server.browser.js` | `server.ts` / `server.browser.ts` | Browser: stub server. |
| **`auralogger-cli/server-check`** | `server-check.js` | `server-check.ts` | Thin export → **`cli/services/server-check`**. |
| **`auralogger-cli/client-check`** | `client-check.js` | `client-check.ts` | Thin export → **`cli/services/client-check`**. |
| **`auralogger-cli/init`** | `init.js` (see note) | — | Declared in **`package.json`**; if **`src/init.ts`** is missing, align publish entry or add a barrel file. |
| **Bin** | `cli/bin/auralogger.js` | `cli/bin/auralogger.ts` | Command: **`auralogger`**. |

**Legacy / convenience:** **`src/client-log.ts`** — `clientlog()` helper + `closeClientlogSocket` wrapping **`AuraClient`**. **`src/client-log/client-log.ts`** re-exports from **`../client/client-log`** (compat shim).

---

## CLI binary

| File | Role |
|------|------|
| **`src/cli/bin/auralogger.ts`** | argv dispatch, **`KNOWN_COMMANDS`**, global **`main().catch`** + personality asides on fatal errors. |
| **`src/cli/bin/quiet-dotenv-first.ts`** | Imported first by the bin to silence dotenv noise before the rest of the CLI loads. |

---

## CLI services (`src/cli/services/`)

| File | Command / role |
|------|----------------|
| **`init.ts`** | **`init`**: prompts, **`fetchProjAuthConfig`**, dotenv block, **`Auralog` / `AuraLog`** snippets. Exports **`resolveProjectTokenForInit`**, **`resolveUserSecretForInit`**, **`fetchProjAuthConfig`**, **`resolveProjectContextForCliChecks`**. |
| **`get-logs.ts`** | **`get-logs`**: **`resolveGetLogsAuth`**, **`fetchLogsWithFallback`**, **`runGetLogsCore`**. |
| **`get-logs-filters.ts`** | Filter JSON shape + validation for **`POST …/logs`** body. |
| **`log-print.ts`** | Terminal line rendering (**`chalk`**) for log rows (`get-logs`, **`AuraServer`** local echo). |
| **`server-check.ts`** | **`server-check`**: **`resolveProjectContextForCliChecks`** + WS **`create_log`**. |
| **`client-check.ts`** | **`client-check`**: same auth resolution + WS **`create_browser_logs`**. |
| **`test-logger.ts`** | **`test-serverlog`**, **`test-clientlog`** batch smoke sends. |

---

## CLI utilities (`src/cli/utility/`)

| File | Role |
|------|------|
| **`cli-load-env.ts`** | **`loadCliEnvFiles(cwd)`** — `.env` / `.env.local` for CLI + **`AuraServer`** first use. |
| **`cli-tone.ts`** | **`printAside`**, **`maybePrintGenericSpice`**, etc. |
| **`cli-personality-state.ts`** | Command attempt/success counters for adaptive copy. |
| **`aside-pools.ts`** | Large const pools (asides, error templates, **`classifyErrorForAside`**). |
| **`parser.ts`** | **`parseCommand`**: **`get-logs`** argv → structured filters. |
| **`log-styles.ts`** | Style entries from **`proj_auth`**, **`resolveLogStyleSpec`** (shared with client imports). |

---

## SDK — server (`src/server/`)

| File | Role |
|------|------|
| **`server-log.ts`** | **`AuraServer`**: **`configure`**, **`syncFromSecret`**, **`proj_auth` hydration**, Node **`ws`** to **`/{proj_token}/create_log`**, **`Bearer` user secret**, idle socket close. |

---

## SDK — client (`src/client/`)

| File | Role |
|------|------|
| **`client-log.ts`** | **`AuraClient`**: **`configure(projectToken)`**, **`proj_auth`**, global **`WebSocket`**, **`create_browser_logs`**, idle close. |

---

## Root barrels (`src/`)

| File | Role |
|------|------|
| **`index.ts`**, **`index.browser.ts`** | Package entry; browser variant excludes full server. |
| **`client.ts`**, **`server.ts`**, **`server.browser.ts`** | Subpath exports for **`exports`** field. |
| **`server-check.ts`**, **`client-check.ts`** | Programmatic check entrypoints. |

---

## Shared utils (`src/utils/`)

| File | Role |
|------|------|
| **`backend-origin.ts`** | **`resolveApiBaseUrl`**, **`resolveWsBaseUrl`**, **`buildProjAuthUrl`**, **`buildProjectLogsUrl`**, defaults. Doc: **`api-urls.md`**. |
| **`env-config.ts`** | **`AURALOGGER_*`**, **`NEXT_PUBLIC_*`**, **`VITE_*`** readers; **`tryParseResolvedStyles`**, etc. |
| **`http-utils.ts`** | **`parseErrorBody`** for failed **`fetch`**. |
| **`socket-idle-close.ts`** | Default idle timeout constant for SDK sockets. |

---

## Doc maintenance

When you add a **`src/`** file that participates in HTTP/WS or a new command:

1. **[`file-map.md`](file-map.md)** (this file) — one row or bullet.
2. **[`feature-flows.md`](feature-flows.md)** — diagram or table row if the flow is new.
3. **[`routes.md`](routes.md)** — if the wire contract changes.
4. **[`bdd.md`](bdd.md)** — if user-visible behaviour changes.
