<!-- Generated: 2026-04-08 09:38:59 UTC -->
# Auralogger for Node.js (SDK + CLI)

Stream logs from your **Node server** and your **browser app** to Auralogger, then query them from the terminal , while watching them popup on ur mobile/browser with Aura

> **Same deal as the terminal output:** we dress up the prose; **commands, env names, and tables are the contract.** Copy those exactly. The jokes are optional.

---

## Quick start (copy/paste)

Run CLI commands from the directory that contains your `.env` / `.env.local` (or where `AURALOGGER_PROJECT_*` is set in your shell/CI). The CLI loads `.env` files from the **current working directory** — *i.e. `cd` into the app before you heroically type `npx`.*

**Prefer `npx`** so the CLI runs in **this project’s context** with the version you expect — Auralogger is **project-scoped** (tokens + publishable ids per app), not a “install once globally and forget which repo you’re in” kind of tool.

**Migrating:** rename **`AURALOGGER_PROJECT_SECRET`** → **`AURALOGGER_PROJECT_TOKEN`** and add **`AURALOGGER_USER_SECRET`**. There is no backward-compatible read of the old env name.

### 1) Add the package

```bash
npm install auralogger-cli
```

and  you can look up commands at

```bash
npx auralogger-cli --help
```

### 2) Run init (private creds + client snippet)

*Origin story time: you’ll get **private** credentials from [https://auralogger.com](https://auralogger.com), paste them here and you get two snippets — **Auralog** (browser, no vault codes) and **AuraLog** (server, holds the token + user secret). Different files, different job descriptions.*

Run this in your app repo (where your `.env` should live):

```bash
npx auralogger-cli init
```

After `**npm install auralogger-cli**` in this repo, `npx` can run the **local** CLI binary by name (same tool, pinned to your lockfile):

```bash
npx auralogger init
```

`**auralogger init**` prints a **copy-paste env block** (`AURALOGGER_PROJECT_TOKEN` and `AURALOGGER_USER_SECRET` when you just typed them, plus `NEXT_PUBLIC_*` and matching unprefixed publishable keys), then two snippets in **different files**: `**Auralog`** (client / `AuraClient`) and `**AuraLog`** (server / `AuraServer`). Variable details: `**[user-docs/environment.md](user-docs/environment.md)**`.

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

Run `**auralogger init**` and paste what it prints, or copy the shapes below. `**Auralog**` is for the browser; `**AuraLog**` is for Node — put each in **its own file** (or repo). *Same energy as the CLI banner: two helpers, two files — don’t cross the streams.*

**Which file is which?**

- **🎨 Browser / frontend** — React, Vue, Vite, Next client code, anything bundled for the user. If you want **pretty colored lines in DevTools**, you’re almost certainly here. **No project token or user secret** in this file — *the neighborhood logger doesn’t carry the nuclear codes.*
- **🧱 Server / backend / CLI** — HTTP APIs, workers, cron jobs, **this CLI**, anything that runs on a machine you control, not in the user’s browser. **Private creds live only in this copy** — *server suit only.*

**Client-side `Auralog`** (`auralogger-cli/client`) — save as e.g. `src/lib/auralog/client-auralog.ts`. Set `**NEXT_PUBLIC_AURALOGGER_PROJECT_ID**` (and optional session/styles) in `.env.local`; see `**[user-docs/environment.md](user-docs/environment.md)**`.

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

  // You can also use hardcoded strings instead of the env lookups below (avoid committing real values; browser bundles are public).
  const projectId = process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing NEXT_PUBLIC_AURALOGGER_PROJECT_ID");
  }

  AuraClient.configure({
    projectId,
    session: process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION ?? null,
    styles: process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES,
  });
  configured = true;
}

/** Browser-safe: no project token or user secret. Configure via NEXT_PUBLIC_AURALOGGER_* env vars. */
export function Auralog(params: AuralogParams): void {
  ensureConfigured();
  AuraClient.log(params.type, params.message, params.location, params.data);
}
```

Use it from a client component or page:

```ts
import { Auralog } from "@/lib/auralog/client-auralog";

Auralog({
  type: "info",
  message: "new client tests",
  location: "src/app/test/page.tsx",
  data: { source: "test-page-client" },
});
```

**Server-side `AuraLog`** (`auralogger-cli/server`) — save as e.g. `src/lib/auralog/server-auralog.ts`. **Never import this file from client code.**

```ts
import { AuraServer } from "auralogger-cli/server";

export type AuralogParams = {
  type: string;
  message: string;
  location?: string;
  data?: unknown;
};

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  // You can also pass string literals to AuraServer.configure(...) instead of process.env (never commit real secrets).
  const projectToken = process.env.AURALOGGER_PROJECT_TOKEN;
  if (!projectToken) {
    throw new Error("Missing AURALOGGER_PROJECT_TOKEN");
  }
  const userSecret = process.env.AURALOGGER_USER_SECRET;
  if (!userSecret) {
    throw new Error("Missing AURALOGGER_USER_SECRET");
  }

  AuraServer.configure(projectToken, userSecret);
  configured = true;
}

