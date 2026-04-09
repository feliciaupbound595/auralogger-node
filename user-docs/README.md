# User docs (detailed reference)

*`readme.md` is the lobby with the personality; this folder is the quiet reading room with the same facts, fewer jokes.*

`readme.md` is the quick start.

This folder is the **full reference** for when you need exact variable names, command syntax, and every option.

**All docs (index):** **[`../docs/README.md`](../docs/README.md)**

## Choose what you need

- **Environment variables (exact names, examples, troubleshooting)**: **[`environment.md`](environment.md)**
- **CLI command reference (all commands + `get-logs` filter grammar)**: **[`commands.md`](commands.md)**

## SDK behavior notes

*TL;DR before you dive into the tables.*

- **Private vs publishable:** **`AURALOGGER_USER_SECRET`** is server-only. **`AURALOGGER_PROJECT_TOKEN`** is private on the server/CLI but is also the **only** client input for **`AuraClient`** (often `NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN` / `VITE_*`). **`auralogger init`** prints **session** plus token variants; **`PROJECT_ID`** and **`PROJECT_STYLES`** are optional in `.env` for CLI styling — **`AuraClient`** can omit them if `proj_auth` supplies them (see **[`environment.md`](environment.md)**).
- **`AuraServer`** (`auralogger-cli/server`, Node): needs **`AURALOGGER_PROJECT_TOKEN`** plus **`AURALOGGER_USER_SECRET`**. Server ingest WebSocket: **`/{proj_token}/create_log`** with **`Authorization: Bearer <user_secret>`** (see **`dev-docs/routes.md`**). Hydration: **`POST /api/{project_token}/proj_auth`** (token in path). Optional cwd `.env` load on first use; **`auralogger init`** prints a server-side **`AuraLog`** helper. Use **`auralogger get-logs`** (CLI) to query logs — not a class method.
- **`AuraClient`** (`auralogger-cli/client`): never uses **`AURALOGGER_USER_SECRET`**. The **`Auralog`** helper from **`auralogger init`** / **`readme.md`** reads a project token (commonly `NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`) and hydrates id/session/styles internally via `proj_auth`.

**Fire-and-forget:** `log()` schedules work with `setImmediate` / `setTimeout(0)` and returns right away; sockets use idle timers. The first server `log` after `configure` may await `proj_auth`. Use the **CLI** for `get-logs`.
