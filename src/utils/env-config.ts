/** Environment variable names for Auralogger (process.env only; no file reads). */
export const ENV_PROJECT_TOKEN = "AURALOGGER_PROJECT_TOKEN";
/** Same ciphertext token, exposed to browser bundles (Next/Vite). */
export const ENV_NEXT_PUBLIC_PROJECT_TOKEN = `NEXT_PUBLIC_${ENV_PROJECT_TOKEN}`;
export const ENV_VITE_PROJECT_TOKEN = `VITE_${ENV_PROJECT_TOKEN}`;
export const ENV_USER_SECRET = "AURALOGGER_USER_SECRET";

// Public env vars (must be visible to client bundles).
// - Next.js exposes `NEXT_PUBLIC_*` to the browser.
// - Vite exposes `VITE_*` to the browser.
export const ENV_PROJECT_ID = "AURALOGGER_PROJECT_ID";
export const ENV_PROJECT_SESSION = "AURALOGGER_PROJECT_SESSION";
export const ENV_PROJECT_STYLES = "AURALOGGER_PROJECT_STYLES";
export const ENV_NEXT_PUBLIC_PROJECT_ID = `NEXT_PUBLIC_${ENV_PROJECT_ID}`;
export const ENV_NEXT_PUBLIC_PROJECT_SESSION = `NEXT_PUBLIC_${ENV_PROJECT_SESSION}`;
export const ENV_NEXT_PUBLIC_PROJECT_STYLES = `NEXT_PUBLIC_${ENV_PROJECT_STYLES}`;
export const ENV_VITE_PROJECT_ID = `VITE_${ENV_PROJECT_ID}`;
export const ENV_VITE_PROJECT_SESSION = `VITE_${ENV_PROJECT_SESSION}`;
export const ENV_VITE_PROJECT_STYLES = `VITE_${ENV_PROJECT_STYLES}`;

function trimEnv(key: string): string | undefined {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }
  const v = process.env[key];
  if (typeof v !== "string") {
    return undefined;
  }
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function trimEnvAny(keys: string[]): string | undefined {
  for (const k of keys) {
    const v = trimEnv(k);
    if (v) return v;
  }
  return undefined;
}

function publicEnvKeys(baseKey: string): string[] {
  // Prefer public keys so a single `.env` works for both server + client.
  return [`NEXT_PUBLIC_${baseKey}`, `VITE_${baseKey}`, baseKey];
}

export function getResolvedProjectIdKey(): string[] {
  return publicEnvKeys(ENV_PROJECT_ID);
}

export function getResolvedSessionKey(): string[] {
  return publicEnvKeys(ENV_PROJECT_SESSION);
}

export function getResolvedStylesKey(): string[] {
  return publicEnvKeys(ENV_PROJECT_STYLES);
}

export function getResolvedProjectToken(): string | undefined {
  return (
    trimEnv(ENV_PROJECT_TOKEN) ??
    trimEnv(ENV_NEXT_PUBLIC_PROJECT_TOKEN) ??
    trimEnv(ENV_VITE_PROJECT_TOKEN)
  );
}

export function getResolvedUserSecret(): string | undefined {
  return trimEnv(ENV_USER_SECRET);
}

export function getResolvedProjectId(): string | undefined {
  return trimEnvAny(getResolvedProjectIdKey());
}

export function getResolvedSession(): string | undefined {
  return trimEnvAny(getResolvedSessionKey());
}

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

/**
 * Styles for SDK console output: same precedence as `get-logs` — embedded
 * `AURALOGGER_PROJECT_STYLES` / `NEXT_PUBLIC_*` / `VITE_*` wins, then values
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

export function parseResolvedStylesOrThrow(): unknown[] {
  const raw = trimEnvAny(getResolvedStylesKey());
  if (!raw) {
    throw new Error(
      `Set ${ENV_NEXT_PUBLIC_PROJECT_STYLES} or ${ENV_VITE_PROJECT_STYLES} in the environment. Run "auralogger init" and add the lines it prints.`,
    );
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(
        `${ENV_NEXT_PUBLIC_PROJECT_STYLES}/${ENV_VITE_PROJECT_STYLES} must be a JSON array (same shape as from "auralogger init").`,
      );
    }
    return parsed;
  } catch (e: unknown) {
    if (e instanceof SyntaxError) {
      throw new Error(
        `${ENV_NEXT_PUBLIC_PROJECT_STYLES}/${ENV_VITE_PROJECT_STYLES} is not valid JSON. Run "auralogger init" to refresh the value.`,
      );
    }
    throw e;
  }
}

export function requireProjectTokenForCli(): string {
  const token = getResolvedProjectToken();
  if (!token) {
    throw new Error(
      `Missing ${ENV_PROJECT_TOKEN} (or ${ENV_NEXT_PUBLIC_PROJECT_TOKEN} / ${ENV_VITE_PROJECT_TOKEN}) — add it to .env (or your shell), or run auralogger init and paste when asked.`,
    );
  }
  return token;
}

export function requireUserSecretForCli(): string {
  const userSecret = getResolvedUserSecret();
  if (!userSecret) {
    throw new Error(
      `Missing ${ENV_USER_SECRET} — add it to .env (or your shell), or run auralogger init and paste when asked.`,
    );
  }
  return userSecret;
}

export function requireProjectIdForCli(): string {
  const id = getResolvedProjectId();
  if (!id) {
    throw new Error(
      `No project id in this shell — run auralogger init from the folder with your .env, or set id + friends in the environment.`,
    );
  }
  return id;
}

export function requireProjectSessionForCli(): string {
  const session = getResolvedSession();
  if (!session) {
    throw new Error(
      `No session in this shell — same fix as the id: auralogger init, or paste session into .env.`,
    );
  }
  return session;
}

/** True when project token, user secret, and session are set (id/styles optional — SDKs can hydrate via proj_auth). */
export function isFullRuntimeEnvConfigured(): boolean {
  return Boolean(
    getResolvedProjectToken() && getResolvedUserSecret() && getResolvedSession(),
  );
}

/**
 * Formats one line for a .env file: KEY="escaped value" (dotenv-style double quotes).
 */
export function formatDotenvLine(key: string, value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `${key}="${escaped}"`;
}