/** Server-only: uses project token + user secret from env. Do not import from client components. */
export function AuraLog(params: AuralogParams): void {
  ensureConfigured();
  AuraServer.log(params.type, params.message, params.location, params.data);
}
```

Use it from a route handler, server action, etc.:

```ts
import { AuraLog } from "@/lib/auralog/server-auralog";

AuraLog({
  type: "info",
  message: "new server tests",
  location: "src/app/api/test/auralog/route.ts",
  data: { source: "test-api-route" },
});
```

### 5) Fetch logs in your terminal

*You shipped logs from code; now steal them back for debugging with a filter-shaped crowbar.*

```bash
npx auralogger-cli get-logs -maxcount 20
```

After **`npm install`** in this project:

```bash
npx auralogger get-logs -maxcount 20
```

**One page per command:** each `get-logs` run sends **a single** `POST /api/logs` and prints whatever comes back in that response — there is **no** automatic multi-request paging inside the CLI. Use **`-maxcount`** (the CLI caps it at **100** per request) and **`-skip`** to move through results: run again with a higher `skip`, or wrap calls in a small script if you need many pages. Narrow filters (e.g. **`-time`**) keep each page meaningful.

Full command list and filter syntax: **[`user-docs/commands.md`](user-docs/commands.md)**.

---

## What to import (avoid bundler pain)

*Pick the right door: `**/server*`* vs `**/client**`. Wrong door = surprise `ws` in the browser bundle and a very angry webpack.*

- **Server code**: `import { AuraServer } from "auralogger-cli/server"`
- **Browser code**: `import { AuraClient } from "auralogger-cli/client"`

Using the explicit subpaths avoids accidentally pulling Node-only dependencies (like `ws`) into client bundles. The package `exports` field maps `**auralogger-cli/server`** to a stub on `**browser*`* builds.

**Fire-and-forget:** `AuraServer.log` / `AuraClient.log` (and the `**Auralog`** / `**AuraLog`** helpers) return immediately; work is scheduled on the next tick. Idle sockets close after a quiet period; call `AuraServer.closeSocket()` / `AuraClient.closeSocket()` for a clean shutdown. On Node you can call `AuraServer.configure(projectToken, userSecret)` or `await AuraServer.syncFromSecret(projectToken, userSecret)` yourself if you skip the helper.

---

## Debugging (most common issues)

*When the happy path ghosts you — start here. Facts first, feelings later.*

### `AuraServer` prints but doesn’t stream

*Usually: the token or user secret never made it in, or `**proj_auth*`* didn’t get a word in.*

- The process needs `**AURALOGGER_PROJECT_TOKEN`** and `**AURALOGGER_USER_SECRET**` (or explicit `AuraServer.configure(projectToken, userSecret)` / `syncFromSecret`). Id, session, and styles are loaded from `**/api/proj_auth*`* after configure; `proj_auth` itself is token-only (`secret` header).

If private creds are missing or `proj_auth` fails, `AuraServer.log` falls back to console-only.

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

- **Private** — `**AURALOGGER_PROJECT_TOKEN`** and `**AURALOGGER_USER_SECRET`**.
  - Project token is sent on authenticated WebSockets as `**Authorization: Bearer <project token>`**.
  - User secret is sent on `create_log` as header `**secret: <user secret>`**.
  - `POST /api/proj_auth` remains token-only via header `**secret`**.
  Neither should appear in browser bundles, public repos, or `NEXT_PUBLIC_*` / `VITE_*` keys.
- **Publishable** — `**project_id`**, `**session`**, and `**styles**` (the three non-secret fields from `auralogger init`). They are not API secrets. You still choose **where** they live: server-only `.env` vs client-visible env keys for frontends.

The CLI and `**AuraServer`** need **both private creds** plus those three for full streaming. `**AuraClient`** uses **only** the publishable three (via env as your bundler exposes them) and never reads **`AURALOGGER_USER_SECRET`**.

#### Private variable (exact name)


| Variable                    | Who uses it                                                                                                          | Notes                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AURALOGGER_PROJECT_TOKEN` | CLI (`init`, `get-logs`, checks), `**AuraServer`**, any code that calls authenticated HTTP or WebSockets | **Server-side / CI secrets only.** Sent on WebSockets as `Authorization: Bearer ...`. Still used for `POST /api/proj_auth` as header `secret`. |
| `AURALOGGER_USER_SECRET` | CLI (`init`, `get-logs`, checks), `**AuraServer`**, routes/sockets that require a user secret | **Server-side / CI secrets only.** Sent on `create_log` as header `secret: <user secret>`. Never exposed to `**AuraClient`**. |


