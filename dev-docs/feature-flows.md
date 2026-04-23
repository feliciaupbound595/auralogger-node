

# Feature flows (CLI + SDK) — deep trace

This document is the **line-by-line behavioural map** for everything that ships under `node/src/`: how the CLI binary dispatches, how each command and SDK class talks to HTTP/WebSocket, where credentials live, which **optimisations** exist (single-flight fetches, socket reuse, idle close, env short-circuits), and how **npm `exports`** wire Node vs browser bundles.

Companion docs: `**[routes.md](routes.md)**` (HTTP/WS paths + auth), `**[api-urls.md](api-urls.md)**` (hosts / env), `**[bdd.md](bdd.md)**` (observable behaviour), `**[file-map.md](file-map.md)**` (edit locations).

All paths below are relative to the `**node/**` package root unless noted.

---

## Table of contents

1. [Credential matrix](#credential-matrix)
2. [Build & publish integration (`package.json` → `dist/`)](#build--publish-integration-packagejson--dist)
3. [Process bootstrap: quiet dotenv → binary → env load](#process-bootstrap-quiet-dotenv--binary--env-load)
4. [Shared wire utilities](#shared-wire-utilities)
5. [Styling pipeline (`proj_auth` → terminal)](#styling-pipeline-proj_auth--terminal)
6. [Flow: `auralogger init](#flow-auralogger-init)`
7. [Flow: `auralogger get-logs](#flow-auralogger-get-logs)`
8. [Flow: `auralogger server-check](#flow-auralogger-server-check)`
9. [Flow: `auralogger client-check](#flow-auralogger-client-check)`
10. [Flow: `AuraServer` (Node SDK)](#flow-auraserver-node-sdk)
11. [Flow: `AuraClient` (browser-safe SDK)](#flow-auraclient-browser-safe-sdk)
12. [Flow: `test-serverlog` / `test-clientlog](#flow-test-serverlog--test-clientlog)`
13. [Cross-cutting failure & personality surfaces](#cross-cutting-failure--personality-surfaces)
14. [When you add a command or SDK surface](#when-you-add-a-command-or-sdk-surface)

---

## Credential matrix


| Flow                 | Project token                           | User secret                                                      | HTTP base                             | WS base              | Notes                                      |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- | -------------------- | ------------------------------------------ |
| `**init**`           | Path on `proj_auth`; from env or prompt | Prompt/env for dotenv copy **only**; **not** sent on `proj_auth` | `resolveApiBaseUrl()`                 | —                    | `POST` has no auth header                  |
| `**get-logs`**       | Path on `/api/{token}/logs`             | Headers `**secret**` + compat `**user_secret**`                  | `resolveApiBaseUrl()`                 | —                    | JSON body `{ filters }`                    |
| `**server-check**`   | Path on WS URL                          | `Authorization: Bearer` on WS                                    | `resolveApiBaseUrl()` for `proj_auth` | `resolveWsBaseUrl()` | Same HTTP hydrate as CLI checks            |
| `**client-check**`   | Path on `proj_auth` + WS                | Used for `proj_auth` only; **not** on WS                         | `resolveApiBaseUrl()`                 | `resolveWsBaseUrl()` | Browser path: token in URL only            |
| `**AuraServer.log`** | Path on WS; may path on `proj_auth`     | Bearer on WS; optional override / env                            | `resolveApiBaseUrl()`                 | `resolveWsBaseUrl()` | Hydrates via `proj_auth`; WS body is a **JSON array** of log objects (batched) |
| `**AuraClient.log**` | Path on `proj_auth` + WS                | **Never**                                                        | `resolveApiBaseUrl()`                 | `resolveWsBaseUrl()` | No `loadCliEnvFiles`; same **batched** WS array shape as server                   |


---

## Build & publish integration (`package.json` → `dist/`)

- **Compilation:** `tsconfig` maps `src/` → `dist/` (see `**[file-map.md](file-map.md)`**). The published `**bin**` is `dist/cli/bin/auralogger.js`, built from `src/cli/bin/auralogger.ts`.
- **Conditional exports** (from `package.json`):
  - `**"."`**: `browser` resolves to `dist/index.browser.js`; Node/default to `dist/index.js`. Bundlers pick `**browser**` when targeting the web.
  - `**"./server"**`: `browser` → `dist/server.browser.js` (stub `**AuraServer**`); Node → `dist/server.js` (real `**ws**` implementation).
  - `**"./client"**` and `**"./server-check"**` / `**"./client-check"**` are unconditional CJS entrypoints to `dist/*.js`.
- `**./init**` is declared in `exports` pointing at `dist/init.js`. The repo’s `file-map.md` notes `**src/init.ts` may be missing** — if `dist/init.js` is absent after build, align the publish entry or add a barrel; the **runtime `init` command** is implemented in `**cli/services/init.ts`** and reached only via the **CLI bin**, not necessarily via `./init` subpath.

```47:83:node/package.json
  "exports": {
    ".": {
      "browser": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.browser.js"
      },
      "node": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./client": {
      "types": "./dist/client.d.ts",
      "default": "./dist/client.js"
    },
    "./server": {
      "browser": {
        "types": "./dist/server.browser.d.ts",
        "default": "./dist/server.browser.js"
      },
      "types": "./dist/server.d.ts",
      "default": "./dist/server.js"
    },
    "./init": {
      "types": "./dist/init.d.ts",
      "default": "./dist/init.js"
    },
    "./server-check": {
      "types": "./dist/server-check.d.ts",
      "default": "./dist/server-check.js"
    },
    "./client-check": {
      "types": "./dist/client-check.d.ts",
      "default": "./dist/client-check.js"
    }
  },
```

**Browser stub for `AuraServer`** (`server.browser.ts`): every static method either **throws** or **no-ops** so client bundles never pull `ws`.

```1:32:node/src/server.browser.ts
const STUB_MESSAGE =
  "auralogger: AuraServer is only available on Node. Use AuraClient in the browser, or keep AuraServer in server-only code (e.g. a Route Handler / API route).";

/**
 * Browser bundle stub: real AuraServer lives in server-log.ts (Node + ws).
 * Prevents importing ws in client builds while keeping the same export name.
 */
export class AuraServer {
  static configure(_projectToken: string, _userSecret?: string): void {
    // no-op in the browser stub
  }

  static async syncFromSecret(
    _projectToken: string,
    _userSecret?: string,
  ): Promise<void> {
    throw new Error(STUB_MESSAGE);
  }

  static log(
    _type: string,
    _message: string,
    _location?: string,
    _data?: unknown,
  ): void {
    throw new Error(STUB_MESSAGE);
  }

  static async closeSocket(_timeoutMs = 1000): Promise<void> {
    // No-op: no server socket in the browser stub.
  }
}
```

**Thin programmatic re-exports:**

```1:1:node/src/server-check.ts
export { runServerCheck } from "./cli/services/server-check";
```

```1:1:node/src/client-check.ts
export { runClientCheck } from "./cli/services/client-check";
```

```1:1:node/src/server.ts
export { AuraServer } from "./server/server-log";
```

```1:1:node/src/client.ts
export { AuraClient } from "./client/client-log";
```

---

## Process bootstrap: quiet dotenv → binary → env load

### Step 0 — silence dotenv before any `config()`

`auralogger.ts` imports `./quiet-dotenv-first` **before** any other module that might load dotenv. That sets `process.env.DOTENV_CONFIG_QUIET` to `"true"` unless the user explicitly set it to `"false"`.

```1:7:node/src/cli/bin/quiet-dotenv-first.ts
/**
 * Ensures dotenv’s “injecting env…” tips stay off for this process before any
 * `config()` runs. (CLI entry imports this module first.)
 */
if (process.env.DOTENV_CONFIG_QUIET !== "false") {
  process.env.DOTENV_CONFIG_QUIET = "true";
}
```

**Optimisation / UX:** avoids noisy stdout from dotenv v17 during CLI runs (`cli-load-env.ts` repeats the same guard for belt-and-suspenders).

### Step 1 — `main()` argv dispatch

```72:136:node/src/cli/bin/auralogger.ts
async function main(): Promise<void> {
  loadCliEnvFiles();

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    return;
  }

  if (!KNOWN_COMMANDS.has(command)) {
    recordCliFailure();
    console.error(chalk.red("🤔 Hmm, never heard of ") + chalk.bold(command) + chalk.red("."));
    {
      const t = pickAside(BIN_UNKNOWN_COMMAND_TEMPLATES);
      printAsideMaybe(
        t.emoji,
        formatAsideTemplate(t.line, { cmd: command }),
        DEFAULT_SILENCE_ASIDE_CHANCE,
      );
    }
    printUsage();
    process.exitCode = 1;
    return;
  }

  noteCommandDispatch(command);

  if (command === "init") {
    await runInit();
    recordCliSuccess(command);
    return;
  }

  if (command === "get-logs") {
    await runGetLogs(args);
    recordCliSuccess(command);
    return;
  }

  if (command === "server-check") {
    await runServerCheck();
    recordCliSuccess(command);
    return;
  }

  if (command === "client-check") {
    await runClientCheck();
    recordCliSuccess(command);
    return;
  }

  if (command === "test-serverlog") {
    await runTestServerlog();
    recordCliSuccess(command);
    return;
  }

  if (command === "test-clientlog") {
    await runTestClientlog();
    recordCliSuccess(command);
    return;
  }
}
```

**Observations:**

- `**loadCliEnvFiles()`** runs at the start of **every** successful command path (and again inside several services — redundant but **idempotent**: dotenv merge is stable for fixed cwd).
- **Success accounting:** `recordCliSuccess(command)` only runs when the handler returns without throwing; `**main().catch`** records failure and exits `1` on uncaught errors.
- `**get-logs**` passes **full `args` array** (including `get-logs` token) into `runGetLogs` because `parseCommand` expects `tokens[0] === "get-logs"`.

### Step 2 — `loadCliEnvFiles` (disk → `process.env`)

```1:17:node/src/cli/utility/cli-load-env.ts
/**
 * Loads `.env` / `.env.local` from cwd into `process.env`.
 * Used by the `auralogger` CLI binary and by `AuraServer` (Node, once on first use).
 * `AuraClient` and browser builds never call this.
 */
import * as path from "node:path";

import { config as loadDotenv } from "dotenv";

export function loadCliEnvFiles(cwd: string = process.cwd()): void {
  // Belt-and-suspenders: dotenv v17 logs tips unless quiet; env wins over options otherwise.
  if (process.env.DOTENV_CONFIG_QUIET !== "false") {
    process.env.DOTENV_CONFIG_QUIET = "true";
  }
  loadDotenv({ path: path.join(cwd, ".env"), quiet: true });
  loadDotenv({ path: path.join(cwd, ".env.local"), override: true, quiet: true });
}
```

**Integration note:** `**AuraClient`** never imports this file — browser apps must inject `NEXT_PUBLIC_*` / `VITE_*` / runtime `configure()` themselves. `**AuraServer**` calls `loadCliEnvFiles(process.cwd())` once on first log via `ensureNodeEnvLoadedOnce()`.

---

## Shared wire utilities

### HTTP(S) and WebSocket bases — `utils/backend-origin.ts`

```34:67:node/src/utils/backend-origin.ts
/** HTTPS base for `/api/`* requests (env `AURALOGGER_API_URL` overrides). */
export function resolveApiBaseUrl(): string {
  const fromEnv = readEnvTrimmed("AURALOGGER_API_URL");
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }
  return DEFAULT_AURALOGGER_WEB_ORIGIN;
}

/** WebSocket base URL with no path (env `AURALOGGER_WS_URL` overrides). */
export function resolveWsBaseUrl(): string {
  const fromEnv = readEnvTrimmed("AURALOGGER_WS_URL");
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }
  return httpOriginToWsBase(DEFAULT_AURALOGGER_ORIGIN);
}

/**
 * `POST /api/{project_token}/proj_auth` — token is URL-encoded in the path (no `secret` header).
 */
export function buildProjAuthUrl(apiBaseUrl: string, projectToken: string): string {
  const base = trimTrailingSlash(apiBaseUrl.trim());
  return `${base}/api/${encodeURIComponent(projectToken.trim())}/proj_auth`;
}

/**
 * `POST /api/{project_token}/logs` — filtered log fetch (`get-logs`).
 * Header **`secret`** must be the **user secret** (not the project token).
 */
export function buildProjectLogsUrl(apiBaseUrl: string, projectToken: string): string {
  const base = trimTrailingSlash(apiBaseUrl.trim());
  return `${base}/api/${encodeURIComponent(projectToken.trim())}/logs`;
}
```

**Design detail:** `**resolveApiBaseUrl`** defaults to `**DEFAULT_AURALOGGER_WEB_ORIGIN**` (`https://auralogger.com`), while `**resolveWsBaseUrl**` defaults from `**DEFAULT_AURALOGGER_ORIGIN**` (`https://api.auralogger.com`) mapped to `**wss://api.auralogger.com**`. Custom deployments must set `**AURALOGGER_API_URL**` / `**AURALOGGER_WS_URL**` consistently if hosts diverge.

### Env readers — `utils/env-config.ts` (tokens, session, styles precedence)

**Project token resolution** tries private then public bundler keys:

```58:64:node/src/utils/env-config.ts
export function getResolvedProjectToken(): string | undefined {
  return (
    trimEnv(ENV_PROJECT_TOKEN) ??
    trimEnv(ENV_NEXT_PUBLIC_PROJECT_TOKEN) ??
    trimEnv(ENV_VITE_PROJECT_TOKEN)
  );
}
```

**Styles JSON in env** (any of three keys via `trimEnvAny`):

```78:92:node/src/utils/env-config.ts
export function tryParseResolvedStyles(): unknown[] | null {
  const raw = trimEnvAny(getResolvedStylesKey());
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
```

**SDK local echo styling** merges env-over-hydrated:

```94:107:node/src/utils/env-config.ts
/**
 * Styles for SDK console output: same precedence as `get-logs` — embedded
 * `AURALOGGER_PROJECT_STYLES` / `NEXT_PUBLIC_`* / `VITE_*` wins, then values
 * hydrated from `POST .../proj_auth`, then `[]` (defaults inside `printLog`).
 */
export function resolveStylesForConsolePrint(
  runtimeFromProjAuth: unknown,
): unknown {
  const fromEnv = tryParseResolvedStyles();
  if (fromEnv !== null) {
    return fromEnv;
  }
  return runtimeFromProjAuth ?? [];
}
```

### JSON error extraction — `utils/http-utils.ts`

Used by `**fetchProjAuthConfig**` (`init.ts`) and `**AuraClient**`’s local `fetchProjAuthConfig`, and `**get-logs**` error paths.

```1:19:node/src/utils/http-utils.ts
export async function parseErrorBody(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return `Request failed with status ${response.status}.`;
  }

  const body: unknown = await response.json().catch(() => null);
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string" &&
    (body as { error: string }).error.trim()
  ) {
    return (body as { error: string }).error.trim();
  }

  return `Request failed with status ${response.status}.`;
}
```

### Socket idle shutdown — `utils/socket-idle-close.ts`

```1:2:node/src/utils/socket-idle-close.ts
/** Close the ingest WebSocket after this many ms with no log activity (package-managed). */
export const DEFAULT_SOCKET_IDLE_CLOSE_MS = 60_000;
```

Both `**AuraServer**` and `**AuraClient**` schedule `**bumpSocketIdleTimer**` on **open** and before **send** when already open — **optimisation** to avoid holding sockets forever in long-lived servers.

---

## Styling pipeline (`proj_auth` → terminal)

### Normalisation — `cli/utility/log-styles.ts`

`buildStyleEntriesFromProjAuth` accepts `**null`**, **JSON string**, **array**, or **object keyed by log type**; always produces an array of single-key objects suitable for env export.

```208:230:node/src/cli/utility/log-styles.ts
export function buildStyleEntriesFromProjAuth(
  styles: unknown,
): Record<string, LogStyleSpec | Record<string, unknown>>[] {
  const unwrapped = unwrapProjAuthStyles(styles);
  if (unwrapped === null || unwrapped === undefined) {
    return buildStyleEntriesFromApi([]);
  }
  if (Array.isArray(unwrapped)) {
    return buildStyleEntriesFromApi(unwrapped);
  }
  if (!isPlainObject(unwrapped)) {
    return buildStyleEntriesFromApi([]);
  }
  const rows: unknown[] = [];
  for (const [type, spec] of Object.entries(unwrapped)) {
    const t = type.trim();
    if (!t || !isPlainObject(spec)) {
      continue;
    }
    rows.push({ type: t, styles: mapProjAuthTypeStyle(spec) });
  }
  return buildStyleEntriesFromApi(rows);
}
```

`**importance` sort** inside `buildStyleEntriesFromApi` stabilises override order when the API sends rows out of order.

### Terminal render — `cli/services/log-print.ts`

```55:72:node/src/cli/services/log-print.ts
export function printLog(log: PrintableLogRow, configStyles: unknown): void {
  try {
    const spec = resolveLogStyleSpec(
      typeof log.type === "string" ? log.type : "",
      configStyles,
    );
    const loc = String(log.location ?? "");
    console.log(
      rgbPaint(spec["time-color"], formatCreatedAtTimeOnly(log.created_at)),
      spec.icon,
      rgbPaint(spec["type-color"], log.type),
      rgbPaint(spec["location-color"], loc),
    );
    console.log(rgbPaint(spec["message-color"], String(log.message ?? "")));
  } catch {
    printLogPlain(log);
  }
}
```

**Optimisation / resilience:** `**chalk.rgb`** is wrapped in `**rgbPaint**` try/catch; any style resolution failure falls back to `**printLogPlain**` so logs still print.

---

## Flow: `auralogger init`

`changes required`

`1. first try checking for project token, if in env okay else ask to type, then do proj_auth request using the token. if encrypted true then check for user secret or do typing prompt, if encrypted false then go ahead with showing the instructions about adding the logger code snippet involving the index exported client side auralogger in node or the non encrypted flow code snippet for python`  
`and do rest of it like we usually do`  
`if encrypted is true then we already have the right flow for it rn, use that same so everything else is same except this`  

### Entry sequence

1. Bin `**main()**` calls `**runInit()**` (`init.ts`).
2. `**runInit**` immediately calls `**loadCliEnvFiles()**` again (same cwd).
3. **Fast path:** if `**getResolvedProjectToken()`**, `**getResolvedUserSecret()**`, and `**getResolvedSession()**` are all truthy, `**printAlreadyConfiguredSuccess()**` runs and **returns without any HTTP** — **optimisation** for repeat inits.

```514:533:node/src/cli/services/init.ts
export async function runInit(): Promise<void> {
  loadCliEnvFiles();

  if (getCommandAttemptCount("init") >= 2) {
    const a = pickAside(INIT_REPEAT_INTENT_ASIDES);
    printAsideMaybe(a.emoji, a.line, 0.12);
  }

  const hasProjectToken = Boolean(getResolvedProjectToken());
  const projectTokenWasAlreadyInEnv = hasProjectToken;
  const hasUserSecret = Boolean(getResolvedUserSecret());
  const userSecretWasAlreadyInEnv = hasUserSecret;
  const hasSession = Boolean(getResolvedSession());
  const sessionWasAlreadyInEnv = hasSession;

  if (hasProjectToken && hasUserSecret && hasSession) {
    printAlreadyConfiguredSuccess();
    maybePrintGenericSpice();
    return;
  }
```

### Credential resolution

- `**resolveProjectTokenForInit**`: env via `**getResolvedProjectToken()**` else `**promptForProjectToken()**` (readline).
- `**resolveUserSecretForInit**`: `**getResolvedUserSecret()**` else prompt.

```91:107:node/src/cli/services/init.ts
/** Project token from env or interactive prompt. */
export async function resolveProjectTokenForInit(): Promise<string> {
  const envProjectToken = getResolvedProjectToken();
  if (envProjectToken) {
    return envProjectToken;
  }
  return promptForProjectToken();
}

/** User secret from env or interactive prompt. */
export async function resolveUserSecretForInit(): Promise<string> {
  const envUserSecret = getResolvedUserSecret();
  if (envUserSecret) {
    return envUserSecret;
  }
  return promptForUserSecret();
}
```

### HTTP: `fetchProjAuthConfig`

```126:153:node/src/cli/services/init.ts
export async function fetchProjAuthConfig(projectToken: string): Promise<InitConfigPayload> {
  const baseUrl = resolveApiBaseUrl();

  const response = await fetch(buildProjAuthUrl(baseUrl, projectToken), {
    method: "POST",
  }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger right now — check your network or VPN, then try again. (${msg}) ${ENV_RECOVERY_HINT_PLAIN}`,
    );
  });

  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }

  const authResponse: unknown = await response.json().catch(() => {
    throw new Error("Got a reply, but it wasn’t readable JSON. Try again in a moment.");
  });

  if (!isPlainAuthResponse(authResponse)) {
    throw new Error(
      `The reply didn’t look right. Double-check ${ENV_PROJECT_TOKEN} or run npx auralogger init.`,
    );
  }

  return buildConfigPayload(authResponse, projectToken);
}
```

**Payload shaping:** `**buildConfigPayload`** injects `**project_token**` and runs `**buildStyleEntriesFromProjAuth**` on `**authResponse.styles**` so CLI output matches env JSON shape.

`**encrypted` normalisation** (recent change): the `ProjAuthResponse` interface now types `encrypted` as `boolean | string | null` because PostgREST may return the string `"true"`. `buildConfigPayload` normalises it:

```typescript
const rawEncrypted = authResponse.encrypted ?? authResponse.encryption ?? true;
const encrypted = rawEncrypted === true || rawEncrypted === "true";
```

`**project_name` resolution** (recent change): `buildConfigPayload` now prefers the `name` field and falls back to `project_name` for backward compat with older API shapes:

```typescript
project_name: authResponse.name ?? authResponse.project_name ?? null,
```

### Output: dotenv block + snippets

- `**printCopyPasteEnvBlock**` omits lines already present in env (token / secret / session dedupe).
- `**printInitHelperSnippetsWithCharacterVoices**` prints `**buildAuraClientWrapperSnippet**` and `**buildAuraServerWrapperSnippet**` strings with syntax highlighting via `**printCodeStory**`.

### Shared helper: `resolveProjectContextForCliChecks`

Used by `**server-check**`, `**client-check**`, and mirrors `**AuraServer.syncFromSecret**`’s credential model comment in source.

```155:178:node/src/cli/services/init.ts
/**
 * Same credential model as `AuraServer.syncFromSecret`: only the project token
 * must be available locally; id + session come from `POST /api/{project_token}/proj_auth`.
 */
export async function resolveProjectContextForCliChecks(): Promise<{
  projectToken: string;
  userSecret: string;
  projectId: string;
  projectName: string;
  session: string;
}> {
  const projectToken = await resolveProjectTokenForInit();
  const userSecret = await resolveUserSecretForInit();
  const payload = await fetchProjAuthConfig(projectToken);
  const projectId = payload.project_id?.trim() ?? "";
  const projectName = payload.project_name?.trim() ?? "";
  const session = payload.session?.trim() ?? "";
  if (!projectId || !session) {
    throw new Error(
      `${ENV_PROJECT_TOKEN} looks off, or the API didn’t return project id + session — ${ENV_RECOVERY_HINT_PLAIN}`,
    );
  }
  return { projectToken, userSecret, projectId, projectName, session };
}
```

**Integration:** `**AuraServer`** imports this same `**fetchProjAuthConfig**` from `**../cli/services/init**`, so **CLI and server SDK always share** the same HTTP contract and error strings for `proj_auth`.

---

## Flow: `auralogger get-logs`

`there has been some changes in filter fields for the api we request the logs for`

`here is the updated route`

```markdown


### `POST /api/{project_token}/logs`

Token-path log query. Behaviour branches on `projects.encrypted` and whether `user_secret` is supplied. The handler reads `projects.encrypted` with **strict** boolean `true` only (unlike `proj_auth`, which also treats the string `'true'` as encrypted).

**Expects**


| Kind    | Value                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Path    | `project_token` — token ciphertext (URL-encoded).                                                             |
| Headers | `user_secret`: **optional** (trimmed). Omit to **skip decryption** and receive raw (possibly encrypted) log rows. |
| Body    | JSON: `{ "filters": Filter[] }`.                                                                              |


**Execution paths**

**Path A — `projects.encrypted = false`** (unencrypted project):

- All filters including `message` and `data.`* are applied directly at the DB level using `ILIKE`.
- If `user_secret` is present **and** the path token role is `owner`, `collaborator`, or `viewer`, the project secret is resolved and passed for any legacy `iv`-tagged rows (`ingestion` tokens cannot resolve the secret — omit `user_secret` or expect `401` `Failed to resolve project secret`).
- Returns `{ "logs": [...], "nextpage": <id> | null }`.

**Path B — `projects.encrypted = true` + `user_secret` present** (encrypted, decrypt requested):

- `message` and `data.`* filters are separated from structural filters (`type`, `location`, `session`, `time`, `nextpage`).
- Internal batch loop:
  1. Query DB with structural filters + cursor; batch size = requested `maxcount`.
  2. Decrypt each row (`message` and `data`) using the resolved project secret.
  3. Apply `message` / `data.*` filters in memory (case-insensitive substring / field equality).
  4. Accumulate results; if fewer than `maxcount` collected and DB returned a full batch, advance the cursor and repeat.
- `nextpage` returned to the client is the `id` of the last DB row in the final batch (not the last collected row), allowing correct resumption even when some rows are filtered out post-decryption.

**Path C — `projects.encrypted = true`, no `user_secret`** (encrypted, raw):

- `message` and `data.`* filters are stripped (cannot evaluate ciphertext).
- Structural filters are applied at the DB level.
- Rows are returned as stored (ciphertext in `message` / `data` when `iv` is set).

**Decryption flow** (Paths A and B when `user_secret` is present):

1. Resolve token row by path `project_token` (roles allowed to derive `project_secret`: `owner`, `collaborator`, `viewer` — not `ingestion`).
2. Read `owner_key` from `projects` for that `project_id`.
3. Derive shared key: `deriveSharedSecret(user_secret, owner_key)` (X25519 ECDH + HKDF-SHA256, salt = empty, info = `project-key`, 32 bytes — see `[project-token-crypto.ts](../src/lib/crypto/project-token-crypto.ts)`).
4. Decrypt the **path token** using the token-row `iv` to get `project_secret`.
5. For each log row: if `iv` is set, decrypt `message`; decrypt `data` when non-empty.

**Returns** `200`

```json
{
  "logs": [ /* rows */ ],
  "nextpage": 18423 | null
}
```

`nextpage` is `null` when the DB returned fewer rows than `maxcount` (no further results). Otherwise it is the `id` of the last row in the batch; pass it as `{ "field": "nextpage", "op": "eq", "value": <nextpage> }` in the next request.

**Errors**


| Status | Body (representative)                                                                 |
| ------ | ------------------------------------------------------------------------------------- |
| 400    | `{ "error": "Invalid JSON body" }`; filter / body validation messages               |
| 401    | `{ "error": "Invalid token" }` (unknown token **or** `project_tokens` query error); `{ "error": "Failed to resolve project secret" }` |
| 500    | `{ "error": "Failed to resolve project" }`, `{ "error": "Failed to fetch logs" }`, etc. |
| 503    | `LOGS_SCHEMA_UNAVAILABLE` (missing `logs` relation on query)                         |

Token path does **not** return `PROJECT_TOKENS_SCHEMA_UNAVAILABLE`: a missing or broken `project_tokens` lookup surfaces as **`401` `Invalid token`**.


---

### Filter DSL (shared)

Used by both `POST /api/projects/{project_id}/logs` and `POST /api/{project_token}/logs`.

**Default `op` when omitted**


| Field / prefix                  | Default `op` |
| ------------------------------- | ------------ |
| `type`                          | `in`         |
| `message`                       | `contains`   |
| `location`                      | `in`         |
| `session`                       | `eq`         |
| `time`                          | `since`      |
| `data.`*                        | `eq`         |
| `order`, `maxcount`, `nextpage` | `eq`         |


**Allowed ops**


| Field         | Ops                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------- |
| `type`        | `in`, `not-in`                                                                            |
| `message`     | `contains`, `not-contains`                                                                |
| `location`    | `in`, `not-in`                                                                            |
| `session`     | `eq`                                                                                      |
| `time`        | `since`, `from-to`                                                                        |
| `order`       | `eq` — `["newest-first"]` or `["oldest-first"]`                                           |
| `maxcount`    | `eq` — number, max **100** (default **50**)                                               |
| `nextpage`    | `eq` — integer `id` of the last row from the previous page; omit (or null) for first page |
| `data.<path>` | `eq` — value is a one-element array                                                       |


**Example body**

```json
{
  "filters": [
    { "field": "type", "value": ["error", "warn"] },
    { "field": "message", "value": ["db", "timeout"] },
    { "field": "time", "value": ["10m"] },
    { "field": "data.userId", "value": ["123"] },
    { "field": "order", "value": ["newest-first"] },
    { "field": "maxcount", "value": 50 },
    { "field": "nextpage", "value": 18423 }
  ]
}
```

**Cursor pagination flow:**

1. First request: omit `nextpage` (or set `null`).
2. Server returns `{ "logs": [...], "nextpage": 18423 }`.
3. Next request: add `{ "field": "nextpage", "op": "eq", "value": 18423 }` to filters.
4. Repeat until `nextpage` is `null` (no more results).

Encrypted-at-rest rows (**non-empty `iv`**): `message` / `data.*` filters apply after server-side decryption when a project secret is available (backend `**/crypto/decrypt`** via `[project-token-crypto.ts](../src/lib/crypto/project-token-crypto.ts)`; see `[backend-crypto-http.md](infra/frontend/utils/backend-crypto-http.md)`).

---

```

### Top-level: `runGetLogs`

```229:246:node/src/cli/services/get-logs.ts
export async function runGetLogs(argv: string[]): Promise<void> {
  loadCliEnvFiles();
  if (!getResolvedProjectToken() && getSuccessfulRunCount("init") === 0) {
    const a = pickAside(GET_LOGS_SKIPPED_SETUP_INTENT_ASIDES);
    printAsideMaybe(a.emoji, a.line, 0.12);
  }

  console.log(
    chalk.bold.hex("#79c0ff")("📜 ") + chalk.white("get-logs — opening the archive…"),
  );
  {
    const a = pickAside(GET_LOGS_OPEN_ASIDES);
    printAsideMaybe(a.emoji, a.line, 0.12);
  }
  const { projectToken, userSecret, styles } = await resolveGetLogsAuth();
  await runGetLogsCore(projectToken, userSecret, styles, argv);
  maybePrintGenericSpice();
}
```

### Auth + styles: `resolveGetLogsAuth` (env short-circuit = optimisation)

```182:227:node/src/cli/services/get-logs.ts
async function resolveGetLogsAuth(): Promise<{
  projectToken: string;
  userSecret: string;
  styles: unknown;
}> {
  loadCliEnvFiles();
  const projectToken = await resolveProjectTokenForInit();
  const userSecret = await resolveUserSecretForInit();
  const stylesFromEnv = tryParseResolvedStyles();
  if (stylesFromEnv !== null) {
    return { projectToken, userSecret, styles: stylesFromEnv };
  }

  try {
    const payload = await fetchProjAuthConfig(projectToken);
    console.log(
      chalk.hex("#79c0ff")("🎨 ") +
        chalk.white("No styles in your shell — using freshly fetched styling for this run."),
    );
    {
      const a = pickAside(GET_LOGS_STYLES_ASIDES);
      printAside(a.emoji, a.line);
    }
    if (Math.random() < 0.35) {
      const d = pickAside(GET_LOGS_DEADPOOL_SCROLL_ASIDES);
      printAside(d.emoji, d.line);
    }
    return { projectToken, userSecret, styles: payload.styles };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(
      chalk.yellow("⚠️ ") +
        chalk.white(
          `Couldn’t load styles from the API (${msg}). Using default terminal colors for log lines.`,
        ),
    );
    console.log(
      chalk.dim("   Set ") +
        chalk.cyan("AURALOGGER_PROJECT_STYLES") +
        chalk.dim(" (or NEXT_PUBLIC_/VITE_…) from ") +
        chalk.cyan("auralogger init") +
        chalk.dim(" to match the dashboard, or fix API/network access."),
    );
    return { projectToken, userSecret, styles: undefined };
  }
}
```

**Optimisation:** valid `**AURALOGGER_PROJECT_STYLES`** (or public variants) avoids an extra `**proj_auth**` round-trip.

**Resilience:** if `**proj_auth`** fails, `**get-logs` still proceeds** with `**styles: undefined`** → `**printLog**` uses defaults.

### Arg parsing → API filter JSON

1. `**parseCommand(argv)**` in `**cli/utility/parser.ts**` — requires `**argv[0] === "get-logs"**` and parses repeated `**-field [--op] <json>**` triples.
2. `**normalizeAndValidateFilters**` in `**get-logs-filters.ts**` — fills default ops, validates allowed ops, **clamps** `**maxcount`** to `**MAX_MAXCOUNT` (100)** and floors `**nextpage`** to an integer.

```57:87:node/src/cli/services/get-logs-filters.ts
export function normalizeAndValidateFilters(parsed: ParsedFilter[]): ApiLogFilter[] {
  return parsed.map((filter) => {
    const defaultOp = defaultOpForField(filter.field);
    const allowedOps = allowedOpsForField(filter.field);
    if (allowedOps.length === 0) {
      throw new Error(`Unknown filter field: ${filter.field}`);
    }

    const resolvedOp = filter.op ?? defaultOp;
    if (!allowedOps.includes(resolvedOp)) {
      throw new Error(
        `Invalid op '${resolvedOp}' for field '${filter.field}'. Allowed: ${allowedOps.join(", ")}`,
      );
    }

    let value = filter.value;
    if (filter.field === "maxcount" && typeof value === "number") {
      value = Math.min(Math.max(0, Math.floor(value)), MAX_MAXCOUNT);
    }
    if (filter.field === "nextpage" && typeof value === "number") {
      value = Math.floor(value);
    }

    const apiFilter: ApiLogFilter = { field: filter.field, value };
    if (resolvedOp !== defaultOp) {
      apiFilter.op = resolvedOp;
    }

    return apiFilter;
  });
}
```

### HTTP: `fetchLogsWithFallback`

```52:105:node/src/cli/services/get-logs.ts
async function fetchLogsWithFallback(
  baseUrl: string,
  projectToken: string,
  userSecret: string,
  filters: unknown,
): Promise<{ body: LogsResponseBody; logsEndpointNotFound: boolean }> {
  const route = buildProjectLogsUrl(baseUrl, projectToken);

  const requestBody = JSON.stringify({ filters });
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      secret: userSecret,
      user_secret: userSecret,
      "content-type": "application/json",
    },
    body: requestBody,
  };

  const response = await fetch(route, requestInit).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger to fetch logs — check connection and try again. (${message}) ${ENV_RECOVERY_HINT_PLAIN}`,
    );
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.log(
        chalk.yellow("⚠️ ") +
          chalk.white("POST ") +
          chalk.dim("/api/{project_token}/logs") +
          chalk.white(
            " returned 404 — wrong API host, old backend, or route not deployed. ",
          ) +
          chalk.dim("Check ") +
          chalk.cyan("AURALOGGER_API_URL") +
          chalk.dim("."),
      );
      return { body: { logs: [] }, logsEndpointNotFound: true };
    }
    const body = await parseErrorBody(response);
    const authish = response.status === 401 || response.status === 403;
    throw new Error(authish ? `${body} ${ENV_RECOVERY_HINT_PLAIN}` : body);
  }

  const body: unknown = await response.json().catch(() => {
    throw new Error("The log list came back garbled (not JSON). Try again?");
  });
  if (!isRecord(body)) {
    throw new Error("The log list didn’t look right. Weird — try again.");
  }
  return { body, logsEndpointNotFound: false };
}
```

**Integration / degradation:** **404** returns **empty logs** with a **yellow warning** instead of throwing — lets operators detect misconfigured `**AURALOGGER_API_URL`** without a stack trace.

### Rendering loop

```164:179:node/src/cli/services/get-logs.ts
  let printed = 0;
  for (const item of logs) {
    if (isLogRow(item)) {
      printLog(item, configStyles);
      printed += 1;
    }
  }
  if (printed > 0) {
    {
      const t = pickAside(GET_LOGS_SUCCESS_TEMPLATES);
      printAside(
        t.emoji,
        formatAsideTemplate(t.line, { n: printed }),
      );
    }
  }
```

**Type guard:** only plain objects pass `**isLogRow`**; garbage array entries are skipped silently.

---

## Flow: `auralogger server-check`

### Sequence

1. `**loadCliEnvFiles()**`
2. `**resolveProjectContextForCliChecks()**` → `**proj_auth**` HTTP (see init section)
3. Build `**wss://…/{encodeURIComponent(token)}/create_log**`
4. `**ws**` with `**Authorization: Bearer ${userSecret}**`
5. On `**open**`: build payload with `**session**` from `proj_auth`, microsecond-ish timestamp, `**ws.send**`, `**ws.close**`
6. **5s** connect timeout → `**ws.terminate()`** + Wolverine aside + error

```33:119:node/src/cli/services/server-check.ts
export async function runServerCheck(): Promise<void> {
  loadCliEnvFiles();
  const { projectToken, userSecret, projectId, projectName, session } =
    await resolveProjectContextForCliChecks();

  const wsUrl = buildWsUrl(projectToken);
  console.log(
    chalk.dim("📡 ") +
      chalk.white("Pinging the ") +
      chalk.bold.white("server") +
      chalk.white(" logger — one tiny test log coming up…"),
  );
  {
    const a = pickAside(SERVER_CHECK_OPEN_ASIDES);
    printAside(a.emoji, a.line);
  }
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        authorization: `Bearer ${userSecret}`,
      },
    });

    const timeout = setTimeout(() => {
      ws.terminate();
      {
        const w = pickAside(SERVER_CHECK_FAIL_WOLVERINE_ASIDES);
        printAside(w.emoji, w.line);
      }
      reject(
        new Error(
          "Server logger socket didn't open in time — still quiet. Check VPN/Wi‑Fi, firewall, AURALOGGER_WS_URL if you override it, and that token + user secret match this project. " +
            ENV_RECOVERY_HINT_PLAIN,
        ),
      );
    }, CONNECT_TIMEOUT_MS);

    ws.once("open", () => {
      clearTimeout(timeout);

      const nowMs = Date.now();
      const payload = {
        type: "info",
        message: "this is from cli server-check",
        location: "cli/server-check",
        session,
        created_at: createIsoTimestampWithMicroseconds(nowMs),
        data: JSON.stringify({ kind: "server-check" }),
      };

      let sendPayload = "";
      try {
        sendPayload = JSON.stringify(payload);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        ws.close();
        reject(new Error(`Couldn't pack the test log: ${msg}`));
        return;
      }

      ws.send(sendPayload, (error?: Error) => {
        if (error) {
          ws.close();
          reject(
            new Error(`Log didn't send — ${error.message}`),
          );
          return;
        }

        ws.close();
        resolve();
      });
    });

    ws.once("error", (error: Error) => {
      clearTimeout(timeout);
      {
        const w = pickAside(SERVER_CHECK_FAIL_WOLVERINE_ASIDES);
        printAside(w.emoji, w.line);
      }
      reject(
        new Error(
          `Server pipe wouldn't open (${error.message}). Verify creds in .env, run from the folder that loads them, then try again. ${ENV_RECOVERY_HINT_PLAIN}`,
        ),
      );
    });
  });
```

**Payload parity:** each log object mirrors `**AuraServer`** fields (`type`, `message`, `location`, `session`, `created_at`, `data` as **string** JSON). On the live SDK path, the WebSocket sends **batches**: a JSON **array** of those objects, not a single object per frame.

---

## Flow: `auralogger client-check`

```markdown

### WS `/{proj_token}/create_browser_logs`

Plain-text (unencrypted) WebSocket endpoint for browser/frontend SDKs.


|               |                                          |
| ------------- | ---------------------------------------- |
| **Protocol**  | WebSocket                                |
| **Path**      | `/{proj_token:path}/create_browser_logs` |
| **Auth**      | None (token in path only)                |
| **Max batch** | 50 items                                 |


**Handshake** — server may still hydrate project context via `proj_auth`, but the browser-style socket itself is **path-token only** (no Bearer header, no X25519 key derivation).

**Message format** — JSON array sent by client

```json
[
  {
    "type": "info | warn | error | debug",
    "session": "<session-id>",
    "created_at": "ISO-8601 timestamp",
    "message": "<plain string>",
    "data": "<plain string or JSON>",
    "location": "<plain string>"
  }
]
```

**Conditions / validation**

- Same token/project constraints as `create_log`.
- Fields are stored and published as-is (no decryption step).

**Output** — same Redis publish + list push.

**Flow diagram**

```mermaid
sequenceDiagram
    participant C as Browser SDK
    participant S as This Service
    participant B as Backend (proj_auth)
    participant R as Redis

    C->>S: WS connect /{proj_token}/create_browser_logs
    S->>B: POST /api/{proj_token}/proj_auth
    B-->>S: {project_id, role, ...}
    S-->>C: WS accept
    C->>S: JSON array of plain log objects (≤50)
    loop for each log
        S->>R: PUBLISH project_id log_json
        S->>R: LPUSH logs:{project_id} log_json
    end
    R->>R: LTRIM logs:{project_id} 0 999
```


```

CLI `client-check` mirrors this: it only needs a **project token** (env or prompt), hydrates `session` from `proj_auth`, then opens the WS tunnel and sends a **one-item JSON array**.

---



**CLI sequence:** token → `proj_auth` (no auth header) → WS `/create_browser_logs` (no auth header) → send `[payload]`.

```39:159:node/src/cli/services/client-check.ts
export async function runClientCheck(): Promise<void> {
  loadCliEnvFiles();
  const projectToken = await resolveProjectTokenForInit();
  const authConfig = await fetchProjAuthConfig(projectToken);
  const projectId = authConfig.project_id?.trim() ?? "";
  const projectName = authConfig.project_name?.trim() ?? "";
  const session = authConfig.session?.trim() ?? "";
  if (!projectId || !session) {
    throw new Error(
      `proj_auth didn't return project_id or session — ${ENV_RECOVERY_HINT_PLAIN}`,
    );
  }

  const wsUrl = buildClientWsUrl(projectToken);
  console.log(
    chalk.dim("🌐 ") +
      chalk.white("Trying the ") +
      chalk.bold.white("browser-style") +
      chalk.white(" log tunnel (path-only socket auth)…"),
  );
  {
    const a = pickAside(CLIENT_CHECK_START_PETER_ASIDES);
    printAside(a.emoji, a.line);
  }
  const sendAttempt = async (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      // ... timeout, open handler, send JSON.stringify([payload]), close, error ...
    });
  // ... retry loop and success banner ...
}
```

**Note:** Unlike `server-check`, this path **never** resolves a user secret; it validates `project_id` + `session` from `proj_auth`, then sends over the token-path socket.

---

## Flow: `AuraServer` (Node SDK)

### Module-level state (hydration + socket)

Key globals in `**server/server-log.ts**`: `**overrideProjectToken` / `overrideUserSecret**`, `**runtimeProjectId` / `runtimeSession` / `runtimeStyles**`, `**hydrateFromSecretPromise**` (single-flight), `**socket` + `socketUrl**`, `**socketIdleTimer**`, `**bufferedLogs**` + `**flushTimer**` + `**flushInFlight**` (ingest batching), `**localSessionId**` (placeholder session until `proj_auth`).

### Lazy env load (first log)

```99:108:node/src/server/server-log.ts
function ensureNodeEnvLoadedOnce(): void {
  if (nodeEnvLoaded) {
    return;
  }
  if (typeof process === "undefined" || !process.versions?.node) {
    return;
  }
  nodeEnvLoaded = true;
  loadCliEnvFiles(process.cwd());
}
```

### Single-flight `proj_auth` hydration

```65:118:node/src/server/server-log.ts
async function ensureHydratedRuntimeConfig(): Promise<void> {
  const projectToken = resolvedProjectToken();
  if (!projectToken) {
    return;
  }

  if (runtimeProjectId && runtimeSession && runtimeStyles !== undefined) {
    return;
  }

  if (!hydrateFromSecretPromise) {
    hydrateFromSecretPromise = (async () => {
      const token = resolvedProjectToken();
      if (!token) {
        return;
      }
      let payload: InitConfigPayload | null = null;
      for (let attempt = 1; attempt <= SDK_RETRY_ATTEMPTS; attempt += 1) {
        try {
          payload = await fetchProjAuthConfig(token);
          break;
        } catch (error: unknown) {
          if (attempt >= SDK_RETRY_ATTEMPTS) {
            throw error;
          }
          const msg = error instanceof Error ? error.message : String(error);
          console.warn(
            `auralogger: proj_auth failed (${msg}); retrying (${attempt + 1}/${SDK_RETRY_ATTEMPTS})...`,
          );
          await new Promise((r) => setTimeout(r, SDK_RETRY_DELAY_MS));
        }
      }
      if (!payload) {
        return;
      }
      const projectId = payload.project_id?.trim() ?? "";
      const session = payload.session?.trim() ?? "";
      if (!projectId || !session) {
        throw new Error(
          "auralogger: proj_auth response missing project id or session.",
        );
      }
      applyProjAuthPayload(payload);
    })();
  }

  try {
    await hydrateFromSecretPromise;
  } catch (error: unknown) {
    hydrateFromSecretPromise = null;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`auralogger: could not load project config from API: ${msg}`);
  }
}
```

**Optimisation:** concurrent `**AuraServer.log`** calls **share one promise** until settled. **Failure** clears `**hydrateFromSecretPromise`** so a later log can retry. **`proj_auth`** is retried up to `**SDK_RETRY_ATTEMPTS**` with `**SDK_RETRY_DELAY_MS**` between attempts.

### Local console echo vs WebSocket ingest

- **Console first:** `**processServerlogAsync**` builds a `**LogPayload**` with `**getOrCreateLocalSession()**` (placeholder `**LOCAL_FALLBACK_SESSION**` until the server session exists), then calls `**printLog**` in a try/catch so the terminal line always has a chance to render even if the network path fails.
- **Styles:** `**runtimeStyles**` may still be `**undefined**` before hydrate; `**resolveStylesForConsolePrint(runtimeStyles)**` supplies defaults so coloring does not depend on `**proj_auth**` having returned yet.
- **Ingest gate:** if `**resolvedProjectToken()**` or `**resolvedUserSecret()**` is missing, the function returns **after** printing — no socket, no batch enqueue. Otherwise it `**await**`s `**ensureHydratedRuntimeConfig**`, checks `**runtimeProjectId**` and `**runtimeSession**`, sets `**payload.session = runtimeSession**`, then enqueues for the WebSocket path.

### WebSocket ingest batching

Constants: `**BATCH_FLUSH_INTERVAL_MS**` (30) and `**BATCH_MAX_SIZE**` (30). Each log line is pushed with `**enqueueLogForBatch**`; reaching max size flushes immediately, otherwise a timer debounces sends. `**flushBufferedLogsNow**` drains `**bufferedLogs**` in chunks of up to `**BATCH_MAX_SIZE**`. The wire payload is `**JSON.stringify(batch)**` where `**batch**` is a **JSON array** of `**LogPayload**` objects — not one object per `**ws.send**`.

`**sendServerLogBatch**` / `**sendServerBatch**` handle **OPEN** vs **CONNECTING**, bump the idle timer, and on send failure close the socket, reconnect, and retry once with the same serialized batch. `**AuraServer.closeSocket**` begins with `**await flushBufferedLogsNow()**` so nothing is left in the buffer before shutdown. `**AuraServer.configure**` calls `**resetBufferedLogs()**` so credentials or project changes do not mix payloads across batches.

### `AuraServer.log` — `deferTask` entry

```551:562:node/src/server/server-log.ts
  static log(type: string, message: string, location?: string, data?: unknown): void {
    ensureNodeEnvLoadedOnce();
    const nowMs = Date.now();
    deferTask(() => {
      void processServerlogAsync(type, message, nowMs, location, data).catch(
        (error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`auralogger: log dispatch failed: ${errorMessage}`);
        },
      );
    });
  }
