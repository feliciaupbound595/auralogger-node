<!-- Generated: 2026-04-08 09:38:59 UTC -->
# Environment variables

*The filing cabinet: two private server creds, plus client/runtime fields that can be derived. Names below are not suggestions — they’re the keys the CLI and SDK actually read.*

Two classes of values:

- **Private / auth** — **`AURALOGGER_PROJECT_TOKEN`** and **`AURALOGGER_USER_SECRET`**.
  - Project token: **path** for **`POST /api/{project_token}/proj_auth`**, **`POST /api/{project_token}/logs`** (**`get-logs`**), **`/{proj_token}/create_log`**, and **`/{proj_token}/create_browser_logs`** (URL-encoded ciphertext).
  - User secret: **`Authorization: Bearer …`** on **`/{proj_token}/create_log`** (`AuraServer`, **`server-check`**); header **`secret`** on **`POST /api/{project_token}/logs`** (**`get-logs`**). Some deployments still require a **`user_secret`** header too; the CLI sends both. Never sent on browser **`create_browser_logs`**.
  Never expose **`AURALOGGER_USER_SECRET`** in browser bundles, public repos, or `NEXT_PUBLIC_*` / `VITE_*` keys.
- **Publishable** — **`project_id`**, **`session`**, and **`styles`** (the three non-secret fields from `auralogger init`). They are not API secrets. You still choose **where** they live: server-only `.env` vs client-visible env keys for frontends.

The CLI and **`AuraServer`** need both private creds for server-side operations. **`AuraClient`** now needs only a **project token** and hydrates project id/session/styles via `proj_auth`; it never reads `AURALOGGER_USER_SECRET`.

---

## Private variable (exact name)

| Variable | Who uses it | Notes |
|----------|-------------|--------|
| `AURALOGGER_PROJECT_TOKEN` | CLI (`init`, `get-logs`, checks), **`AuraServer`**, **`AuraClient`** | Path token for `proj_auth`, **`get-logs`** (`/api/{token}/logs`), `create_log`, and `create_browser_logs`. CLI also accepts **`NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`** or **`VITE_AURALOGGER_PROJECT_TOKEN`**. |
| `AURALOGGER_USER_SECRET` | CLI (`init`, `get-logs`, checks), **`AuraServer`**, **`server-check`** | **Server-side only.** `Authorization: Bearer` on **`/{proj_token}/create_log`**; on **`get-logs`**, header **`secret`** for **`POST /api/{project_token}/logs`**. Never exposed to **`AuraClient`**. |

---

## Publishable variables (exact base names)

These identify the project and style logs. They are **not** private credentials.

| Role | Primary env keys (Node / server `.env`) | In client bundles (must be exposed by the framework) |
|------|----------------------------------------|--------------------------------------------------------|
| Project id | `AURALOGGER_PROJECT_ID` | `NEXT_PUBLIC_AURALOGGER_PROJECT_ID` (Next.js) or `VITE_AURALOGGER_PROJECT_ID` (Vite); unprefixed still works on server |
| Session | `AURALOGGER_PROJECT_SESSION` | `NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION` or `VITE_AURALOGGER_PROJECT_SESSION` |
| Styles (single-line JSON array) | `AURALOGGER_PROJECT_STYLES` | `NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES` or `VITE_AURALOGGER_PROJECT_STYLES` |

Resolution order for each publishable field is: **`NEXT_PUBLIC_*`**, then **`VITE_*`**, then unprefixed `AURALOGGER_PROJECT_*`. **`auralogger init`** prints **session** plus the three token env names and **`AURALOGGER_USER_SECRET`** (see **`readme.md`**); it does **not** print project id or styles — add those manually only if you want static CLI styling without a per-run `proj_auth` fetch.

---

## Who loads what

**`AuraClient` (browser):** reads the project token you pass to `AuraClient.configure({ projectToken })` (often from `NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN` / `VITE_AURALOGGER_PROJECT_TOKEN`), then hydrates through `POST /api/{project_token}/proj_auth` (token in path). No `.env` file reads in the browser.

