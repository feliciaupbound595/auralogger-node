# CLI command reference

*Short and bossy: what each subcommand does, how to spell **`get-logs`** filters, and copy-paste examples. For vibes + full tour, **[`readme.md`](../readme.md)**; for env spellings, **[`environment.md`](environment.md)**.*

The full **getting started** story (install, [auralogger.com](https://auralogger.com), environment variables, and code examples) is in **[`readme.md`](../readme.md)**. Variable details: **[`environment.md`](environment.md)**.

This page is only the **command cheat sheet** for quick lookup.

## Invocation

```bash
auralogger <command> [arguments...]
```

## Commands (no flags except filter tokens on `get-logs`)

| Command | Args | Purpose |
|---------|------|---------|
| `init` | — | Auth with **secret**; **copy-paste dotenv block** with `NEXT_PUBLIC_*`, unprefixed publishable keys, and `AURALOGGER_PROJECT_SECRET` when you typed it at the prompt (omitted if already in env); two snippets (**`Auralog`** + **`AuraLog`**). Vite: duplicate values as `VITE_*` (see **`user-docs/environment.md`**). |
| `server-check` | — | Test WebSocket connectivity (needs project id + secret in env). |
| `client-check` | — | Same env as **`server-check`** (id + secret + session); opens **`create_browser_logs`** (no secret on the socket, like **`AuraClient`**). |
| `test-serverlog` | — | Send 5 logs via `AuraServer.log` (production path), then close. |
| `test-clientlog` | — | Send 5 logs via `AuraClient.log` (production path), then close. |
| `get-logs` | `[filters...]` | Fetch and print logs; filters use grammar below. If **`AURALOGGER_PROJECT_STYLES`** (or public equivalents) is missing, runs the same **`proj_auth`** fetch as **`init`** and styles logs from the response (prompts for secret when needed). |

**Paging:** each run performs **one** `POST /api/logs` and prints that response — **no** built-in multi-page loop. Use **`-maxcount`** (capped at **100** in the CLI) and **`-skip`**; run the command again (or script it) for the next page.

## `get-logs` filter grammar

*Looks like flags, tastes like JSON — **`maxcount`** / **`skip`** want numbers; almost everything else wants arrays.*

```text
-<field> [--<operator>] <json-value>
```

- **`maxcount`**, **`skip`**: value is a JSON **number**.
- **All other fields**: value is a JSON **array**.

### Fields

| Field | Operators | Default op |
|-------|-----------|------------|
| `type` | `in`, `not-in` | `in` |
| `message` | `contains`, `not-contains` | `contains` |
| `location` | `in`, `not-in` | `in` |
| `time` | `since`, `from-to` | `since` |
| `order` | `eq` | `eq` |
| `maxcount` | `eq` | `eq` |
| `skip` | `eq` | `eq` |
| `data.<path>` | `eq` | `eq` |

### Examples

```bash
auralogger get-logs -type '["error","warn"]' -maxcount 50
auralogger get-logs -message '["timeout"]' -skip 20 -maxcount 30
auralogger get-logs -type --not-in '["info","debug"]' -time --since '["10m"]'
auralogger get-logs -data.userId '["06431f39-55e2-4289-80c8-5d0340a8b66e"]'
```

## Environment

See **[`environment.md`](environment.md)** for the required variables and how to inject them.
