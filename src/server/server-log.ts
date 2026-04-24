import WebSocket from "ws";

import { fetchProjAuthConfig, type InitConfigPayload } from "../cli/services/init";
import { printLog } from "../cli/services/log-print";
import { resolveWsBaseUrl } from "../utils/backend-origin";
import { DEFAULT_SOCKET_IDLE_CLOSE_MS } from "../utils/socket-idle-close";
import { resolveStylesForConsolePrint } from "../utils/env-config";
import type { ProjAuthConfigPayload } from "../cli/utility/log-styles";

const UNKNOWN_TYPE = "unknown";
const LOCAL_FALLBACK_SESSION = "auralogger-local-session";
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

let projectToken: string | null = null;
let userSecret: string | null = null;
let session: string | null = null;
let styles: ProjAuthConfigPayload["styles"] | undefined = undefined;
let projAuthPromise: Promise<boolean> | null = null;

let socket: WebSocket | null = null;
let socketUrl: string | null = null;
let socketIdleTimer: ReturnType<typeof setTimeout> | null = null;

let batch: LogPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

const deferTask =
  typeof setImmediate === "function"
    ? (task: () => void) => setImmediate(task)
    : (task: () => void) => setTimeout(task, 0);

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function padMicros(us: number): string {
  return String(us).padStart(6, "0");
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
  if (typeof location !== "string") return undefined;
  const trimmed = location.trim();
  return trimmed || undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maybeData(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "string") return data;
  if (!isPlainObject(data)) return undefined;
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

function applyProjAuthPayload(payload: InitConfigPayload): void {
  projectToken = payload.project_token;
  session = payload.session?.trim() ?? null;
  styles = payload.styles;
}

async function runProjAuth(token: string): Promise<boolean> {
  let payload: InitConfigPayload;
  try {
    payload = await fetchProjAuthConfig(token);
  } catch (err: unknown) {
    console.error(`auralogger: could not load project config from API: ${toErrorMessage(err)}`);
    return false;
  }
  const pid = payload.project_id?.trim() ?? "";
  const sess = payload.session?.trim() ?? "";
  if (!pid || !sess) {
    console.warn("auralogger: proj_auth response missing project id or session; local-only logging.");
    return false;
  }
  applyProjAuthPayload(payload);
  return true;
}

function startProjAuthOnce(): void {
  if (projAuthPromise || !projectToken) return;
  const token = projectToken;
  projAuthPromise = runProjAuth(token);
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
    if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }, DEFAULT_SOCKET_IDLE_CLOSE_MS);
}

function resetBatchState(): void {
  batch = [];
  clearFlushTimer();
  flushInFlight = false;
}

function openSocketIfNeeded(): WebSocket | null {
  if (!projectToken) return null;
  if (!userSecret) {
    console.error("auralogger: missing user secret. Call AuraServer.configure(projectToken, userSecret) before logging.");
    return null;
  }
  const url = `${resolveWsBaseUrl()}/${encodeURIComponent(projectToken)}/create_log`;
  if (socket && socketUrl === url && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    clearSocketIdleTimer();
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }

  const ws = new WebSocket(url, {
    headers: { authorization: `Bearer ${userSecret}` },
  });
  ws.on("open", () => bumpSocketIdleTimer(ws));
  ws.on("close", () => {
    clearSocketIdleTimer();
    if (socket === ws) {
      socket = null;
      socketUrl = null;
    }
  });
  ws.on("error", (error: Error) => {
    console.error(`auralogger: websocket error: ${error?.message || String(error)}`);
  });

  socket = ws;
  socketUrl = url;
  return socket;
}

function sendOverSocket(ws: WebSocket, payload: string, onErr: (err: unknown) => void): void {
  try {
    ws.send(payload, (err?: Error) => {
      if (err) onErr(err);
    });
  } catch (err: unknown) {
    onErr(err);
  }
}

async function sendBatch(payloads: LogPayload[]): Promise<boolean> {
  const ws = openSocketIfNeeded();
  if (!ws) return false;

  let serialized: string;
  try {
    serialized = JSON.stringify(payloads);
  } catch (err: unknown) {
    console.error(`auralogger: failed to serialize log batch: ${toErrorMessage(err)}`);
    return false;
  }

  const onSendErr = (err: unknown) => {
    console.error(`auralogger: websocket send failed: ${toErrorMessage(err)}`);
  };

  if (ws.readyState === WebSocket.OPEN) {
    bumpSocketIdleTimer(ws);
    sendOverSocket(ws, serialized, onSendErr);
    return true;
  }
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.once("open", () => {
      bumpSocketIdleTimer(ws);
      sendOverSocket(ws, serialized, onSendErr);
    });
    return true;
  }
  return false;
}

