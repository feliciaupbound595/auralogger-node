<!-- Generated: 2026-04-08 09:38:59 UTC -->
# Environment variables

*The filing cabinet: two locked drawers for private creds, plus three labeled folders you can safely show the browser (if you’re careful how). Names below are not suggestions — they’re the keys the CLI and SDK actually read.*

Two classes of values:

- **Private** — **`AURALOGGER_PROJECT_TOKEN`** and **`AURALOGGER_USER_SECRET`**.
  - Project token is sent as **`Authorization: Bearer <project token>`** for authenticated WebSockets.
  - User secret is sent as header **`secret: <user secret>`** on `create_log`.
  - `POST /api/proj_auth` remains token-only via header **`secret`**.
  Do not expose either one in browser bundles, public repos, or `NEXT_PUBLIC_*` / `VITE_*` keys.
- **Publishable** — **`project_id`**, **`session`**, and **`styles`** (the three non-secret fields from `auralogger init`). They are not API secrets. You still choose **where** they live: server-only `.env` vs client-visible env keys for frontends.

The CLI and **`AuraServer`** need private creds plus those three for full streaming. **`AuraClient`** uses **only** the publishable three (via env as your bundler exposes them), and never reads `AURALOGGER_USER_SECRET`.

---

## Private variable (exact name)

| Variable | Who uses it | Notes |
|----------|-------------|--------|
| `AURALOGGER_PROJECT_TOKEN` | CLI (`init`, `get-logs`, checks), **`AuraServer`**, any code that calls authenticated HTTP or WebSockets | **Server-side / CI secrets only.** Sent on WebSockets as `Authorization: Bearer ...`. Still used for `POST /api/proj_auth` as header `secret`. |
| `AURALOGGER_USER_SECRET` | CLI (`init`, `get-logs`, checks), **`AuraServer`**, routes/sockets that require a user secret | **Server-side / CI secrets only.** Sent on `create_log` as header `secret: <user secret>`. Never exposed to **`AuraClient`**. |

---

## Publishable variables (exact base names)

These identify the project and style logs. They are **not** private credentials.

| Role | Primary env keys (Node / server `.env`) | In client bundles (must be exposed by the framework) |
|------|----------------------------------------|--------------------------------------------------------|
| Project id | `AURALOGGER_PROJECT_ID` | `NEXT_PUBLIC_AURALOGGER_PROJECT_ID` (Next.js) or `VITE_AURALOGGER_PROJECT_ID` (Vite); unprefixed still works on server |
| Session | `AURALOGGER_PROJECT_SESSION` | `NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION` or `VITE_AURALOGGER_PROJECT_SESSION` |
| Styles (single-line JSON array) | `AURALOGGER_PROJECT_STYLES` | `NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES` or `VITE_AURALOGGER_PROJECT_STYLES` |

Resolution order for each publishable field is: **`NEXT_PUBLIC_*`**, then **`VITE_*`**, then unprefixed `AURALOGGER_PROJECT_*` (see `init` output — it prints both prefixed and unprefixed lines for convenience).

---

## Who loads what

**`AuraClient` (browser):** reads **`process.env`** only, for the **publishable** keys above (typically the `NEXT_PUBLIC_*` or `VITE_*` names your bundler inlines). No `.env` file reads in the browser.

**`AuraServer` (Node):** reads **`process.env`**; on first `AuraServer.log` or `syncFromSecret` it may **once** load **`.env`** and **`.env.local`** from **`process.cwd()`** (Node only). Private creds must only exist in environments you treat as private.

**CLI:** loads **`.env`** / **`.env.local`** from cwd before each command.

---

## Getting values

*Same script **`init`** narrates in the terminal — this is the static version for bookmarking.*