#### Publishable variables (exact base names)

These identify the project and style logs. They are **not** private credentials.


| Role                            | Primary env keys (Node / server `.env`) | In client bundles (must be exposed by the framework)                                                                   |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Project id                      | `AURALOGGER_PROJECT_ID`                 | `NEXT_PUBLIC_AURALOGGER_PROJECT_ID` (Next.js) or `VITE_AURALOGGER_PROJECT_ID` (Vite); unprefixed still works on server |
| Session                         | `AURALOGGER_PROJECT_SESSION`            | `NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION` or `VITE_AURALOGGER_PROJECT_SESSION`                                          |
| Styles (single-line JSON array) | `AURALOGGER_PROJECT_STYLES`             | `NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES` or `VITE_AURALOGGER_PROJECT_STYLES`                                            |


Resolution order for each publishable field is: `**NEXT_PUBLIC_*`**, then `**VITE_*`**, then unprefixed `AURALOGGER_PROJECT_*` (see `init` output — it prints both prefixed and unprefixed lines for convenience).

#### Who loads what

`**AuraClient` (browser):** reads `**process.env`** only, for the **publishable** keys above (typically the `NEXT_PUBLIC_*` or `VITE_*` names your bundler inlines). No `.env` file reads in the browser.

`**AuraServer` (Node):** reads `**process.env`**; on first `AuraServer.log` or `syncFromSecret` it may once load `**.env`** and `**.env.local**` from `**process.cwd()**` (Node only). **Private creds** must only exist in environments you treat as private.

**CLI:** loads `**.env`** / `**.env.local`** from cwd before each command.

#### Getting values

*The boring-but-correct pipeline — same beats `**init*`* walks you through in the terminal.*

1. Run `**auralogger init`**.
2. If `**AURALOGGER_PROJECT_TOKEN*`* or `**AURALOGGER_USER_SECRET*`* is unset, the CLI prompts for missing values.
3. The CLI shows a human-readable **Step 2** trio (id, session, styles), then a **copy-paste dotenv block** with `NEXT_PUBLIC_*` and unprefixed publishable keys (and private lines for `AURALOGGER_PROJECT_TOKEN` / `AURALOGGER_USER_SECRET` when entered at prompt). Then it prints two snippets (**separate files**): `**Auralog`** (browser / frontend: reads `**NEXT_PUBLIC_AURALOGGER_*`**) vs `**AuraLog**` (server / backend / CLI, reads private creds from env). For Vite, duplicate the same values under `VITE_*` names (see the example block below).
4. Put **private creds** in server-side env (`.env` gitignored, host secret store, CI secrets). Put the **publishable** id, session, and styles into `**NEXT_PUBLIC_*`** / `**VITE_*`** for the browser helper (same logical values as Step 2 / `**auralogger init**` display).

`**await AuraServer.syncFromSecret(projectToken, userSecret)**` (Node) can fill id, session, and styles **in memory** from the API without storing them in `.env`.

#### Example layout (fake values)

*Toy values — swap for what `**auralogger init*`* shows you. Real `**STYLES`** strings are long; don’t hand-craft them unless you enjoy pain.*

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

**Browser / Vite / Next client env** should use **only** the prefixed lines from `init` (no private creds):

```env
NEXT_PUBLIC_AURALOGGER_PROJECT_ID="proj_example_123"
NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION="session-token-here"
NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES="[{\"default\":{\"icon\":\"🗒️\"}}]"
```

(Or the `VITE_*` equivalents.) Real `**STYLES**` values are much longer; always copy from `**auralogger init**`.

#### Commands vs runtime


