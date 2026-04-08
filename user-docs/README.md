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

- **Private vs publishable:** two server-side credentials exist: **`AURALOGGER_PROJECT_TOKEN`** and **`AURALOGGER_USER_SECRET`**. **`PROJECT_ID`**, **`PROJECT_SESSION`**, and **`PROJECT_STYLES`** are publishable; use **`NEXT_PUBLIC_*`** / **`VITE_*`** for anything that must reach the browser (see **[`environment.md`](environment.md)**).
- **`AuraServer`** (`auralogger-cli/server`, Node): needs **`AURALOGGER_PROJECT_TOKEN`** plus **`AURALOGGER_USER_SECRET`** for authenticated ingest calls that require both headers. `POST /api/proj_auth` is token-only (`secret` header). Id, session, and styles load from **`/api/proj_auth`**. Optional cwd `.env` load on first use; **`auralogger init`** prints a server-side **`AuraLog`** helper. Use **`auralogger get-logs`** (CLI) to query logs — not a class method.
- **`AuraClient`** (`auralogger-cli/client`): never uses **`AURALOGGER_USER_SECRET`**. The **`Auralog`** helper from **`auralogger init`** / **`readme.md`** reads **`NEXT_PUBLIC_AURALOGGER_PROJECT_ID`** (and optional session/styles) from your bundler. Styled browser console output when styles are set.

**Fire-and-forget:** `log()` schedules work with `setImmediate` / `setTimeout(0)` and returns right away; sockets use idle timers. The first server `log` after `configure` may await `proj_auth`. Use the **CLI** for `get-logs`.