1. Run **`auralogger init`**.
2. If **`AURALOGGER_PROJECT_TOKEN`** or **`AURALOGGER_USER_SECRET`** is unset, the CLI prompts for missing values.
3. The CLI shows a human-readable **Step 2** trio (id, session, styles), then a **copy-paste dotenv block** with `NEXT_PUBLIC_*`, unprefixed publishable keys, and private lines (`AURALOGGER_PROJECT_TOKEN`, `AURALOGGER_USER_SECRET`) when entered at prompt. Then it prints two snippets (**separate files**): **`Auralog`** (browser / frontend: reads **`NEXT_PUBLIC_AURALOGGER_*`**) vs **`AuraLog`** (server / backend / CLI, reads token + user secret from env). For Vite, duplicate publishable values under `VITE_*` names.
4. Put private creds in server-side env (`.env` gitignored, host secret store, CI secrets). Put publishable id/session/styles into **`NEXT_PUBLIC_*`** / **`VITE_*`** for the browser helper.

**`await AuraServer.syncFromSecret(projectToken, userSecret?)`** (Node) can fill id, session, and styles **in memory** from the API without storing publishable values in `.env`.

---

## Example layout (fake values)

*Plastic demo props — your real **`STYLES`** line will be long; copy from **`auralogger init`**, don’t improvise JSON by hand unless you like papercuts.*

**Server-only fragment** (e.g. `.env` — keep private creds out of any file that ships to clients):

```env
# PRIVATE — never expose to browser bundles or public repos
AURALOGGER_PROJECT_TOKEN="your-project-token"
AURALOGGER_USER_SECRET="your-user-secret"

# Publishable — fine on the server; same values can appear as NEXT_PUBLIC_* / VITE_* for the client
AURALOGGER_PROJECT_ID="proj_example_123"
AURALOGGER_PROJECT_SESSION="session-token-here"
AURALOGGER_PROJECT_STYLES="[{\"default\":{\"icon\":\"🗒️\"}}]"
```

**Browser / Vite / Next client env** should use **only** the prefixed publishable lines from `init` (no private creds):

```env
NEXT_PUBLIC_AURALOGGER_PROJECT_ID="proj_example_123"
NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION="session-token-here"
NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES="[{\"default\":{\"icon\":\"🗒️\"}}]"
```

(Or the `VITE_*` equivalents.) Real **`STYLES`** values are much longer; always copy from **`auralogger init`**.

---

## Commands vs runtime

| Context | Private creds | Publishable three |
|---------|----------------|-------------------|
| **`auralogger init`** | Optional in env, else prompt | Step 2 trio + copy-paste dotenv lines after auth |
| **`auralogger server-check`** | Project token + user secret in env | Project id required (session/styles not required for the check itself) |
| **`auralogger client-check`** | Uses project token for `Authorization: Bearer ...` on `create_browser_logs` | Project id + session (same as **`server-check`**) |
| **`auralogger get-logs`** | Project token + user secret required in env or prompt | **`STYLES`** optional in env: if unset, CLI fetches them via **`proj_auth`** (same as **`init`**) for this run; use **`auralogger init`** to persist copy-paste lines |
| **`AuraServer`** | Required (`configure` / env / `syncFromSecret`) | Loaded from **`proj_auth`** after token auth (not required in `.env`) |
| **`AuraClient`** | Browser: **never**. Node (using `ws`): requires project token for WS auth. | Id required; session/styles optional with fallbacks |

---

## Troubleshooting

*When the universe says “no” — usually cwd, JSON, or missing private creds.*

- **`server-check` / variable missing** — Run from the directory that contains your `.env`, or export vars in the shell (`process.cwd()`).
- **Styles errors** — Value must be valid JSON array string; refresh from **`auralogger init`**.
- **`AuraServer` console-only** — Ensure **`AURALOGGER_PROJECT_TOKEN`** and **`AURALOGGER_USER_SECRET`** (or call **`syncFromSecret` / `configure`**) so auth + ingest can run; `proj_auth` itself remains token-only (`secret` header).
- **Client bundle + `ws`** — Use **`auralogger-cli/client`**; the package maps **`./server`** to a browser stub so `ws` is not pulled in for `AuraServer` imports on the client.

### Advanced overrides (contributors / self-hosted backends)

HTTP and WebSocket **base URL** overrides are documented for maintainers in **`dev-docs/routes.md`** (not required for normal use of hosted Auralogger).
