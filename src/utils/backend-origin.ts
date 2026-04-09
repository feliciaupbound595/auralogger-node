/** Default API host (HTTPS). WebSocket uses the matching wss:// origin. */
export const DEFAULT_AURALOGGER_ORIGIN = "https://api.auralogger.com";

/** Default web app (HTTPS) for REST `/api/*` and other non-WebSocket URLs. */
export const DEFAULT_AURALOGGER_WEB_ORIGIN = "https://auralogger.com";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function httpOriginToWsBase(origin: string): string {
  const trimmed = trimTrailingSlash(origin.trim());
  if (trimmed.startsWith("https://")) {
    return `wss://${trimmed.slice("https://".length)}`;
  }
  if (trimmed.startsWith("http://")) {
    return `ws://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}

function readEnvTrimmed(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

/** HTTPS base for `/api/*` requests (env `AURALOGGER_API_URL` overrides). */
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
