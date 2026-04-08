<!-- Generated: 2026-04-08 09:38:59 UTC -->
# Routes map (HTTP + WebSocket)

Routes used by the Node CLI/SDK and where to update them.

## Base URLs

- **HTTP** (`/api/*`):
  - Env: **`AURALOGGER_API_URL`**
  - Code: **`src/utils/backend-origin.ts`** → **`resolveApiBaseUrl()`**
  - Default web origin: **`https://auralogger.com`** (see source for API host defaults)

- **WebSocket**:
  - Env: **`AURALOGGER_WS_URL`**
  - Code: **`src/utils/backend-origin.ts`** → **`resolveWsBaseUrl()`**
  - Default derives from hosted API origin (see **`DEFAULT_AURALOGGER_ORIGIN`** in source)

---

## HTTP routes in use

### `POST /api/proj_auth`

- **Used by:** **`auralogger init`**, **`AuraServer`** sync path (via shared fetch helpers in **`cli/services/init.ts`** and server log)
- **Purpose:** authenticate with project token; receive project id, session, styles
- **Header:** **`secret`** (project token from **`AURALOGGER_PROJECT_TOKEN`**)

### `POST /api/logs`

- **Used by:** **`auralogger get-logs`**
- **File:** **`src/cli/services/get-logs.ts`**
- **Purpose:** fetch logs with filter payload
- **Header:** **`secret`** + **`user_secret`**
- **Body:** `{ filters: [...] }`

---

## WebSocket routes in use

### `/{project_id}/create_log`

- **Used by:**
  - **`AuraServer`** (**`src/server/server-log.ts`**)
  - **`auralogger server-check`** (**`src/cli/services/server-check.ts`**)
  - **`auralogger test-serverlog`** (**`src/cli/services/test-logger.ts`**)
- **Auth:** authenticated
  - **`Authorization: Bearer <project token>`** (project token from **`AURALOGGER_PROJECT_TOKEN`**)
  - **`secret: <user secret>`** (user secret from **`AURALOGGER_USER_SECRET`**)

### `/{project_id}/create_browser_logs`

- **Used by:**
  - **`AuraClient`** (**`src/client/client-log.ts`**)
  - **`auralogger client-check`** (**`src/cli/services/client-check.ts`**)
  - **`auralogger test-clientlog`** (**`src/cli/services/test-logger.ts`**)
- **Auth:** authenticated
  - **`Authorization: Bearer <project token>`** (project token from **`AURALOGGER_PROJECT_TOKEN`**)

---

## When you change API or WS behavior

1. Update **`src/cli/services/*`**, **`src/server/*`**, or **`src/client/*`** as needed.
2. If bases change, update **`src/utils/backend-origin.ts`**.
3. Update **`dev-docs/routes.md`** (this file).
4. If user-visible, update **`user-docs/commands.md`**, **`user-docs/environment.md`**, and the **Detailed reference** section in **`readme.md`** if it is kept in sync.
