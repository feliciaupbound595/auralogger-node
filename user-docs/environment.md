# Environment variables

*The filing cabinet: one locked drawer for the **secret**, three labeled folders you can safely show the browser (if you’re careful how). Names below are not suggestions — they’re the keys the CLI and SDK actually read.*

Two classes of values:

- **Private** — exactly **`AURALOGGER_PROJECT_SECRET`**. This is the only credential. It becomes the HTTP header **`secret`** on authenticated calls and must **never** appear in browser bundles, public repos, or `NEXT_PUBLIC_*` / `VITE_*` keys.
- **Publishable** — **`project_id`**, **`session`**, and **`styles`** (the three non-secret fields from `auralogger init`). They are not API secrets. You still choose **where** they live: server-only `.env` vs client-visible env keys for frontends.

The CLI and **`AuraServer`** need the **secret** plus those three for full streaming. **`AuraClient`** uses **only** the publishable three (via env as your bundler exposes them).

---

## Private variable (exact name)

| Variable | Who uses it | Notes |
|----------|-------------|--------|
| `AURALOGGER_PROJECT_SECRET` | CLI (`init`, `get-logs`, checks), **`AuraServer`**, any code that calls authenticated HTTP or `create_log` WebSocket | **Server-side / CI secrets only.** Not read by **`AuraClient`**. There are no aliases (e.g. `AURALOGGER_SECRET_KEY` is **not** supported). |

---

## Publishable variables (exact base names)

These identify the project and style logs. They are **not** the project secret.

| Role | Primary env keys (Node / server `.env`) | In client bundles (must be exposed by the framework) |
|------|----------------------------------------|--------------------------------------------------------|
| Project id | `AURALOGGER_PROJECT_ID` | `NEXT_PUBLIC_AURALOGGER_PROJECT_ID` (Next.js) or `VITE_AURALOGGER_PROJECT_ID` (Vite); unprefixed still works on server |
| Session | `AURALOGGER_PROJECT_SESSION` | `NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION` or `VITE_AURALOGGER_PROJECT_SESSION` |
| Styles (single-line JSON array) | `AURALOGGER_PROJECT_STYLES` | `NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES` or `VITE_AURALOGGER_PROJECT_STYLES` |

Resolution order for each publishable field is: **`NEXT_PUBLIC_*`**, then **`VITE_*`**, then unprefixed `AURALOGGER_PROJECT_*` (see `init` output — it prints both prefixed and unprefixed lines for convenience).

---

## Who loads what

**`AuraClient` (browser):** reads **`process.env`** only, for the **publishable** keys above (typically the `NEXT_PUBLIC_*` or `VITE_*` names your bundler inlines). No `.env` file reads in the browser.

**`AuraServer` (Node):** reads **`process.env`**; on first `AuraServer.log` or `syncFromSecret` it may **once** load **`.env`** and **`.env.local`** from **`process.cwd()`** (Node only). The **secret** must only exist in environments you treat as private.

**CLI:** loads **`.env`** / **`.env.local`** from cwd before each command.

---

## Getting values

*Same script **`init`** narrates in the terminal — this is the static version for bookmarking.*

1. Run **`auralogger init`**.
2. If **`AURALOGGER_PROJECT_SECRET`** is unset, the CLI prompts for it.
3. The CLI shows a human-readable **Step 2** trio (id, session, styles), then a **copy-paste dotenv block** with `NEXT_PUBLIC_*` and unprefixed publishable keys (and `AURALOGGER_PROJECT_SECRET` when you typed the secret at the prompt — omitted if it was already in the environment). Then it prints two snippets (**separate files**): **`Auralog`** (browser / frontend: reads **`NEXT_PUBLIC_AURALOGGER_*`** via `AuraClient.configure`, no secret) vs **`AuraLog`** (server / backend / CLI, reads **`AURALOGGER_PROJECT_SECRET`** from env). For Vite, duplicate the same values under `VITE_*` names (see the example block below).
4. Put the **secret** in server-side env (`.env` gitignored, host secret store, CI secrets). Put the **publishable** id, session, and styles into **`NEXT_PUBLIC_*`** / **`VITE_*`** for the browser helper (same logical values as Step 2 / **`auralogger init`** display).

**`await AuraServer.syncFromSecret(secret)`** (Node) can fill id, session, and styles **in memory** from the API without storing them in `.env`.

---

## Example layout (fake values)

*Plastic demo props — your real **`STYLES`** line will be long; copy from **`auralogger init`**, don’t improvise JSON by hand unless you like papercuts.*

**Server-only fragment** (e.g. `.env` — keep **`AURALOGGER_PROJECT_SECRET`** out of any file that ships to clients):

```env
# PRIVATE — never expose to browser bundles or public repos
AURALOGGER_PROJECT_SECRET="your-secret-here"

# Publishable — fine on the server; same values can appear as NEXT_PUBLIC_* / VITE_* for the client
AURALOGGER_PROJECT_ID="proj_example_123"
AURALOGGER_PROJECT_SESSION="session-token-here"
AURALOGGER_PROJECT_STYLES="[{\"default\":{\"icon\":\"🗒️\"}}]"
```

**Browser / Vite / Next client env** should use **only** the prefixed lines from `init` (no `AURALOGGER_PROJECT_SECRET`):

```env
NEXT_PUBLIC_AURALOGGER_PROJECT_ID="proj_example_123"
NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION="session-token-here"
NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES="[{\"default\":{\"icon\":\"🗒️\"}}]"
```

(Or the `VITE_*` equivalents.) Real **`STYLES`** values are much longer; always copy from **`auralogger init`**.

---

## Commands vs runtime

| Context | Private secret | Publishable three |
|---------|----------------|-------------------|
| **`auralogger init`** | Optional in env, else prompt | Step 2 trio + copy-paste dotenv lines after auth |
| **`auralogger server-check`** | Required in env | Project id required (session/styles not required for the check itself) |
| **`auralogger client-check`** | Required (validates same shell as **`server-check`**; not sent on the WS) | Project id + session (same as **`server-check`**) |
| **`auralogger get-logs`** | Required in env or at prompt | **`STYLES`** optional in env: if unset, CLI fetches them via **`proj_auth`** (same as **`init`**) for this run; use **`auralogger init`** to persist copy-paste lines |
| **`AuraServer`** | Required (`configure` / env / `syncFromSecret`) | Loaded from **`proj_auth`** after secret (not required in `.env`) |
| **`AuraClient`** | **Never** | Id required; session/styles optional with fallbacks |

---

## Troubleshooting

*When the universe says “no” — usually cwd, JSON, or a shy secret.*

- **`server-check` / variable missing** — Run from the directory that contains your `.env`, or export vars in the shell (`process.cwd()`).
- **Styles errors** — Value must be valid JSON array string; refresh from **`auralogger init`**.
- **`AuraServer` console-only** — Ensure **`AURALOGGER_PROJECT_SECRET`** (or call **`syncFromSecret` / `configure`**) so **`proj_auth`** can run; the **`AuraLog`** helper reads the secret from env once.
- **Client bundle + `ws`** — Use **`auralogger-cli/client`**; the package maps **`./server`** to a browser stub so `ws` is not pulled in for `AuraServer` imports on the client.

### Advanced overrides (contributors / self-hosted backends)

HTTP and WebSocket **base URL** overrides are documented for maintainers in **`dev-docs/routes.md`** (not required for normal use of hosted Auralogger).