| Context                       | Private creds                                                                 | Publishable three                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**auralogger init**`         | Optional in env, else prompt for token and user secret                        | Step 2 trio + copy-paste dotenv lines after auth                                                                                                                      |
| `**auralogger server-check**` | `**AURALOGGER_PROJECT_TOKEN**` + `**AURALOGGER_USER_SECRET**` in env         | Project id required (session/styles not required for the check itself)                                                                                                |
| `**auralogger client-check**` | Same context resolution as `**server-check**`; not sent on browser-style WS   | Project id + session (same as `**server-check**`)                                                                                                                     |
| `**auralogger get-logs**`     | Token + user secret in env or at prompt                                       | `**STYLES**` optional in env: if unset, CLI fetches them via `**proj_auth**` (same as `**init**`) for this run; use `**auralogger init**` to persist copy-paste lines |
| `**AuraServer**`              | Required (`configure` / env / `syncFromSecret`)                               | Loaded from `**proj_auth**` after token auth (publishable trio not required in `.env`)                                                                                |
| `**AuraClient**`              | **Never** user secret                                                         | Id required; session/styles optional with fallbacks                                                                                                                   |


#### Environment troubleshooting

*Quick triage — most “it worked on my machine” stories start with cwd or a mangled JSON string.*

- `**server-check` / variable missing** — Run from the directory that contains your `.env`, or export vars in the shell (`process.cwd()`).
- **Styles errors** — Value must be valid JSON array string; refresh from `**auralogger init`**.
- `**AuraServer` console-only** — Ensure `**AURALOGGER_PROJECT_TOKEN`** and `**AURALOGGER_USER_SECRET`** (or call `**syncFromSecret` / `configure`**) so auth + ingest can run; `proj_auth` itself is token-only (`secret` header).
- **Client bundle + `ws`** — Use `**auralogger-cli/client**`; the package maps `**./server**` to a browser stub so `ws` is not pulled in for `AuraServer` imports on the client.

##### Advanced overrides (contributors / self-hosted backends)

HTTP and WebSocket **base URL** overrides are documented for maintainers in `**dev-docs/routes.md`** (not required for normal use of hosted Auralogger).

### CLI command reference

*The deputized cheat sheet: subcommands in a table, `**get-logs`** grammar spelled out, examples you can steal.*

The full **getting started** story (install, [auralogger.com](https://auralogger.com), environment variables, and code examples) is earlier in this README. Variable details are in **Environment variables** above.

This section is the **command cheat sheet** for quick lookup.

#### Invocation

```bash
auralogger <command> [arguments...]
```

#### Commands (no flags except filter tokens on `get-logs`)


| Command          | Args           | Purpose                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`           | —              | Auth with project token via `proj_auth` (`secret` header only); **copy-paste dotenv block** (`NEXT_PUBLIC_*`, unprefixed publishable keys, `AURALOGGER_PROJECT_TOKEN` / `AURALOGGER_USER_SECRET` when typed at prompt); two snippets (`**Auralog**` + `**AuraLog**`). Vite: duplicate as `VITE_*` (see **Environment variables** above). |
| `server-check`   | —              | Test WebSocket connectivity (needs project id + `AURALOGGER_PROJECT_TOKEN` + `AURALOGGER_USER_SECRET` in env).                                                                                                                                                                                                                                                                                                |
| `client-check`   | —              | Same project/session context as `**server-check**`; opens `**create_browser_logs`** (no auth headers on the socket, like `**AuraClient**`).                                                                                                                                                                                                                      |
| `test-serverlog` | —              | Send 5 logs via `AuraServer.log` (production path), then close.                                                                                                                                                                                                                                                                                                |
| `test-clientlog` | —              | Send 5 logs via `AuraClient.log` (production path), then close.                                                                                                                                                                                                                                                                                                |
| `get-logs`       | `[filters...]` | Fetch and print logs; filters use grammar below. If `**AURALOGGER_PROJECT_STYLES**` (or public equivalents) is missing, runs the same `**proj_auth**` fetch as `**init**` and styles logs from the response (prompts for token/user secret when needed).                                                                                                                  |


#### `get-logs` filter grammar

*Filters look like CLI flags but speak JSON — numbers for **`maxcount`** / **`skip`**, arrays almost everywhere else.*

**Paging model:** one CLI invocation → one HTTP request → one `logs` array. Pagination is **manual**: combine **`-maxcount`** (max **100** enforced in the CLI before the request) and **`-skip`** across separate runs (or a loop in a script). The server is expected to honor those filters when building the response.

```text
-<field> [--<operator>] <json-value>
```

- **`maxcount`**, **`skip`**: value is a JSON **number**.
- **All other fields**: value is a JSON **array**.

##### Fields


| Field         | Operators                  | Default op |
| ------------- | -------------------------- | ---------- |
| `type`        | `in`, `not-in`             | `in`       |
| `message`     | `contains`, `not-contains` | `contains` |
| `location`    | `in`, `not-in`             | `in`       |
| `time`        | `since`, `from-to`         | `since`    |
| `order`       | `eq`                       | `eq`       |
| `maxcount`    | `eq`                       | `eq`       |
| `skip`        | `eq`                       | `eq`       |
| `data.<path>` | `eq`                       | `eq`       |


##### Examples

```bash
auralogger get-logs -type '["error","warn"]' -maxcount 50
auralogger get-logs -message '["timeout"]' -skip 20 -maxcount 30
auralogger get-logs -type --not-in '["info","debug"]' -time --since '["10m"]'
auralogger get-logs -data.userId '["06431f39-55e2-4289-80c8-5d0340a8b66e"]'
```

#### CLI and environment

See **Environment variables** above for required variables and how to inject them.

---

## Contributing

Contributor context lives in `**dev-docs/`** (Git repo only). **Documentation index:** `**docs/README.md`** — *capes optional, clear commits appreciated.*

[https://github.com/Beever-Labs/auralogger-node](https://github.com/Beever-Labs/auralogger-node)