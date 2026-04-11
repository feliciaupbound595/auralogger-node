import WebSocket from "ws";

import {
  fetchProjAuthConfig,
  type InitConfigPayload,
} from "../cli/services/init";
import { printLog } from "../cli/services/log-print";
import { loadCliEnvFiles } from "../cli/utility/cli-load-env";
import type { ProjAuthConfigPayload } from "../cli/utility/log-styles";
import { resolveWsBaseUrl } from "../utils/backend-origin";
import { DEFAULT_SOCKET_IDLE_CLOSE_MS } from "../utils/socket-idle-close";
import {
  getResolvedProjectToken,
  getResolvedUserSecret,
  resolveStylesForConsolePrint,
} from "../utils/env-config";

const LOCAL_FALLBACK_SESSION = "auralogger-local-session";

interface LogPayload {
  type: string;
  message: string;
  session: string;
  location?: string;
  data?: string;
  created_at: string;
}
const UNKNOWN_TYPE = "unknown";

let nodeEnvLoaded = false;
let overrideProjectToken: string | undefined;
let overrideUserSecret: string | undefined;
let runtimeProjectId: string | null = null;
let runtimeSession: string | null = null;
let runtimeStyles: ProjAuthConfigPayload["styles"] | undefined = undefined;

let consoleOnlyFallback = false;
let localSessionId: string | null = null;
let warnedIncompleteEnv = false;
let socket: WebSocket | null = null;
let socketUrl: string | null = null;
let socketIdleTimer: ReturnType<typeof setTimeout> | null = null;

/** Single-flight lazy fetch for project token -> project/session/styles hydration. */
let hydrateFromSecretPromise: Promise<void> | null = null;

function applyProjAuthPayload(payload: InitConfigPayload): void {
  overrideProjectToken = payload.project_token;
  runtimeProjectId = payload.project_id?.trim() ?? null;
  runtimeSession = payload.session?.trim() ?? null;
  runtimeStyles = payload.styles;
  localSessionId = null;
  warnedIncompleteEnv = false;
}

function clearHydratedRuntimeConfig(): void {
  runtimeProjectId = null;
  runtimeSession = null;
  runtimeStyles = undefined;
}

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
      const payload = await fetchProjAuthConfig(token);
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

function clearSocketIdleTimer(): void {
  if (socketIdleTimer !== null) {
    clearTimeout(socketIdleTimer);
    socketIdleTimer = null;
  }
}

function bumpSocketIdleTimer(ws: WebSocket): void {
  clearSocketIdleTimer();
  socketIdleTimer = setTimeout(() => {
    socketIdleTimer = null;
    if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      ws.close();
    } catch {
      // ignore
    }
  }, DEFAULT_SOCKET_IDLE_CLOSE_MS);
}

const deferTask =
  typeof setImmediate === "function"
    ? (task: () => void) => setImmediate(task)
    : (task: () => void) => setTimeout(task, 0);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvedProjectToken(): string | undefined {
  if (overrideProjectToken !== undefined) {
    const t = overrideProjectToken.trim();
    return t.length > 0 ? t : undefined;
  }
  return getResolvedProjectToken();
}

function resolvedUserSecret(): string | undefined {
  if (overrideUserSecret !== undefined) {
    const t = overrideUserSecret.trim();
    return t.length > 0 ? t : undefined;
  }
  return getResolvedUserSecret();
}

function serverHasFullConfig(): boolean {
  if (!resolvedProjectToken() || !resolvedUserSecret()) {
    return false;
  }
  if (!runtimeProjectId) {
    return false;
  }
  if (!runtimeSession) {
    return false;
  }
  return runtimeStyles !== undefined;
}

function ensureRuntimeMode(): void {
  consoleOnlyFallback = !serverHasFullConfig();
  if (consoleOnlyFallback && !warnedIncompleteEnv) {
    warnedIncompleteEnv = true;
    console.error(
      "auralogger: logging to console only. Set AURALOGGER_PROJECT_TOKEN + AURALOGGER_USER_SECRET, then AuraServer auto-loads project id/session/styles from POST /api/{project_token}/proj_auth on the first log (or call AuraServer.syncFromSecret(projectToken, userSecret)).",
    );
  }
}

function getOrCreateLocalSession(): string {
  if (!localSessionId) {
    localSessionId = LOCAL_FALLBACK_SESSION;
  }
  return localSessionId;
}

function getProjectToken(): string | null {
  return resolvedProjectToken() ?? null;
}

function getUserSecret(): string | null {
  return resolvedUserSecret() ?? null;
}



function getSession(): string | null {
  if (consoleOnlyFallback) {
    return getOrCreateLocalSession();
  }
  return runtimeSession;
}

function padMicros(microseconds: number): string {
  return String(microseconds).padStart(6, "0");
}

function createIsoTimestampWithMicroseconds(epochMs: number): string {
  const d = new Date(epochMs);
  const iso = d.toISOString();
  const micros = padMicros(d.getUTCMilliseconds() * 1_000);
  return `${iso.slice(0, 19)}.${micros}Z`;
}

function normalizeType(type: string): string {
  return type.trim() ? type.trim() : UNKNOWN_TYPE;
}

function normalizeLocation(location?: string): string | undefined {
  if (typeof location !== "string") {
    return undefined;
  }
  const trimmed = location.trim();
  return trimmed || undefined;
}

