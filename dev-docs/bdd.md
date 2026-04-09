<!-- Generated: 2026-04-08 09:38:59 UTC -->

**Diagrams and file-level paths:** see **[`feature-flows.md`](feature-flows.md)**.

---

## Feature: server logs (`AuraServer`)

### Scenario: logs print locally

- **Given** the user calls **`AuraServer.log(type, message, location?, data?)`**
- **When** the deferred handler runs
- **Then** a log line is printed (styled in terminal when styles resolve; otherwise plain)
- **And** failures to reach the backend do not crash the process (errors surface as console messages / non-fatal paths)

### Scenario: streaming needs usable token + user-secret paths

- **Given** **`AURALOGGER_PROJECT_TOKEN`** or **`AURALOGGER_USER_SECRET`** is missing and **`AuraServer`** was not configured with usable values
- **When** the user calls **`AuraServer.log(...)`**
- **Then** logs still print locally where applicable
- **And** streaming does not succeed without both credentials on routes that require both (console-only or error messaging per implementation)

### Scenario: after configure, backend metadata can come from API

- **Given** a valid project token (**`configure(projectToken, userSecret?)`** or env) so **`proj_auth`** can run
- **When** the user calls **`AuraServer.log(...)`**
- **Then** the SDK may obtain id, session, and styles from **`POST /api/{project_token}/proj_auth`** without all publishable **`AURALOGGER_PROJECT_*`** variables present in `.env`
- **And** `proj_auth` sends the token in the **URL path** (URL-encoded), not a `secret` header
- **And** when the socket is ready, payloads go to **`/{proj_token}/create_log`** with **`Authorization: Bearer <user secret>`** only (see **`server-log.ts`**)

## Feature: browser logs (`AuraClient`)

### Scenario: native WebSocket only

- **Given** code runs in a browser (or any runtime with global **`WebSocket`**)
- **When** the user calls **`AuraClient.log(...)`**
- **Then** the implementation uses the standard **`WebSocket`** API (no Node **`ws`** package in the client graph)

### Scenario: configure is project-token only; runtime hydrates via proj_auth

- **Given** **`AuraClient.configure({ projectToken })`** was called with a non-empty token (often from **`NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`** / **`VITE_AURALOGGER_PROJECT_TOKEN`**)
- **When** the first log tries to open a socket or needs session/styles for console output
- **Then** the client may call **`POST /api/{project_token}/proj_auth`** once (single-flight) with the token in the path
- **And** project id, session, and styles are held in memory after a successful response
- **And** the ingest socket targets **`/{proj_token}/create_browser_logs`** where **`proj_token`** is the configured project token (**path-only auth**; no Bearer header on the socket)
- **And** it does not send the user secret
- **And** payload shape matches server ingest expectations (type, message, session, **`created_at`**, optional location / data)

### Scenario: local preview tolerates bad style config

- **Given** **`proj_auth`** styles are missing or malformed after hydration
- **When** **`AuraClient.log`** runs
- **Then** a plain fallback console line can still appear (per **`resolveLogStyleSpec`** / defaults)
- **And** socket behavior degrades gracefully (e.g. missing project id after failed `proj_auth` → error message, not opaque failures)

## Feature: CLI

### Scenario: `init` produces token/user-secret + snippets

- **Given** the user runs **`auralogger init`**
- **When** the CLI authenticates via **`POST /api/{project_token}/proj_auth`**
- **Then** it prints up to **five** dotenv lines when values are new: **`AURALOGGER_PROJECT_TOKEN`**, **`AURALOGGER_USER_SECRET`**, **`AURALOGGER_PROJECT_SESSION`**, **`NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`**, **`VITE_AURALOGGER_PROJECT_TOKEN`** (last two match the server token); lines already in env are omitted with a short note
- **And** it does **not** print project id or styles into `.env` (those hydrate via **`proj_auth`** at runtime)
- **And** it prints **`Auralog`** (**`AuraClient.configure({ projectToken })`**) and **`AuraLog`** (**`AuraServer.configure(projectToken, userSecret)`**) snippets for separate files

### Scenario: `server-check` hits authenticated ingest WS

- **Given** project id (from **`proj_auth`**) + project token + user secret resolved (env or prompt)
- **When** the user runs **`auralogger server-check`**
- **Then** it validates connectivity toward **`/{proj_token}/create_log`** with **`Authorization: Bearer <user secret>`**

### Scenario: `client-check` hits browser ingest WS

- **Given** project token + session (and id for messaging) resolved the same way as **`server-check`** (`resolveProjectContextForCliChecks`)
- **When** the user runs **`auralogger client-check`**
- **Then** it opens **`/{proj_token}/create_browser_logs`** with **no custom WebSocket headers** (path-only auth)

### Scenario: `test-serverlog` / `test-clientlog` smoke paths

- **Given** env appropriate to each command
- **When** the CLI runs the smoke command
- **Then** it sends multiple **`AuraServer.log`** or **`AuraClient.log`** payloads on the production code path and closes the socket
