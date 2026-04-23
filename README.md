# Auralogger for Node.js (SDK + CLI)

 a real-time logging and observability SDK and CLI for streaming, storing, searching, and filtering application logs—beautifully visualized and accessible anywhere in the world across terminal, web, and any screen.

---

## Quick start (copy/paste)

Run CLI commands from the directory that contains your `.env` / `.env.local` (or where `AURALOGGER_PROJECT_*` is set in your shell/CI). The CLI loads `.env` files from the **current working directory** — *i.e. `cd` into the app before you heroically type `npx`.*

**Prefer `npx`** so the CLI runs in **this project’s context** with the version you expect — Auralogger is **project-scoped** (tokens + publishable ids per app), not a “install once globally and forget which repo you’re in” kind of tool.

### 1) Add the package

```bash
npm install auralogger-cli
```

and  you can look up commands at

```bash
npx auralogger-cli --help
```

### 2) Run init (private creds + client snippet)

*Origin story time: you’ll get **private** credentials from [https://auralogger.com](https://auralogger.com), paste them here and you get two snippets — **Auralog** (browser: **project token** only + internal `proj_auth`; never user secret) and **AuraLog** (server: token + user secret). Different files, different job descriptions.*

Run this in your app repo (where your `.env` should live):

```bash
npx auralogger-cli init
```

After `**npm install auralogger-cli**` in this repo, `npx` can run the **local** CLI binary by name (same tool, pinned to your lockfile):

```bash
npx auralogger init
```

`**auralogger init**` opens with a short banner, prompts for any missing creds, then shows the **current session** from `proj_auth` and a **five-line-style copy-paste block** when values are new: `AURALOGGER_PROJECT_TOKEN`, `AURALOGGER_USER_SECRET`, `AURALOGGER_PROJECT_SESSION`, `NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`, and `VITE_AURALOGGER_PROJECT_TOKEN` (the last two match the server token). It does **not** print project id or styles into `.env` — those hydrate via `proj_auth`. Then two snippets in **different files**: `**Auralog`** and `**AuraLog`**. Variable details: `**[user-docs/environment.md](user-docs/environment.md)`**.

### 3) Sanity-check connectivity

*Before you wire helpers everywhere: confirm the pipes actually connect. Less “mystery meat,” more “we tested this lane.”*

```bash
npx auralogger-cli server-check
npx auralogger-cli client-check
```

After `**npm install**` in this project:

```bash
npx auralogger server-check
npx auralogger client-check
```

`**client-check**` resolves the same project/session context as `**server-check**`, but opens `**create_browser_logs**` with no auth header, like `**AuraClient**` in the browser.

### 4) Send logs from code

Run `**auralogger init**` and paste what it prints, or copy the shapes below.

**Encryption is optional per project.** If your project has **no encryption enabled**, you can use **one centralized logger** (token only) and skip the client/server split entirely. If your project **is encrypted**, keep the split: `**Auralog**` (browser) vs `**AuraLog**` (server).

#### No encryption (recommended first): one import everywhere

Save as e.g. `src/lib/auralog/auralog.ts`:

```ts
import { Auralogger } from "auralogger-cli";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  const projectToken =
    process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN ||
    process.env.VITE_AURALOGGER_PROJECT_TOKEN ||
    process.env.AURALOGGER_PROJECT_TOKEN;
  // Silent opt-out: if token is missing, we still keep console logging.
  if (projectToken) {
    // Token only — no user secret required.
    Auralogger.configure(projectToken);
  } else {
    console.warn(
      "[Auralogger] Missing project token env; local-only logging enabled.",
    );
    Auralogger.configure();
  }
  configured = true;
}

/** Centralized logger — works anywhere, no client/server split needed. */
export function AuraLog(type: string, message: string, location?: string, data?: unknown): void {
  ensureConfigured();
  Auralogger.log(type, message, location, data);
}
```

#### Encrypted projects: keep client vs server split

*Same energy as the CLI banner: two helpers, two files — don’t cross the streams.*

**Which file is which?**

- **🎨 Browser / frontend** — React, Vue, Vite, Next client code, anything bundled for the user. `**AuraClient`** streams logs over the WebSocket to Auralogger; it does **not** print successful logs to the browser console (only **errors** / connection issues). **Project token only** in this file — never `AURALOGGER_USER_SECRET`.
- **🧱 Server / backend / CLI** — HTTP APIs, workers, cron jobs, **this CLI**, anything that runs on a machine you control, not in the user’s browser. **Private creds live only in this copy** — *server suit only.*

**Client-side `Auralog`** (`auralogger-cli/client`) — save as e.g. `src/lib/auralog/client-auralog.ts`. Set `**NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN**` in `.env.local`; `AuraClient` derives project id/session/styles via `POST /api/{project_token}/proj_auth` (token in the URL path).

```ts
import { AuraClient } from "auralogger-cli/client";

export type AuralogParams = {
  type: string;
  message: string;
  location?: string;
  data?: unknown;
};

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  // AuraClient only needs a project token; proj_auth uses POST /api/{token}/proj_auth (token in path).
  // You can also use hardcoded strings instead of env lookups below (avoid committing real values).
  const projectToken =
    process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN ||
    process.env.VITE_AURALOGGER_PROJECT_TOKEN ||
    process.env.AURALOGGER_PROJECT_TOKEN;
  // Silent opt-out: if token is missing, we still keep console logging.
  if (projectToken) {
    AuraClient.configure(projectToken);
  } else {
    console.warn(
      "[Auralogger] Missing project token env; local-only logging enabled.",
    );
    AuraClient.configure("");
  }
  // use AuraClient.configure() for console only logs in production to remove network costs
  configured = true;
}

/** Browser-safe: project token only. Never include user secret in client bundles. */
export function Auralog(params: AuralogParams): void {
  ensureConfigured();
  AuraClient.log(params.type, params.message, params.location, params.data);
}
```

Use it from a client component or page:

```ts
import { Auralog } from "@/lib/auralog/client-auralog";

Auralog("info", "new client tests", "src/app/test/page.tsx", { source: "test-page-client" });
// expected: [info] new client tests @ src/app/test/page.tsx { source: "test-page-client" }

Auralog("warn", "client cache miss");
// expected: [warn] client cache miss

Auralog("error", "client fetch failed", undefined, { retrying: true });
// expected: [error] client fetch failed { retrying: true }
```

**Server-side `AuraLog`** (`auralogger-cli/server`) — save as e.g. `src/lib/auralog/server-auralog.ts`. **Never import this file from client code.**

```ts
import { AuraServer } from "auralogger-cli/server";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  // You can also pass string literals to AuraServer.configure(...) instead of process.env (never commit real secrets).
  const projectToken =
    process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN ||
    process.env.VITE_AURALOGGER_PROJECT_TOKEN ||
    process.env.AURALOGGER_PROJECT_TOKEN;
  const userSecret = process.env.AURALOGGER_USER_SECRET || "";

  // Silent opt-out: if token/secret are missing, keep local logging only.
  if (projectToken && userSecret) {
    AuraServer.configure(projectToken, userSecret);
  } else {
    console.warn(
      "[Auralogger] Missing server credentials env; local-only logging enabled.",
    );
    AuraServer.configure(projectToken || "", userSecret);
  }
// use AuraClient.configure() for console only logs in production to remove network costs
  configured = true;
}

/** Server-only: uses project token + user secret from env. Do not import from client components. */
export function AuraLog(type: string, message: string, location?: string, data?: unknown): void {
  ensureConfigured();
  AuraServer.log(type, message, location, data);
}
```

Use it from a route handler, server action, etc.:

```ts
import { AuraLog } from "@/lib/auralog/server-auralog";

AuraLog("info", "new server tests", "src/app/api/test/auralog/route.ts", {
  source: "test-api-route",
});
// expected: [info] new server tests @ src/app/api/test/auralog/route.ts { source: "test-api-route" }

AuraLog("warn", "cache miss");
// expected: [warn] cache miss

AuraLog("error", "db timeout", undefined, { retrying: true });
// expected: [error] db timeout { retrying: true }
```

### 5) Fetch logs in your terminal

*You shipped logs from code; now steal them back for debugging with a filter-shaped crowbar.*

```bash
npx auralogger-cli get-logs -maxcount 20
```

After `**npm install**` in this project:

```bash
npx auralogger get-logs -maxcount 20
```

**One page per command:** each `get-logs` run sends **a single** `POST /api/{project_token}/logs` (header `**secret`** = user secret; some backends also require `**user_secret`**, and the CLI sends both) and prints whatever comes back in that response — there is no automatic multi-request paging inside the CLI. Use `**-maxcount`** (the CLI caps it at **100** per request) and `**-skip`** to move through results: run again with a higher `skip`, or wrap calls in a small script if you need many pages. Narrow filters (e.g. `**-time`**) keep each page meaningful.

The same filter grammar is kept in sync in `**[user-docs/commands.md](user-docs/commands.md)`** for diffs and short copy.

---

## CLI commands (reference)

*Subcommands, then `**get-logs`** filters — copy tokens exactly.*

### Invocation

```bash
auralogger <command> [arguments...]
```

Use `npx auralogger-cli …` from any directory, or `npx auralogger …` after `**npm install auralogger-cli**` in your project.

### Commands (only `get-logs` takes extra tokens)


| Command          | Args           | Purpose                                                                                                                                                                                                                                                                                                          |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`           | —              | Interactive setup: prompts for missing values, **copy-paste dotenv** (up to 5 lines: `AURALOGGER_PROJECT_TOKEN`, `AURALOGGER_USER_SECRET`, `AURALOGGER_PROJECT_SESSION`, `NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`, `VITE_AURALOGGER_PROJECT_TOKEN`), plus **Auralog** (browser) and **AuraLog** (server) snippets. |
| `server-check`   | —              | Sanity-check **server-side** logging: `AURALOGGER_PROJECT_TOKEN` + `AURALOGGER_USER_SECRET` (env or prompt), one test log.                                                                                                                                                                                       |
| `client-check`   | —              | Same credential resolution as `server-check`, then one test log on the **browser** ingest path (no user secret on the socket).                                                                                                                                                                                   |
| `test-serverlog` | —              | Send **5** logs via `AuraServer.log`, then close.                                                                                                                                                                                                                                                                |
| `test-clientlog` | —              | Send **5** logs via `AuraClient.log`, then close.                                                                                                                                                                                                                                                                |
| `get-logs`       | `[filters...]` | Fetch and print logs. Needs token + user secret (env or prompt). If `AURALOGGER_PROJECT_STYLES` (or public equivalents) is unset, the CLI resolves styles for that run so terminal output matches the dashboard when possible.                                                                                   |


### `get-logs` filter grammar

Filters look like flags; values are **JSON** pasted on the command line.

```text
-<field> [--<operator>] <json-value>
```

- `**maxcount**` and `**skip**`: value must be a JSON **number** (not a string).
- **Every other field**: value must be a JSON **array** (even for a single value).

**Paging:** one CLI run → one HTTP request → one `logs` array. There is **no** built-in multi-page loop. Combine `**-maxcount`** (hard cap **100** in the CLI before the request) and `**-skip`** across separate runs or a script.

#### Fields and operators


| Field         | Operators                  | Default operator | Value shape                                                                                                                                                     |
| ------------- | -------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`        | `in`, `not-in`             | `in`             | JSON array of type strings                                                                                                                                      |
| `message`     | `contains`, `not-contains` | `contains`       | JSON array of substrings                                                                                                                                        |
| `location`    | `in`, `not-in`             | `in`             | JSON array of location strings                                                                                                                                  |
| `time`        | `since`, `from-to`         | `since`          | JSON array; e.g. `["10m"]` for `since`, or a pair for `from-to`                                                                                                 |
| `order`       | `eq`                       | `eq`             | JSON array: `["newest-first"]` or `["oldest-first"]`                                                                                                            |
| `maxcount`    | `eq`                       | `eq`             | JSON number, clamped to `0..100`                                                                                                                                |
| `skip`        | `eq`                       | `eq`             | JSON number, floored, minimum `0`                                                                                                                               |
| `session`     | `eq`                       | `eq`             | JSON array of session strings (narrows to a dev session). If `AURALOGGER_PROJECT_SESSION` is set and you omit `-session`, the CLI prepends this filter for you. |
| `data.<path>` | `eq`                       | `eq`             | JSON array (filter on nested `data` JSON, dot path)                                                                                                             |


Default operator: omit `--<operator>` and the CLI uses the default for that field. Example: `-type '["error"]'` is the same as `-type --in '["error"]'`.

#### Examples

```bash
auralogger get-logs -type '["error","warn"]' -maxcount 50
auralogger get-logs -message '["timeout"]' -skip 20 -maxcount 30
auralogger get-logs -type --not-in '["info","debug"]' -time --since '["10m"]'
auralogger get-logs -data.userId '["06431f39-55e2-4289-80c8-5d0340a8b66e"]'
auralogger get-logs -order '["oldest-first"]' -maxcount 25
```

#### Common parse errors (filters)

- `Expected 'get-logs'`
- `Expected field at position N`
- `Missing value for field '…'`
- `Invalid JSON for field '…'`
- `Field '…' expects a JSON array token` (for non-`maxcount` / non-`skip` fields)
- `Field 'maxcount' expects a JSON number token` (same for `skip`)
- `Invalid op '…' for field '…'`
- `Unknown filter field: …`

Required env for CLI commands: see **Environment variables** earlier in this README and `**[user-docs/environment.md](user-docs/environment.md)`**.

---

## What to import (avoid bundler pain)

*Pick the right door: `**/server*`* vs `**/client`**. Wrong door = surprise `ws` in the browser bundle and a very angry webpack.*

- **Server code**: `import { AuraServer } from "auralogger-cli/server"`
- **Browser code**: `import { AuraClient } from "auralogger-cli/client"`

Using the explicit subpaths avoids accidentally pulling Node-only dependencies (like `ws`) into client bundles. The package `exports` field maps `**auralogger-cli/server`** to a stub on `**browser`** builds.

**Fire-and-forget:** `AuraServer.log` / `AuraClient.log` (and the `**Auralog`** / `**AuraLog`** helpers) return immediately; work is scheduled on the next tick. **Both always print to the local console.** When credentials (`AURALOGGER_PROJECT_TOKEN` + `AURALOGGER_USER_SECRET`) are configured, logs are also streamed to the backend over WebSocket; if credentials are missing, logs print locally only with no warning. Problems (WebSocket / send failures, `proj_auth` errors) surface via `console.error` / `console.warn`. Idle sockets close after a quiet period; call `AuraServer.closeSocket()` / `AuraClient.closeSocket()` for a clean shutdown. On Node you can call `AuraServer.configure(projectToken, userSecret)` or `await AuraServer.syncFromSecret(projectToken, userSecret)` yourself if you skip the helper.

---

## Debugging (most common issues)

*When the happy path ghosts you — start here. Facts first, feelings later.*

### `AuraServer` doesn’t stream

*Usually: the token or user secret never made it in, or `**proj_auth*`* didn’t get a word in.*

- The process needs `**AURALOGGER_PROJECT_TOKEN`** and `**AURALOGGER_USER_SECRET`** (or explicit `AuraServer.configure(projectToken, userSecret)` / `syncFromSecret`). Id, session, and styles are loaded via `**POST /api/{project_token}/proj_auth`** after configure (token URL-encoded in the path; no `secret` header on that route).

If private creds are missing or `proj_auth` fails, `**AuraServer.log` does not stream** to the backend — logs print locally only, silently. `**console.error`** appears only when a send or socket operation fails.

### Client bundle includes `ws` (or crashes on `process`, `fs`, etc.)

*You invited the server entry to a client party. Bouncers hate that.*

- Use the client-only entry:

```js
import { AuraClient } from "auralogger-cli/client";
```

### `AuraClient` says WebSocket is not available (Node)

*Browsers were born with `**WebSocket*`*. Older Node sometimes wasn’t — polyfill or upgrade, your call.*

`AuraClient.log` uses the runtime’s **global `WebSocket*`*. It works in browsers and in Node versions that provide a global `WebSocket` (Node 22+).  
If you must run `AuraClient` in older Node, set `globalThis.WebSocket` (see `**user-docs/**`).

## Detailed reference

*Below is the same reference material as `**user-docs/*`*, inlined for one-stop reading. **Tables and spelling are law** — skim the flavor, obey the facts.*

### Environment variables

*Two buckets: **private** credentials (project token + user secret), three **publishable** knobs. Mix them up and the multiverse gets weird.*

Two classes of values:

- **Private / auth** — `**AURALOGGER_PROJECT_TOKEN`** and `**AURALOGGER_USER_SECRET`**.
  - Project token is in the **path** for `**proj_auth`**, `**/{proj_token}/create_log`**, and `**/{proj_token}/create_browser_logs**`.
  - User secret is `**Authorization: Bearer …**` on **server** `**/{proj_token}/create_log`** only (`**AuraServer`** / `**server-check`**).
  Never expose `**AURALOGGER_USER_SECRET`** in browser bundles, public repos, or `NEXT_PUBLIC_*` / `VITE_*` keys.
- **Publishable** — `**project_id`**, `**session`**, and `**styles**` (the three non-secret fields from `auralogger init`). They are not API secrets. You still choose **where** they live: server-only `.env` vs client-visible env keys for frontends.

The CLI and `**AuraServer`** need **both private creds** for server-side operations. `**AuraClient`** uses a **project token only** and hydrates id/session/styles via `proj_auth`; it never reads `**AURALOGGER_USER_SECRET`**.

#### Private variable (exact name)


| Variable                   | Who uses it                                                                | Notes                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AURALOGGER_PROJECT_TOKEN` | CLI (`init`, `get-logs`, checks), `**AuraServer`**, `**AuraClient`** input | **Project-scoped token**. The CLI and server SDK use it for auth + project lookup. Client SDK also uses a token (often via `NEXT_PUBLIC_*` / `VITE_*` keys). The CLI accepts the same value via `**NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`** or `**VITE_AURALOGGER_PROJECT_TOKEN`**. |
| `AURALOGGER_USER_SECRET`   | CLI (`init`, `get-logs`, checks), `**AuraServer`**, `**server-check**`     | **Server-side / CI secrets only.** Required for server-side logging and for fetching logs in the CLI. **Never** expose this value to browser code, public repos, or `NEXT_PUBLIC_*` / `VITE_*` env keys.                                                                           |


#### Publishable variables (exact base names)

These identify the project and style logs. They are **not** private credentials.


| Role                            | Primary env keys (Node / server `.env`) | In client bundles (must be exposed by the framework)                                                                   |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Project id                      | `AURALOGGER_PROJECT_ID`                 | `NEXT_PUBLIC_AURALOGGER_PROJECT_ID` (Next.js) or `VITE_AURALOGGER_PROJECT_ID` (Vite); unprefixed still works on server |
| Session                         | `AURALOGGER_PROJECT_SESSION`            | `NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION` or `VITE_AURALOGGER_PROJECT_SESSION`                                          |
| Styles (single-line JSON array) | `AURALOGGER_PROJECT_STYLES`             | `NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES` or `VITE_AURALOGGER_PROJECT_STYLES`                                            |


Resolution order for each publishable field is: `**NEXT_PUBLIC_*`**, then `**VITE_*`**, then unprefixed `AURALOGGER_PROJECT_*`. `**auralogger init**` prints **session** plus the three project-token spellings and user secret (see quick start above); id/styles for CLI styling can still be set manually or fetched per command via `proj_auth`.

#### Who loads what

`**AuraClient` (browser):** project token only — usually `**NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`** / `**VITE_...`** passed into `**AuraClient.configure`**. Id/session/styles come from `**proj_auth`** in memory. No `.env` file reads in the browser. The publishable id/session/styles env keys remain useful for `**init**` output, `**AuraServer`**, and CLI; they are not required on the client for `**AuraClient`**.

`**AuraServer` (Node):** reads `**process.env`**; on first `AuraServer.log` or `syncFromSecret` it may once load `**.env`** and `**.env.local**` from `**process.cwd()**` (Node only). **Private creds** must only exist in environments you treat as private.

**CLI:** loads `**.env`** / `**.env.local`** from cwd before each command.

#### Getting values

*The boring-but-correct pipeline — same beats `**init*`* walks you through in the terminal.*

1. Run `**auralogger init`** — banner first, then prompts for whatever is missing.
2. If the project token (`**AURALOGGER_PROJECT_TOKEN`** / `**NEXT_PUBLIC_`** / `**VITE_*`*), `**AURALOGGER_USER_SECRET`**, or `**AURALOGGER_PROJECT_SESSION**` is unset, the CLI prompts or fetches as needed.
3. After `proj_auth`, it shows the **live session**, the **up-to-five-line dotenv block** (token server + Next + Vite, user secret, session — each omitted if already in env), then two snippets (**separate files**): `**Auralog`** vs `**AuraLog`**.
4. Put **private creds** in server-side env (`.env` gitignored, host secret store, CI secrets). For `**AuraClient`**, use `**NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`** or `**VITE_AURALOGGER_PROJECT_TOKEN**` (same ciphertext as the server token). Project id and styles need not live in `.env`; SDKs and `**get-logs**` can pull them from `proj_auth` when needed (styles affect `**get-logs**` terminal output, not local SDK success logging).

`**await AuraServer.syncFromSecret(projectToken, userSecret)**` (Node) can fill id, session, and styles **in memory** from the API without storing them in `.env`.

#### Example layout (fake values)

*Toy values — swap for what `**auralogger init`** shows you. Real `**STYLES`** strings are long; don’t hand-craft them unless you enjoy pain.*

**Typical `.env` fragment** (Next + Vite token lines are for bundlers; keep user secret off the client):

```env
# PRIVATE — never expose to browser bundles or public repos
AURALOGGER_PROJECT_TOKEN="your-project-token"
AURALOGGER_USER_SECRET="your-user-secret"

AURALOGGER_PROJECT_SESSION="session-token-here"
NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN="your-project-token"
VITE_AURALOGGER_PROJECT_TOKEN="your-project-token"
```

(`**auralogger init**` prints this shape when all values are new.) Optional: add `**NEXT_PUBLIC_` / `VITE_` / unprefixed** id + styles keys if you want static styling in the CLI without a `proj_auth` fetch on every `get-logs`.

#### Commands vs runtime


| Context                       | Private creds                                       | Publishable three                                                                                                                                               |
| ----------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**auralogger init`**         | Optional in env, else prompt                        | Banner → prompts → session line + up to five dotenv lines (token ×3 + secret + session) after `proj_auth`                                                       |
| `**auralogger server-check`** | Token + user secret in env (or paste when prompted) | CLI fetches project id + session via `proj_auth` before opening the socket (session/styles not required in `.env`)                                              |
| `**auralogger client-check`** | Token + user secret in env (or paste when prompted) | Same `proj_auth` context as `**server-check`**; opens `**/{proj_token}/create_browser_logs**` (path-only); session in payload; **no** user secret on the socket |
| `**auralogger get-logs`**     | Token + user secret in env or at prompt             | `**STYLES`** optional in env: if unset, CLI fetches them via `**proj_auth`** for this run                                                                       |
| `**AuraServer`**              | Required (`configure` / env / `syncFromSecret`)     | Loaded from `**proj_auth**` after token auth (publishable trio not required in `.env`)                                                                          |
| `**AuraClient**`              | Browser: project token only; never user secret      | Id/session/styles auto-hydrated via `proj_auth`                                                                                                                 |


#### Environment troubleshooting

*Quick triage — most “it worked on my machine” stories start with cwd or a mangled JSON string.*

- `**server-check` / variable missing** — Run from the directory that contains your `.env`, or export vars in the shell (`process.cwd()`).
- **Styles errors** — Value must be valid JSON array string; fix the env value or unset it so `**get-logs`** can pull styles from `**proj_auth`**.
- `**AuraServer` not streaming** — Ensure `**AURALOGGER_PROJECT_TOKEN`** and `**AURALOGGER_USER_SECRET`** (or call `**syncFromSecret` / `configure`**) so auth + ingest can run; `proj_auth` uses the token in the URL path. Logs always print locally — if they're not reaching the dashboard, check credentials and `proj_auth` reachability; problems surface as `**console.error`**.
- **Client bundle + `ws*`* — Use `**auralogger-cli/client**`; the package maps `**./server**` to a browser stub so `ws` is not pulled in for `AuraServer` imports on the client.

##### Advanced overrides (contributors / self-hosted backends)

HTTP and WebSocket **base URL** overrides are documented for maintainers in `**dev-docs/routes.md`** (not required for normal use of hosted Auralogger).

---

## Contributing

Contributor context lives in `**dev-docs/`** (Git repo only). **Documentation index:** `**docs/README.md`** — *capes optional, clear commits appreciated.*
[https://github.com/Beever-Labs/auralogger-node](https://github.com/Beever-Labs/auralogger-node)