```

**Why `deferTask`:** keeps the public `**log**` call from blocking the caller’s stack; the async pipeline (`**processServerlogAsync**`, hydrate, flush) runs on the next turn.

### `processServerlogAsync` — print, hydrate, enqueue batch

```455:497:node/src/server/server-log.ts
async function processServerlogAsync(
  type: string,
  message: string,
  nowMs: number,
  location?: string,
  data?: unknown,
): Promise<void> {
  ensureNodeEnvLoadedOnce();

  const payload: LogPayload = {
    type: normalizeType(type),
    message: String(message ?? ""),
    session: getOrCreateLocalSession(),
    created_at: createIsoTimestampWithMicroseconds(nowMs),
  };
  const normalizedLocation = normalizeLocation(location);
  if (normalizedLocation) {
    payload.location = normalizedLocation;
  }
  const normalizedData = maybeData(data);
  if (normalizedData) {
    payload.data = normalizedData;
  }

  try {
    printLog(payload, resolveStylesForConsolePrint(runtimeStyles));
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`auralogger: failed to print log: ${errMsg}`);
  }

  if (!resolvedProjectToken() || !resolvedUserSecret()) {
    return;
  }

  await ensureHydratedRuntimeConfig();
  if (!runtimeProjectId || !runtimeSession) {
    return;
  }

  payload.session = runtimeSession;
  enqueueLogForBatch(payload);
}
```

`**maybeData`:** only **plain objects** stringify; primitives other than string are dropped (strings pass through). **Non-plain** objects won’t be sent as `data`.

### `ensureSocket` — reuse + idle timer

```280:310:node/src/server/server-log.ts
function ensureSocket(): WebSocket | null {
  const projectToken = getProjectToken();
  if (!projectToken) {
    console.error(
      "auralogger: missing AURALOGGER_PROJECT_TOKEN in the environment.",
    );
    return null;
  }
  const userSecret = getUserSecret();
  if (!userSecret) {
    console.error(
      "auralogger: missing AURALOGGER_USER_SECRET in the environment.",
    );
    return null;
  }

  const url = buildWsUrl(projectToken);
  if (socket && socketUrl === url && socket.readyState === WebSocket.OPEN) {
    return socket;
  }
  if (socket && socketUrl === url && socket.readyState === WebSocket.CONNECTING) {
    return socket;
  }
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    clearSocketIdleTimer();
    socket.close();
  }
  socket = connectSocket(url, userSecret);
  socketUrl = url;
  return socket;
}
```

**Optimisation:** same **URL** + **OPEN** or **CONNECTING** reuses the socket; otherwise closes stale connection before opening a new one.

### `AuraServer.configure` vs `syncFromSecret`

- `**configure`**: sets overrides, clears hydrated cache, `**resetBufferedLogs()**`, starts **new** background `**hydrateFromSecretPromise`** (fire-and-forget).
- `**syncFromSecret**`: `**await fetchProjAuthConfig**` synchronously for callers that need strict readiness.

---

## Flow: `AuraClient` (browser-safe SDK)

### Separate `fetchProjAuthConfig` (duplicated contract)

`client/client-log.ts` implements its **own** `fetch` to `**buildProjAuthUrl`** + `**parseErrorBody**`, then `**buildStyleEntriesFromProjAuth**` on styles — **same wire shape** as CLI init, **no import** of `cli/services/init` (keeps browser bundle free of CLI readline paths).

```145:178:node/src/client/client-log.ts
async function fetchProjAuthConfig(projectToken: string): Promise<{
  project_id: string | null;
  session: string | null;
  styles: unknown;
}> {
  const response = await fetch(buildProjAuthUrl(resolveApiBaseUrl(), projectToken), {
    method: "POST",
  }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger right now — check your network or VPN, then try again. (${msg})`,
    );
  });

  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }

  const authResponse: unknown = await response.json().catch(() => {
    throw new Error("Got a reply, but it wasn’t readable JSON. Try again in a moment.");
  });

  if (!isPlainAuthResponse(authResponse)) {
    throw new Error(
      "The reply didn’t look right. Run auralogger init again or double-check your project token.",
    );
  }

  return {
    project_id: authResponse.project_id ?? null,
    session: authResponse.session ?? null,
    styles: buildStyleEntriesFromProjAuth(authResponse.styles),
  };
}
```

### Hydration gate for WebSocket

`ensureSocket` **awaits** `**ensureHydratedRuntimeConfig`** and requires `**projectId**` before opening `**create_browser_logs**`. `**getSession()**` falls back to `**auralogger-local-session**` if runtime session missing — **local echo still runs** via `**printLog`** even when socket path fails early.

### Ingest batching (same model as `AuraServer`)

`**client-log.ts**` uses the same `**BATCH_FLUSH_INTERVAL_MS**` / `**BATCH_MAX_SIZE**` pattern: `**enqueueLogForBatch**`, `**flushBufferedLogsNow**`, and a JSON **array** per send on the browser log socket. `**AuraClient.configure**` calls `**resetBufferedLogs()**`; `**AuraClient.closeSocket**` awaits `**flushBufferedLogsNow()**` first.

### Dual WebSocket implementations — `sendPayloadOverSocket` / `socketOnce`

```236:261:node/src/client/client-log.ts
function sendPayloadOverSocket(
  ws: WebSocketLike,
  sendPayload: string,
  onSendError: (error: unknown) => void,
): void {
  const nodeStyleSocket = typeof ws.on === "function";
  if (nodeStyleSocket) {
    try {
      ws.send(sendPayload, (error?: Error) => {
        if (!error) {
          return;
        }
        onSendError(error);
      });
    } catch (error: unknown) {
      onSendError(error);
    }
    return;
  }

  try {
    ws.send(sendPayload);
  } catch (error: unknown) {
    onSendError(error);
  }
}
```

**Integration:** Node `**ws`** uses callback form of `**send**`; browser `**WebSocket**` uses sync send — errors surface via try/catch only.

### `AuraClient.configure` accepts string or `{ projectToken }`

```680:697:node/src/client/client-log.ts
export class AuraClient {
  /**
   * @param projectToken Project token string, or `{ projectToken }` (object form is accepted for convenience).
   */
  static configure(projectToken: string | { projectToken: unknown }): void {
    const raw =
      typeof projectToken === "string"
        ? projectToken
        : projectToken?.projectToken;
    const token =
      typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (!token) {
      throw new Error("auralogger: projectToken cannot be empty.");
    }
    overrideProjectToken = token;
    hydrateFromSecretPromise = null;
    clearHydratedRuntimeConfig();
    resetBufferedLogs();
    localSessionId = null;
    warnedMissingProjectToken = false;
    warnedMissingProjectId = false;
  }
```

---

## Flow: `test-serverlog` / `test-clientlog`

### `test-serverlog` — real SDK path

```19:55:node/src/cli/services/test-logger.ts
export async function runTestServerlog(): Promise<void> {
  console.log(
    chalk.bold.hex("#79c0ff")("🧪 ") +
      chalk.white("Firing the ") +
      chalk.bold.white("server") +
      chalk.white(" logger — 5 peppy test logs incoming."),
  );
  console.log(chalk.dim("   (Same path your real code uses — not a fake shortcut.)"));
  {
    const a = pickAside(TEST_SERVERLOG_START_BANNER_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");

  for (let i = 1; i <= 5; i++) {
    AuraServer.log("info", `test-serverlog log ${i}/5`, "cli/test-serverlog", {
      i,
      kind: "test-serverlog",
    });
    await sleep(150);
  }

  await sleep(800);
  await AuraServer.closeSocket(3000);
  console.log("");
  console.log(
    chalk.green("✅ ") +
      chalk.white("Server burst sent. Peek with ") +
      chalk.hex("#79c0ff")("auralogger get-logs -maxcount 20") +
      chalk.white(" if the dashboard’s shy."),
  );
  {
    const a = pickTestServerlogSuccessAside();
    printAside(a.emoji, a.line);
  }
  maybePrintGenericSpice();
}
```

**Integration:** imports `**AuraServer`** from `**../../server/server-log**` — **not** the `server.ts` barrel, but equivalent at runtime after build.

### `test-clientlog` — polyfill global `WebSocket` with `ws`

```57:98:node/src/cli/services/test-logger.ts
export async function runTestClientlog(): Promise<void> {
  const root = globalThis as typeof globalThis & { WebSocket?: unknown };
  if (typeof root.WebSocket !== "function") {
    (root as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
  }

  console.log(
    chalk.bold.hex("#79c0ff")("🧪 ") +
      chalk.white("Firing the ") +
      chalk.bold.white("client") +
      chalk.white(" logger — 5 test logs, browser flavor."),
  );
  console.log(chalk.dim("   (Patches in `ws` so Node can fake a browser here.)"));
  {
    const a = pickAside(TEST_CLIENTLOG_START_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");

  for (let i = 1; i <= 5; i++) {
    AuraClient.log("info", `test-clientlog log ${i}/5`, "cli/test-clientlog", {
      i,
      kind: "test-clientlog",
    });
    await sleep(150);
  }

  await sleep(800);
  await AuraClient.closeSocket(3000);
  console.log("");
  console.log(
    chalk.green("✅ ") +
      chalk.white("Client burst sent. Spy with ") +
      chalk.hex("#79c0ff")("auralogger get-logs -maxcount 20") +
      chalk.white(" when curious."),
  );
  {
    const a = pickAside(TEST_CLIENTLOG_SUCCESS_ASIDES);
    printAside(a.emoji, a.line);
  }
  maybePrintGenericSpice();
}
```

**Why:** `**AuraClient`** uses `**globalThis.WebSocket**`; Node without global polyfill needs `**ws**` assigned.

---

## Cross-cutting failure & personality surfaces

### Global `main().catch`

```138:162:node/src/cli/bin/auralogger.ts
main().catch((error: unknown) => {
  recordCliFailure();
  const message = error instanceof Error ? error.message : String(error);
  console.error("");
  console.error(chalk.red.bold("💥 That didn't work."));
  console.error(chalk.dim("   ") + chalk.white(message));
  const fails = getConsecutiveFailures();
  if (fails >= 2 && Math.random() < 0.45) {
    const n = pickAside(WOLVERINE_NUDGE_ASIDES);
    printAside(n.emoji, n.line);
  }
  const aside = pickAdaptiveFatalAside(fails, message);
  // Crash path: bias toward showing the voice line (still useful, not buried in the red blob).
  printAsideMaybe(aside.emoji, aside.line, 0.08);
  const errKind = classifyErrorForAside(message);
  if (
    (errKind === "network" || errKind === "auth-env") &&
    Math.random() < 0.42
  ) {
    const e = pickAside(ENV_SETUP_RECOVERY_ASIDES);
    printAside(e.emoji, e.line);
  }
  maybePrintGenericSpice();
  process.exit(1);
});
```

**Integration:** `**aside-pools`**, `**cli-tone**`, `**cli-personality-state**` cooperate for adaptive copy; **not** used by SDK `**console.error`** paths.

---

## When you add a command or SDK surface

1. Add token to `**KNOWN_COMMANDS**` and a branch in `**main()**` (`cli/bin/auralogger.ts`).
2. Decide **HTTP vs WS** and **credential model**; extend `**[routes.md](routes.md)`** and `**[api-urls.md](api-urls.md)**`.
3. If you add new shared wire helpers, document them here and in `**[file-map.md](file-map.md)**`.
4. If behaviour is user-visible, extend `**[bdd.md](bdd.md)**`.
5. For **browser/Node split**, update `**package.json` `exports`** and add/extend `**.browser.ts` stubs** if native modules would otherwise leak into client bundles.

---

## Quick reference — optimisation checklist


| Mechanism                                    | Where                                      | What it saves / improves               |
| -------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| `DOTENV_CONFIG_QUIET`                        | `quiet-dotenv-first.ts`, `cli-load-env.ts` | Quieter CLI                            |
| `KNOWN_COMMANDS` Set                         | `auralogger.ts`                            | O(1) command validation                |
| Init “already configured” fast path          | `init.ts`                                  | Skips `proj_auth` HTTP                 |
| `tryParseResolvedStyles` short-circuit       | `get-logs.ts`                              | Skips `proj_auth` for colours only     |
| `hydrateFromSecretPromise` single-flight     | `server-log.ts`, `client-log.ts`           | One concurrent `proj_auth` per process |
| WebSocket reuse (same URL + open/connecting) | `server-log.ts`, `client-log.ts`           | Fewer handshakes                       |
| `DEFAULT_SOCKET_IDLE_CLOSE_MS`               | `socket-idle-close.ts`                     | Closes idle ingest sockets             |
| `deferTask` / `setImmediate`                 | `server-log.ts`, `client-log.ts`           | Non-blocking log API                   |
| Ingest batching (`BATCH_MAX_SIZE` / flush interval) | `server-log.ts`, `client-log.ts`    | Fewer WS frames; array payload per send |
| `get-logs` 404 soft empty                    | `get-logs.ts`                              | Graceful mis-host detection            |
| `maxcount` clamp                             | `get-logs-filters.ts`                      | Bounded API requests                   |
| `printLog` try/catch                         | `log-print.ts`                             | Style failures don’t crash printing    |


---

*End of document.*