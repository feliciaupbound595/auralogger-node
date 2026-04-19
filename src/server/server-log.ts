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
const SDK_RETRY_ATTEMPTS = 3;
const SDK_RETRY_DELAY_MS = 500;
const BATCH_FLUSH_INTERVAL_MS = 30;
const BATCH_MAX_SIZE = 30;

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
let onlyLocal: boolean | null = null;

let consoleOnlyFallback = false;
let localSessionId: string | null = null;
let warnedIncompleteEnv = false;
let socket: WebSocket | null = null;
let socketUrl: string | null = null;
let socketIdleTimer: ReturnType<typeof setTimeout> | null = null;
let bufferedLogs: LogPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

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

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
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

function resetBufferedLogs(): void {
  bufferedLogs = [];
  clearFlushTimer();
  flushInFlight = false;
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

function sendServerBatch(
  ws: WebSocket,
  sendPayload: string,
  batch: LogPayload[],
): void {
  ws.send(sendPayload, (error?: Error) => {
    if (!error) {
      return;
    }
    const sendErr = error?.message || String(error);
    console.warn(`auralogger: websocket send failed (${sendErr}); retrying (2/2)...`);
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    socket = null;
    socketUrl = null;
    const retryWs = ensureSocket();
    if (!retryWs) {
      console.error("auralogger: websocket unavailable after retry; log batch payload:", batch);
      return;
    }
    if (retryWs.readyState === WebSocket.OPEN) {
      bumpSocketIdleTimer(retryWs);
      retryWs.send(sendPayload, (retryError?: Error) => {
        if (!retryError) {
          return;
        }
        const retryErr = retryError?.message || String(retryError);
        console.error(`auralogger: websocket send failed after retry: ${retryErr}`);
        console.error("auralogger: failed batch payload:", batch);
      });
      return;
    }
    retryWs.once("open", () => {
      bumpSocketIdleTimer(retryWs);
      retryWs.send(sendPayload, (retryError?: Error) => {
        if (!retryError) {
          return;
        }
        const retryErr = retryError?.message || String(retryError);
        console.error(`auralogger: websocket send failed after retry: ${retryErr}`);
        console.error("auralogger: failed batch payload:", batch);
      });
    });
  });
}

function sendServerLogBatch(batch: LogPayload[]): void {
  const ws = ensureSocket();
  if (!ws) {
    if (!consoleOnlyFallback) {
      console.error("auralogger: websocket unavailable; log batch payload:", batch);
    }
    return;
  }
  if (ws.readyState === WebSocket.OPEN) {
    bumpSocketIdleTimer(ws);
  }

  let sendPayload = "";
  try {
    sendPayload = JSON.stringify(batch);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`auralogger: failed to serialize log batch payload: ${errMsg}`);
    console.error("auralogger: failed batch payload:", batch);
    return;
  }
  if (ws.readyState === WebSocket.OPEN) {
    sendServerBatch(ws, sendPayload, batch);
    return;
  }

  if (ws.readyState === WebSocket.CONNECTING) {
    ws.once("open", () => {
      bumpSocketIdleTimer(ws);
      sendServerBatch(ws, sendPayload, batch);
    });
    ws.once("error", () => {
      console.warn("auralogger: websocket unavailable while connecting; retrying (2/2)...");
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
      socket = null;
      socketUrl = null;
      const retryWs = ensureSocket();
      if (!retryWs) {
        console.error("auralogger: websocket unavailable after retry; log batch payload:", batch);
        return;
      }
      if (retryWs.readyState === WebSocket.OPEN) {
        bumpSocketIdleTimer(retryWs);
        sendServerBatch(retryWs, sendPayload, batch);
      }
    });
    return;
  }

  if (!consoleOnlyFallback) {
    console.error("auralogger: websocket unavailable; log batch payload:", batch);
  }
}

async function flushBufferedLogsNow(): Promise<void> {
  if (flushInFlight) {
    return;
  }
  flushInFlight = true;
  clearFlushTimer();
  try {
    while (bufferedLogs.length > 0) {
      const batch = bufferedLogs.splice(0, BATCH_MAX_SIZE);
      sendServerLogBatch(batch);
    }
  } finally {
    flushInFlight = false;
    if (bufferedLogs.length > 0) {
      scheduleFlush();
    }
  }
}

function scheduleFlush(): void {
  clearFlushTimer();
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBufferedLogsNow();
  }, BATCH_FLUSH_INTERVAL_MS);
}

function enqueueLogForBatch(payload: LogPayload): void {
  bufferedLogs.push(payload);
  if (bufferedLogs.length >= BATCH_MAX_SIZE) {
    void flushBufferedLogsNow();
    return;
  }
  scheduleFlush();
}

async function processServerlogAsync(
  type: string,
  message: string,
  nowMs: number,
  location?: string,
  data?: unknown,
): Promise<void> {
  ensureNodeEnvLoadedOnce();
  ensureRuntimeMode();

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

  if (onlyLocal === true || AuraServer.onlylocal === true) {
    return;
  }

  await ensureHydratedRuntimeConfig();
  ensureRuntimeMode();
  const session = getSession();
  if (session) {
    payload.session = session;
  }

  enqueueLogForBatch(payload);
}

export class AuraServer {
  static onlylocal: boolean | null = null;

  /**
   * Configure server logging with project token and optional user secret override.
   * Project id, session, and styles are fetched from `POST /api/{project_token}/proj_auth`.
   */
  static configure(projectToken: string, userSecret?: string, onlylocal?: boolean | null): void {
    overrideProjectToken = projectToken;
    if (userSecret !== undefined) {
      overrideUserSecret = userSecret;
    }
    if (onlylocal !== undefined) {
      onlyLocal = onlylocal;
      AuraServer.onlylocal = onlylocal;
    }
    hydrateFromSecretPromise = null;
    clearHydratedRuntimeConfig();
    resetBufferedLogs();
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
    await flushBufferedLogsNow();
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