function maybeData(data: unknown): string | undefined {
  if (data === null || data === undefined) {
    return undefined;
  }

  if (typeof data === "string") {
    return data;
  }

  if (!isPlainObject(data)) {
    return undefined;
  }

  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

function buildWsUrl(projectToken: string): string {
  return `${resolveWsBaseUrl()}/${encodeURIComponent(projectToken)}/create_log`;
}

function connectSocket(url: string, userSecret: string): WebSocket {
  const ws = new WebSocket(url, {
    headers: {
      authorization: `Bearer ${userSecret}`,
    },
  });

  ws.on("open", () => {
    bumpSocketIdleTimer(ws);
  });
  ws.on("close", () => {
    clearSocketIdleTimer();
    if (socket === ws) {
      socket = null;
      socketUrl = null;
    }
  });
  ws.on("error", (error: Error) => {
    const message = error?.message || String(error);
    console.error(`auralogger: websocket error: ${message}`);
  });

  return ws;
}

function ensureSocket(): WebSocket | null {
  if (consoleOnlyFallback) {
    return null;
  }

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

async function processServerlogAsync(
  type: string,
  message: string,
  nowMs: number,
  location?: string,
  data?: unknown,
): Promise<void> {
  ensureNodeEnvLoadedOnce();
  await ensureHydratedRuntimeConfig();
  ensureRuntimeMode();

  const session = getSession();
  if (!session) {
    console.error(
      "auralogger: missing session after token auth. Check your project token or proj_auth response.",
    );
    return;
  }

  const payload: LogPayload = {
    type: normalizeType(type),
    message: String(message ?? ""),
    session,
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

  deferTask(() => {
    printLog(payload, resolveStylesForConsolePrint(runtimeStyles));
  });

  const ws = ensureSocket();
  if (!ws) {
    if (!consoleOnlyFallback) {
      console.error("auralogger: websocket unavailable; log payload:", payload);
    }
    return;
  }
  if (ws.readyState === WebSocket.OPEN) {
    bumpSocketIdleTimer(ws);
  }

  let sendPayload = "";
  try {
    sendPayload = JSON.stringify(payload);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`auralogger: failed to serialize log payload: ${errMsg}`);
    console.error("auralogger: failed payload:", payload);
    return;
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(sendPayload, (error?: Error) => {
      if (!error) {
        return;
      }
      const sendErr = error?.message || String(error);
      console.error(`auralogger: websocket send failed: ${sendErr}`);
      console.error("auralogger: failed payload:", payload);
    });
    return;
  }

  if (ws.readyState === WebSocket.CONNECTING) {
    ws.once("open", () => {
      bumpSocketIdleTimer(ws);
      ws.send(sendPayload, (error?: Error) => {
        if (!error) {
          return;
        }
        const sendErr = error?.message || String(error);
        console.error(`auralogger: websocket send failed: ${sendErr}`);
        console.error("auralogger: failed payload:", payload);
      });
    });
    ws.once("error", () => {
      if (!consoleOnlyFallback) {
        console.error("auralogger: websocket unavailable; log payload:", payload);
      }
    });
    return;
  }

  if (!consoleOnlyFallback) {
    console.error("auralogger: websocket unavailable; log payload:", payload);
  }
}

export class AuraServer {
  /**
   * Configure server logging with project token and optional user secret override.
   * Project id, session, and styles are fetched from `POST /api/{project_token}/proj_auth`.
   */
  static configure(projectToken: string, userSecret?: string): void {
    overrideProjectToken = projectToken;
    if (userSecret !== undefined) {
      overrideUserSecret = userSecret;
    }
    hydrateFromSecretPromise = null;
    clearHydratedRuntimeConfig();
    warnedIncompleteEnv = false;
    const trimmed = projectToken.trim();
    if (!trimmed) {
      return;
    }
    hydrateFromSecretPromise = (async () => {
      const payload = await fetchProjAuthConfig(trimmed);
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

  static async syncFromSecret(projectToken: string, userSecret?: string): Promise<void> {
    ensureNodeEnvLoadedOnce();
    if (userSecret !== undefined) {
      overrideUserSecret = userSecret;
    }
    hydrateFromSecretPromise = null;
    const trimmed = projectToken.trim();
    if (!trimmed) {
      throw new Error("AuraServer.syncFromSecret: project token cannot be empty.");
    }
    clearHydratedRuntimeConfig();
    const payload = await fetchProjAuthConfig(trimmed);
    const projectId = payload.project_id?.trim() ?? "";
    const session = payload.session?.trim() ?? "";
    if (!projectId || !session) {
      throw new Error(
        "AuraServer.syncFromSecret: proj_auth response missing project id or session.",
      );
    }
    applyProjAuthPayload(payload);
  }

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

  static async closeSocket(timeoutMs = 1000): Promise<void> {
    clearSocketIdleTimer();
    if (!socket) {
      return;
    }

    const ws = socket;
    if (ws.readyState === WebSocket.CLOSED) {
      socket = null;
      socketUrl = null;
      return;
    }

    if (ws.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, timeoutMs);
        ws.once("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        ws.once("error", () => {
          clearTimeout(timeout);
          resolve();
        });
        ws.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const timeout = setTimeout(done, timeoutMs);

      ws.once("close", () => {
        clearTimeout(timeout);
        done();
      });
      ws.once("error", () => {
        clearTimeout(timeout);
        done();
      });

      try {
        ws.close();
      } catch {
        clearTimeout(timeout);
        done();
      }
    });
  }
}