**`AuraServer` (Node):** reads **`process.env`**; on first `AuraServer.log` or `syncFromSecret` it may **once** load **`.env`** and **`.env.local`** from **`process.cwd()`** (Node only). Private creds must only exist in environments you treat as private.

**CLI:** loads **`.env`** / **`.env.local`** from cwd before each command.

---

## Getting values

*Same script **`init`** narrates in the terminal — this is the static version for bookmarking.*

1. Run **`auralogger init`** — short banner first, then prompts.
2. If the project token, **`AURALOGGER_USER_SECRET`**, or session is unset, the CLI prompts or fetches as needed.
3. After **`proj_auth`**, it shows the **live session** and up to **five** dotenv lines (server token, user secret, **`AURALOGGER_PROJECT_SESSION`**, **`NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`**, **`VITE_AURALOGGER_PROJECT_TOKEN`** — each omitted if already in env), then two snippets (**separate files**): **`Auralog`** vs **`AuraLog`**.
4. Put private creds in server-side env (`.env` gitignored, host secret store, CI secrets). For browser usage, expose the project token via **`NEXT_PUBLIC_*`** or **`VITE_*`** and keep user secret server-only.

**`await AuraServer.syncFromSecret(projectToken, userSecret?)`** (Node) can fill id, session, and styles **in memory** from the API without storing publishable values in `.env`.

---

## Example layout (fake values)

*Plastic demo props — if you add **`STYLES`** manually, use valid JSON; **`auralogger init`** no longer prints id/styles lines.*

**Typical `.env` fragment** (keep user secret out of client bundles):

```env
# PRIVATE — never expose to browser bundles or public repos
AURALOGGER_PROJECT_TOKEN="your-project-token"
AURALOGGER_USER_SECRET="your-user-secret"

AURALOGGER_PROJECT_SESSION="session-token-here"
NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN="your-project-token"
VITE_AURALOGGER_PROJECT_TOKEN="your-project-token"
```

(**`auralogger init`** prints this shape when all values are new.) Optionally add id/styles keys (see table above) if you want them fixed in `.env` for the CLI.

---

## Commands vs runtime

| Context | Private creds | Publishable three |
|---------|----------------|-------------------|
| **`auralogger init`** | Optional in env, else prompt | Banner → prompts → session summary + up to five dotenv lines after auth |
| **`auralogger server-check`** | Project token + user secret in env | Project id required (session/styles not required for the check itself) |
| **`auralogger client-check`** | Project token + user secret resolved like `server-check` (user secret not sent on WS) | Opens `/{proj_token}/create_browser_logs` (path-only); session in payload; id from `proj_auth` for messages |
| **`auralogger get-logs`** | Project token + user secret required in env or prompt | **`STYLES`** optional in env: if unset, CLI fetches them via **`proj_auth`** for this run |
| **`AuraServer`** | Required (`configure` / env / `syncFromSecret`) | Loaded from **`proj_auth`** after token auth (not required in `.env`) |
| **`AuraClient`** | Browser: project token only; never user secret. | Id/session/styles auto-hydrated via `proj_auth` |

---

## Troubleshooting

*When the universe says “no” — usually cwd, JSON, or missing private creds.*

- **`server-check` / variable missing** — Run from the directory that contains your `.env`, or export vars in the shell (`process.cwd()`).
- **Styles errors** — Value must be valid JSON array string; fix the env value or remove it so **`get-logs`** can fetch styles via **`proj_auth`**.
- **`AuraServer` console-only** — Ensure **`AURALOGGER_PROJECT_TOKEN`** and **`AURALOGGER_USER_SECRET`** (or call **`syncFromSecret` / `configure`**) so auth + ingest can run; `proj_auth` uses the token in the URL path.
- **Client bundle + `ws`** — Use **`auralogger-cli/client`**; the package maps **`./server`** to a browser stub so `ws` is not pulled in for `AuraServer` imports on the client.

### Advanced overrides (contributors / self-hosted backends)

HTTP and WebSocket **base URL** overrides are documented for maintainers in **`dev-docs/routes.md`** (not required for normal use of hosted Auralogger).
