<!-- Generated: 2026-04-08 09:38:59 UTC -->
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
- **Then** the SDK may obtain id, session, and styles from **`POST /api/proj_auth`** without all four **`AURALOGGER_PROJECT_*`** variables present in `.env`
- **And** `proj_auth` uses token-only header `secret`
- **And** when the socket is ready, payloads go to **`/{project_id}/create_log`** with **`Authorization: Bearer <project token>`** and **`secret: <user secret>`** (see **`server-log.ts`**)

## Feature: browser logs (`AuraClient`)

### Scenario: native WebSocket only

- **Given** code runs in a browser (or any runtime with global **`WebSocket`**)
- **When** the user calls **`AuraClient.log(...)`**
- **Then** the implementation uses the standard **`WebSocket`** API (no Node **`ws`** package in the client graph)

### Scenario: browser ingest uses Bearer auth

- **Given** a resolvable **project id** (configure or **`NEXT_PUBLIC_*`** / **`VITE_*`** / unprefixed env per **`env-config.ts`**)
- **When** **`AuraClient.log`** opens a socket
- **Then** it targets **`/{project_id}/create_browser_logs`**
- **And** it authenticates with **`Authorization: Bearer <project token>`**
- **And** it does not send the user secret
- **And** payload shape matches server ingest expectations (type, message, session, **`created_at`**, optional location / data)

### Scenario: local preview tolerates bad style config

- **Given** **`styles`** / env styles are missing or invalid
- **When** **`AuraClient.log`** runs
- **Then** a plain fallback console line can still appear
- **And** socket behavior degrades gracefully (e.g. missing project id → error message, not opaque **`bind`** failures on wrong socket APIs)

## Feature: CLI

### Scenario: `init` produces token/user-secret + snippets

- **Given** the user runs **`auralogger init`**
- **When** the CLI authenticates via **`POST /api/proj_auth`**
- **Then** it prints **`AURALOGGER_PROJECT_TOKEN`** and **`AURALOGGER_USER_SECRET`** lines when they were not already in env
- **And** it shows publishable id / session / styles for copying into **`NEXT_PUBLIC_*`** / **`VITE_*`**
- **And** it prints **`Auralog`** (env-driven **`AuraClient.configure`**) and **`AuraLog`** (**`AuraServer.configure(projectToken, userSecret)`**) snippets for separate files

### Scenario: `server-check` hits authenticated ingest WS

- **Given** project id + project token + user secret in env
- **When** the user runs **`auralogger server-check`**
- **Then** it validates connectivity toward **`/{project_id}/create_log`** (authenticated)

### Scenario: `client-check` hits browser ingest WS

- **Given** the same shell expectations as **`server-check`** for project/session context (user secret is not sent on the browser socket)
- **When** the user runs **`auralogger client-check`**
- **Then** it opens **`/{project_id}/create_browser_logs`** with **`Authorization: Bearer <project token>`** (no user-secret header)

### Scenario: `test-serverlog` / `test-clientlog` smoke paths

- **Given** env appropriate to each command
- **When** the CLI runs the smoke command
- **Then** it sends multiple **`AuraServer.log`** or **`AuraClient.log`** payloads on the production code path and closes the socket
