<!-- Generated: 2026-04-09 UTC -->
# API and WebSocket base URLs

Single reference for **which host** the package uses for HTTPS `/api/*` vs **WebSocket** ingest, how to override it, and how paths attach. Source of truth in code: **`src/utils/backend-origin.ts`**.

---

## Quick comparison

| | **HTTP** (`fetch`, `/api/...`) | **WebSocket** (ingest sockets) |
|---|-------------------------------|--------------------------------|
| **Resolver** | `resolveApiBaseUrl()` | `resolveWsBaseUrl()` |
| **Env override** | `AURALOGGER_API_URL` | `AURALOGGER_WS_URL` |
| **Default (no env)** | `https://auralogger.com` | `wss://api.auralogger.com` |
| **Constant in source** | `DEFAULT_AURALOGGER_WEB_ORIGIN` | `DEFAULT_AURALOGGER_ORIGIN` → passed through `httpOriginToWsBase()` → `wss://…` |

Defaults are **intentionally different**: public site origin for REST by default, **`api.`** subdomain for sockets by default.

---

## HTTP — `resolveApiBaseUrl()`

- **Purpose:** Base origin for all **`fetch`** calls that hit **`/api/...`** (no trailing slash in returned string).
- **Default:** `DEFAULT_AURALOGGER_WEB_ORIGIN` = **`https://auralogger.com`**
- **Override:** Set **`AURALOGGER_API_URL`** to a full origin, e.g. `https://auralogger.com`, `https://api.auralogger.com`, or a staging URL. Empty/whitespace is ignored; non-empty values are trimmed and a trailing `/` is stripped.

**Call sites include:**

- `POST {base}/api/{project_token}/proj_auth` — `buildProjAuthUrl(base, token)`
- `POST {base}/api/{project_token}/logs` — `buildProjectLogsUrl(base, token)` (`get-logs`)

**Not used for:** WebSocket URLs (see below).

---

## WebSocket — `resolveWsBaseUrl()`

- **Purpose:** Base URL with **no path** — callers append `/{encodeURIComponent(projectToken)}/create_log` or `/create_browser_logs`.
- **Default:** `DEFAULT_AURALOGGER_ORIGIN` = **`https://api.auralogger.com`** → `httpOriginToWsBase()` yields **`wss://api.auralogger.com`** (or `ws://…` if you pointed the constant at `http://`).
- **Override:** Set **`AURALOGGER_WS_URL`** to a `wss://` or `ws://` origin (or a bare host string the code passes through). Trimmed; trailing `/` stripped.

**Call sites include:**

- **`AuraServer`**, **`server-check`**, **`test-serverlog`:** `wss://…/{token}/create_log`
- **`AuraClient`**, **`client-check`**, **`test-clientlog`:** `wss://…/{token}/create_browser_logs`

There is **no** `/api` prefix on WebSocket bases in this package.

---

## Reading `backend-origin.ts` (naming)

- **`DEFAULT_AURALOGGER_ORIGIN`** is named like a generic “API host” but in this file it only seeds the **default WebSocket** base after `httpOriginToWsBase()`. It does **not** set `resolveApiBaseUrl()`.
- **`DEFAULT_AURALOGGER_WEB_ORIGIN`** drives the **default HTTP** base only.

If you change production hosting, update the right constant **and** keep **`AURALOGGER_*`** env docs aligned.

---

## Overrides are independent

`AURALOGGER_API_URL` and `AURALOGGER_WS_URL` do **not** have to match. Typical reasons:

- API gateway serves `/api/*` on one host while WS terminates on another.
- Local dev: HTTP proxy on `localhost` and WS on a tunnel or different port.

---

## Browser / bundled apps

`AuraClient` (and any code that imports `resolveApiBaseUrl` / `resolveWsBaseUrl`) uses the same functions. In Vite/Next/etc., inject origins via env your bundler exposes (e.g. `NEXT_PUBLIC_…`) into **`AURALOGGER_API_URL`** / **`AURALOGGER_WS_URL`** at build or runtime **if** you must diverge from defaults.

---

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `proj_auth` or `get-logs` fails; `curl` to `auralogger.com` works | Wrong **`AURALOGGER_API_URL`** or default host doesn’t expose that route. |
| HTTP works; WS never connects | Wrong **`AURALOGGER_WS_URL`** or firewall/proxy blocking `wss://`. |
| 404 on `/api/...` only from CLI | Base URL points at a host that doesn’t mount those routes (set **`AURALOGGER_API_URL`** to the host that does). |

---

## When you change defaults or env behaviour

1. Edit **`src/utils/backend-origin.ts`**.
2. Update this file (**`dev-docs/api-urls.md`**) and the short “Base URLs” pointer in **`dev-docs/routes.md`**.
3. If user-facing, update **`user-docs/environment.md`** and **`readme.md`**.

See also: **[`feature-flows.md`](feature-flows.md)** (CLI + SDK flows), **[`routes.md`](routes.md)** (per-route paths and auth), **[`infra.md`](infra.md)** (backend ingest assumptions).