async function flushNow(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  clearFlushTimer();
  try {
    if (!projAuthPromise) return;
    const ok = await projAuthPromise;
    if (!ok || !session) {
      batch = [];
      return;
    }
    const liveSession = session;
    while (batch.length > 0) {
      const slice = batch.slice(0, BATCH_MAX_SIZE);
      for (const p of slice) p.session = liveSession;
      const sent = await sendBatch(slice);
      if (!sent) {
        scheduleFlush();
        break;
      }
      batch.splice(0, slice.length);
    }
  } finally {
    flushInFlight = false;
    if (batch.length > 0) scheduleFlush();
  }
}

function scheduleFlush(): void {
  clearFlushTimer();
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, BATCH_FLUSH_INTERVAL_MS);
}

function processLog(type: string, message: string, nowMs: number, location?: string, data?: unknown): void {
  const payload: LogPayload = {
    type: normalizeType(type),
    message: String(message ?? ""),
    session: session ?? LOCAL_FALLBACK_SESSION,
    created_at: createIsoTimestampWithMicroseconds(nowMs),
  };
  const loc = normalizeLocation(location);
  if (loc) payload.location = loc;
  const d = maybeData(data);
  if (d) payload.data = d;

  try {
    printLog(payload, resolveStylesForConsolePrint(styles));
  } catch (err: unknown) {
    console.error(`auralogger: failed to print log: ${toErrorMessage(err)}`);
  }

  if (!projectToken) return;

  startProjAuthOnce();

  const wasEmpty = batch.length === 0;
  batch.push(payload);
  if (batch.length >= BATCH_MAX_SIZE) {
    void flushNow();
    return;
  }
  if (wasEmpty) scheduleFlush();
}

export class AuraServer {
  /**
   * Configure server logging with project token and user secret.
   * Project id, session, and styles are fetched from `POST /api/{project_token}/proj_auth`.
   */
  static configure(token: string, secret?: string): void {
    const trimmedToken = typeof token === "string" ? token.trim() : "";
    const trimmedSecret = typeof secret === "string" ? secret.trim() : "";

    session = null;
    styles = undefined;
    projAuthPromise = null;
    resetBatchState();

    if (!trimmedToken) {
      projectToken = null;
      userSecret = null;
      console.warn(
        "auralogger: AuraServer.configure called with empty token; continuing in local-only mode.",
      );
      return;
    }
    projectToken = trimmedToken;
    userSecret = trimmedSecret || null;
    startProjAuthOnce();
  }

  static async syncFromSecret(token: string, secret?: string): Promise<void> {
    const trimmedToken = typeof token === "string" ? token.trim() : "";
    if (!trimmedToken) {
      throw new Error("AuraServer.syncFromSecret: project token cannot be empty.");
    }
    const trimmedSecret = typeof secret === "string" ? secret.trim() : "";
    projectToken = trimmedToken;
    if (trimmedSecret) userSecret = trimmedSecret;
    session = null;
    styles = undefined;
    projAuthPromise = null;

    const payload = await fetchProjAuthConfig(trimmedToken);
    const pid = payload.project_id?.trim() ?? "";
    const sess = payload.session?.trim() ?? "";
    if (!pid || !sess) {
      throw new Error("AuraServer.syncFromSecret: proj_auth response missing project id or session.");
    }
    applyProjAuthPayload(payload);
    projAuthPromise = Promise.resolve(true);
  }

  static log(type: string, message: string, location?: string, data?: unknown): void {
    const nowMs = Date.now();
    deferTask(() => {
      try {
        processLog(type, message, nowMs, location, data);
      } catch (err: unknown) {
        console.error(`auralogger: log dispatch failed: ${toErrorMessage(err)}`);
      }
    });
  }

  static async closeSocket(timeoutMs = 1000): Promise<void> {
    // Let queued log() callbacks enqueue first.
    await new Promise<void>((resolve) => deferTask(resolve));
    if (projAuthPromise) {
      try {
        await projAuthPromise;
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => deferTask(resolve));
    await flushNow();
    clearSocketIdleTimer();
    if (!socket) return;

    const ws = socket;
    if (ws.readyState === WebSocket.CLOSED) {
      socket = null;
      socketUrl = null;
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs);
        ws.once("open", () => {
          clearTimeout(t);
          resolve();
        });
        ws.once("error", () => {
          clearTimeout(t);
          resolve();
        });
        ws.once("close", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (ws.readyState !== WebSocket.OPEN) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const fin = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const t = setTimeout(fin, timeoutMs);
      ws.once("close", () => {
        clearTimeout(t);
        fin();
      });
      ws.once("error", () => {
        clearTimeout(t);
        fin();
      });
      try {
        ws.close();
      } catch {
        clearTimeout(t);
        fin();
      }
    });
  }
}
