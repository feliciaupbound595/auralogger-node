<!-- Generated: 2026-04-08 09:38:59 UTC -->
# Routes map (HTTP + WebSocket)

Routes used by the Node CLI/SDK and where to update them.

**End-to-end flows:** **[`feature-flows.md`](feature-flows.md)**.

## Base URLs

**Full guide (defaults, overrides, path rules, troubleshooting):** **[`api-urls.md`](api-urls.md)**.

Summary:

| Transport | Env | Code | Default (no env) |
|-----------|-----|------|------------------|
| **HTTP** `/api/*` | **`AURALOGGER_API_URL`** | **`resolveApiBaseUrl()`** | **`https://auralogger.com`** (`DEFAULT_AURALOGGER_WEB_ORIGIN`) |
| **WebSocket** ingest | **`AURALOGGER_WS_URL`** | **`resolveWsBaseUrl()`** | **`wss://api.auralogger.com`** (from `DEFAULT_AURALOGGER_ORIGIN` via `httpOriginToWsBase()`) |

All of the above lives in **`src/utils/backend-origin.ts`**. HTTP and WS defaults differ on purpose; overrides are independent.

---

## HTTP routes in use

### `POST /api/{project_token}/proj_auth`

- **Used by:** **`auralogger init`**, **`AuraServer`** hydration, **`AuraClient`** hydration (browser), shared **`fetchProjAuthConfig`** in **`cli/services/init.ts`**
- **Purpose:** authenticate with project token; receive project id, session, styles
- **Path:** **`project_token`** URL-encoded (ciphertext token). **No `secret` header.**
- **Helper:** **`buildProjAuthUrl(resolveApiBaseUrl(), token)`** in **`src/utils/backend-origin.ts`**
- **Base URL:** always **`resolveApiBaseUrl()`** (not the WebSocket base)

### `POST /api/{project_token}/logs`

- **Used by:** **`auralogger get-logs`**
- **File:** **`src/cli/services/get-logs.ts`**
- **Purpose:** fetch logs with filter payload
- **Path:** **`project_token`** URL-encoded (same ciphertext as **`AURALOGGER_PROJECT_TOKEN`**)
- **Header:** **`secret`** = **user secret** (`AURALOGGER_USER_SECRET`) — not the project token
- **Header (compat):** some backends still require **`user_secret`**; the CLI sends **both** headers with the same value.
- **Body:** `{ filters: [...] }`
- **Helper:** **`buildProjectLogsUrl(resolveApiBaseUrl(), token)`** in **`src/utils/backend-origin.ts`**

---

## WebSocket routes (this repo — Node package)

Implementation files: **`src/server/server-log.ts`**, **`src/client/client-log.ts`**, **`src/cli/services/server-check.ts`**, **`src/cli/services/client-check.ts`**.

### `WS /{proj_token}/create_log` (server ingest — `AuraServer`, `server-check`)

- **Path segment:** **project token** (ciphertext; same value as **`AURALOGGER_PROJECT_TOKEN`**), URL-encoded — matches backend **`normalize_ciphertext_path_token`** expectations.
- **Used by:**
  - **`AuraServer`** (**`src/server/server-log.ts`**)
  - **`auralogger server-check`** (**`src/cli/services/server-check.ts`**)
  - **`auralogger test-serverlog`** (**`src/cli/services/test-logger.ts`**)
- **Auth (Node `ws` client):** **`Authorization: Bearer <user_secret>`** only (value of **`AURALOGGER_USER_SECRET`**). No `secret` header on the socket.
- **Backend (infra):** normalize path token; require **`BACKEND_URL`** + **`proj_token`**; **`POST ${BACKEND_URL}/api/{quote(proj_token)}/ws_auth`** (path token only — no secret header); reject upgrade with policy **1008** on auth failure; **`websocket.accept()`** on success; if **`owner_key` / `iv`** missing or decrypt fails after accept, **`close(1008, reason)`**.
- **Message (infra):** Parse JSON per frame; require **`type`**, **`session`**, **`created_at`**; encrypt a JSON envelope with AES-GCM (12-byte nonce): **`message`** = base64(ciphertext||tag), **`data`** = **`null`**, **`iv`** = base64(nonce); then **`save_to_redis`** ( **`project_id`** from **`ws_auth`**). **This package** still sends a **plain JSON log object** from **`server-log.ts`** / **`server-check.ts`** until client-side encryption lands — coordinate with your backend if you require the envelope on the wire.

### `WS /{proj_token}/create_browser_logs` (browser ingest — `AuraClient`, `client-check`)

- **Path segment:** **project token** (same string as **`AURALOGGER_PROJECT_TOKEN`** / what you pass to **`AuraClient.configure(projectToken )`**).
- **Used by:**
  - **`AuraClient`** (**`src/client/client-log.ts`**)
  - **`auralogger client-check`** (**`src/cli/services/client-check.ts`**)
  - **`auralogger test-clientlog`** (**`src/cli/services/test-logger.ts`**)
- **Auth:** **path only** — no custom WebSocket headers; standard **`new WebSocket(url)`**.
- **Backend (infra):** same **`ws_auth`** pattern as **`create_log`** (reject upgrade on failure); if **`project_id`** from auth is missing after accept, **`close(1008, reason)`**.
- **Message (infra):** Plain JSON log; validate **`type`**, **`session`**, **`created_at`**; **`save_to_redis`** (no AES envelope on this route). Matches **`AuraClient`** / **`client-check`** today.

---

## Backend contract vs this package

**[`docs/bdd/apidocs.md`](../docs/bdd/apidocs.md)** documents HTTP + high-level WebSocket expectations. **`server-log.ts`** / **`server-check.ts`** in this branch match **`/{proj_token}/create_log`** + Bearer **`user_secret`**, and **`AuraClient`** / **`client-check`** match **`/{proj_token}/create_browser_logs`** (path-only).

---

## When you change API or WS behavior

1. Update **`src/cli/services/*`**, **`src/server/*`**, or **`src/client/*`** as needed.
2. If bases change, update **`src/utils/backend-origin.ts`**.
3. Update **`dev-docs/routes.md`** (this file) and **`dev-docs/api-urls.md`** if base URL behaviour or defaults change.
4. If user-visible, update **`user-docs/commands.md`**, **`user-docs/environment.md`**, **`dev-docs/bdd.md`**, and the **Detailed reference** section in **`readme.md`**.
